const fs = require("fs");
const path = require("path");
const dns = require("dns");
const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();
dns.setDefaultResultOrder("ipv4first");

const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PORT = Number(process.env.PORT || 3000);

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required. Add it to .env");
}

const app = express();
app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "memories.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ memories: [] }, null, 2), "utf8");
  }
}

function readDb() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

const bot = new Telegraf(BOT_TOKEN);
let botRunning = false;
bot.catch((err) => {
  console.error("Bot runtime error:", err);
});

bot.start(async (ctx) => {
  const text =
    "Privet! Ya bot biblioteki vospominaniy.\n\n" +
    "1) Otprav mne video (ili foto) s podpisyu.\n" +
    "2) V podpisi mozhno ukazat cvet i text v formate: yellow|Nasha poezdka.\n" +
    "   Dostupnye cveta: yellow, blue, red, green, purple\n" +
    "3) Otkroy mini app i smotri shariki.\n";

  await ctx.reply(
    text,
    Markup.inlineKeyboard([
      Markup.button.webApp("Otkryt biblioteku", `${BASE_URL}/miniapp`)
    ])
  );
});

function parseCaption(caption) {
  const defaultColor = "yellow";
  const text = (caption || "").trim();
  if (!text) return { color: defaultColor, note: "" };

  const [left, ...rest] = text.split("|");
  if (rest.length === 0) {
    return { color: defaultColor, note: left.trim() };
  }

  const color = left.trim().toLowerCase() || defaultColor;
  const note = rest.join("|").trim();
  return { color, note };
}

bot.on(["video", "photo"], async (ctx) => {
  const db = readDb();
  const user = ctx.from || {};
  const caption = ctx.message.caption || "";
  const parsed = parseCaption(caption);
  const allowedColors = new Set(["yellow", "blue", "red", "green", "purple"]);
  const color = allowedColors.has(parsed.color) ? parsed.color : "yellow";

  let mediaType = "video";
  let fileId = "";

  if (ctx.message.video) {
    mediaType = "video";
    fileId = ctx.message.video.file_id;
  } else if (ctx.message.photo) {
    mediaType = "photo";
    fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  }

  const memory = {
    id: uuidv4(),
    userId: String(user.id || ""),
    username: user.username || "",
    firstName: user.first_name || "",
    color,
    note: parsed.note,
    mediaType,
    fileId,
    createdAt: new Date().toISOString()
  };

  db.memories.push(memory);
  writeDb(db);

  await ctx.reply(
    `Sohraneno v sharik (${color}). Otkroy mini app.`,
    Markup.inlineKeyboard([
      Markup.button.webApp("Otkryt biblioteku", `${BASE_URL}/miniapp`)
    ])
  );
});

bot.on("text", async (ctx) => {
  const value = (ctx.message.text || "").trim();
  if (value.startsWith("/")) return;

  const db = readDb();
  const parsed = parseCaption(value);
  const allowedColors = new Set(["yellow", "blue", "red", "green", "purple"]);
  const color = allowedColors.has(parsed.color) ? parsed.color : "yellow";
  const user = ctx.from || {};

  const memory = {
    id: uuidv4(),
    userId: String(user.id || ""),
    username: user.username || "",
    firstName: user.first_name || "",
    color,
    note: parsed.note || value,
    mediaType: "text",
    fileId: "",
    createdAt: new Date().toISOString()
  };

  db.memories.push(memory);
  writeDb(db);

  await ctx.reply("Tekstovoe vospominanie sohraneno.");
});

app.use("/miniapp", express.static(path.join(__dirname, "miniapp")));

app.get("/api/memories", (req, res) => {
  const db = readDb();
  const sorted = [...db.memories].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ memories: sorted });
});

app.get("/api/memory/:id/playback", async (req, res) => {
  const db = readDb();
  const memory = db.memories.find((m) => m.id === req.params.id);
  if (!memory) {
    return res.status(404).json({ error: "Memory not found" });
  }

  if (memory.mediaType === "text") {
    return res.json({ mediaType: "text", note: memory.note });
  }

  try {
    const link = await bot.telegram.getFileLink(memory.fileId);
    return res.json({
      mediaType: memory.mediaType,
      url: link.toString(),
      note: memory.note
    });
  } catch (error) {
    return res.status(500).json({ error: "Cannot get media url from Telegram" });
  }
});

app.get("/", (req, res) => {
  res.redirect("/miniapp");
});

async function startBotWithRetry() {
  try {
    const me = await bot.telegram.getMe();
    console.log(`Telegram connected as @${me.username} (${me.id})`);
    await bot.launch({ dropPendingUpdates: true });
    botRunning = true;
    console.log("Bot polling started");
  } catch (error) {
    console.error("Bot launch failed:", error.message || error);
    console.error("Retrying in 15s...");
    setTimeout(startBotWithRetry, 15000);
  }
}

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  startBotWithRetry();
});

process.once("SIGINT", () => {
  if (botRunning) {
    bot.stop("SIGINT");
  }
});
process.once("SIGTERM", () => {
  if (botRunning) {
    bot.stop("SIGTERM");
  }
});
