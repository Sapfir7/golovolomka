const path = require("path");
const dns = require("dns");
const crypto = require("crypto");
const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const { Pool } = require("pg");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();
dns.setDefaultResultOrder("ipv4first");

const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN || !DATABASE_URL) {
  throw new Error("BOT_TOKEN and DATABASE_URL are required. Add them to env");
}

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
      can_invite BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      active_room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      max_uses INTEGER NOT NULL DEFAULT 100,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      color TEXT NOT NULL,
      note TEXT,
      media_type TEXT NOT NULL CHECK (media_type IN ('video', 'photo', 'text')),
      file_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_memories_room_created_at ON memories(room_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members(user_id);
  `);
}

async function getOrCreateUser(tgUser) {
  const telegramId = String(tgUser.id);
  const username = tgUser.username || "";
  const firstName = tgUser.first_name || "";
  const existing = await pool.query("SELECT * FROM users WHERE telegram_id = $1", [telegramId]);
  if (existing.rowCount > 0) {
    const row = existing.rows[0];
    if (row.username !== username || row.first_name !== firstName) {
      await pool.query("UPDATE users SET username = $1, first_name = $2 WHERE id = $3", [
        username,
        firstName,
        row.id
      ]);
      row.username = username;
      row.first_name = firstName;
    }
    return row;
  }

  const inserted = await pool.query(
    "INSERT INTO users(telegram_id, username, first_name) VALUES ($1, $2, $3) RETURNING *",
    [telegramId, username, firstName]
  );
  return inserted.rows[0];
}

async function getUserByTelegramId(telegramId) {
  const result = await pool.query("SELECT * FROM users WHERE telegram_id = $1", [String(telegramId)]);
  return result.rows[0] || null;
}

async function getRoomsForUser(userId) {
  const result = await pool.query(
    `SELECT r.id, r.title, rm.role, rm.can_invite, r.created_at
     FROM rooms r
     JOIN room_members rm ON rm.room_id = r.id
     WHERE rm.user_id = $1
     ORDER BY r.created_at ASC`,
    [userId]
  );
  return result.rows;
}

async function setActiveRoom(userId, roomId) {
  await pool.query(
    `INSERT INTO user_prefs(user_id, active_room_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET active_room_id = EXCLUDED.active_room_id`,
    [userId, roomId]
  );
}

async function getActiveRoom(userId) {
  const pref = await pool.query(
    `SELECT up.active_room_id, r.title
     FROM user_prefs up
     LEFT JOIN rooms r ON r.id = up.active_room_id
     WHERE up.user_id = $1`,
    [userId]
  );
  if (pref.rowCount > 0 && pref.rows[0].active_room_id) {
    return { id: pref.rows[0].active_room_id, title: pref.rows[0].title };
  }

  const firstRoom = await pool.query(
    `SELECT r.id, r.title
     FROM rooms r
     JOIN room_members rm ON rm.room_id = r.id
     WHERE rm.user_id = $1
     ORDER BY r.created_at ASC
     LIMIT 1`,
    [userId]
  );
  if (firstRoom.rowCount > 0) {
    const room = firstRoom.rows[0];
    await setActiveRoom(userId, room.id);
    return room;
  }
  return null;
}

async function createRoom(ownerUserId, title) {
  const countRes = await pool.query("SELECT COUNT(*)::int AS c FROM rooms WHERE owner_user_id = $1", [
    ownerUserId
  ]);
  if (countRes.rows[0].c >= 10) {
    throw new Error("LIMIT_10_ROOMS");
  }

  const roomId = uuidv4();
  await pool.query("INSERT INTO rooms(id, title, owner_user_id) VALUES ($1, $2, $3)", [
    roomId,
    title,
    ownerUserId
  ]);
  await pool.query(
    "INSERT INTO room_members(room_id, user_id, role, can_invite) VALUES ($1, $2, 'owner', TRUE)",
    [roomId, ownerUserId]
  );
  await setActiveRoom(ownerUserId, roomId);
  return roomId;
}

async function getMembership(userId, roomId) {
  const result = await pool.query(
    "SELECT room_id, user_id, role, can_invite FROM room_members WHERE user_id = $1 AND room_id = $2",
    [userId, roomId]
  );
  return result.rows[0] || null;
}

function roleCanWrite(role) {
  return role === "owner" || role === "editor";
}

let botUsername = process.env.BOT_USERNAME || "";

const bot = new Telegraf(BOT_TOKEN);
let botRunning = false;
const MENU = {
  CREATE_ROOM: "➕ Sozdat komnatu",
  MY_ROOMS: "📂 Moi komnaty",
  MEMBERS: "👥 Uchastniki",
  INVITE_VIEWER: "🔗 Invite Viewer",
  INVITE_EDITOR: "✍️ Invite Editor",
  OPEN_APP: "🎞 Otkryt biblioteku"
};

function mainMenuKeyboard() {
  return Markup.keyboard([
    [MENU.CREATE_ROOM, MENU.MY_ROOMS],
    [MENU.MEMBERS],
    [MENU.INVITE_VIEWER, MENU.INVITE_EDITOR],
    [MENU.OPEN_APP]
  ]).resize();
}

async function sendMainMenu(ctx, text) {
  await ctx.reply(text, mainMenuKeyboard());
}

async function showRooms(ctx, user) {
  const rooms = await getRoomsForUser(user.id);
  if (!rooms.length) {
    await sendMainMenu(ctx, "U tebya net komnat. Nazhmi '➕ Sozdat komnatu'.");
    return;
  }
  const active = await getActiveRoom(user.id);
  const lines = rooms.map((room) => {
    const marker = active && active.id === room.id ? " *active*" : "";
    return `- ${room.title} (${room.role})\n  id: ${room.id}${marker}`;
  });
  const buttons = rooms.map((room) => [
    Markup.button.callback(
      `${active && active.id === room.id ? "✅" : "➡️"} ${room.title} (${room.role})`,
      `room_use:${room.id}`
    )
  ]);
  await ctx.reply(`Tvoi komnaty:\n${lines.join("\n")}`, Markup.inlineKeyboard(buttons));
}

async function showMembers(ctx, user) {
  const activeRoom = await getActiveRoom(user.id);
  if (!activeRoom) {
    await ctx.reply("Aktivnaya komnata ne naidena.");
    return;
  }
  const member = await getMembership(user.id, activeRoom.id);
  if (!member) {
    await ctx.reply("Ty ne uchastnik etoy komnaty.");
    return;
  }
  const rows = await pool.query(
    `SELECT u.telegram_id, u.username, u.first_name, rm.role
     FROM room_members rm
     JOIN users u ON u.id = rm.user_id
     WHERE rm.room_id = $1
     ORDER BY rm.created_at ASC`,
    [activeRoom.id]
  );
  const text = rows.rows
    .map((r) => `- ${r.first_name || r.username || r.telegram_id} (${r.role}) id:${r.telegram_id}`)
    .join("\n");
  await ctx.reply(`Uchastniki "${activeRoom.title}":\n${text}`);
}

async function createInviteForRole(ctx, user, role) {
  const activeRoom = await getActiveRoom(user.id);
  if (!activeRoom) {
    await ctx.reply("Snachala sozday komnatu: /room_create Family");
    return;
  }
  const member = await getMembership(user.id, activeRoom.id);
  if (!member || (!member.can_invite && member.role !== "owner")) {
    await ctx.reply("U tebya net prav sozdavat invite v etoy komnate.");
    return;
  }
  const token = crypto.randomBytes(12).toString("hex");
  const inviteId = uuidv4();
  await pool.query(
    `INSERT INTO invites(id, room_id, token, created_by_user_id, role, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '30 days')`,
    [inviteId, activeRoom.id, token, user.id, role]
  );
  const username = botUsername || "Library_of_memories_bot";
  const link = `https://t.me/${username}?start=join_${token}`;
  await ctx.reply(`Invite sozdana (${role}).\n${link}`);
}

bot.catch((err) => {
  console.error("Bot runtime error:", err);
});

bot.start(async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  const payload = ctx.startPayload || "";
  if (payload.startsWith("join_")) {
    const token = payload.slice(5);
    const inviteRes = await pool.query(
      `SELECT i.*, r.title
       FROM invites i
       JOIN rooms r ON r.id = i.room_id
       WHERE i.token = $1`,
      [token]
    );
    if (inviteRes.rowCount === 0) {
      await ctx.reply("Invite ssylka ne naidena.");
    } else {
      const invite = inviteRes.rows[0];
      const expired = invite.expires_at && new Date(invite.expires_at) < new Date();
      if (!invite.is_active || expired || invite.used_count >= invite.max_uses) {
        await ctx.reply("Invite ssylka prosrochena ili uzhe neaktivna.");
      } else {
        await pool.query(
          `INSERT INTO room_members(room_id, user_id, role, can_invite)
           VALUES ($1, $2, $3, FALSE)
           ON CONFLICT (room_id, user_id)
           DO UPDATE SET role = EXCLUDED.role`,
          [invite.room_id, user.id, invite.role]
        );
        await pool.query("UPDATE invites SET used_count = used_count + 1 WHERE id = $1", [invite.id]);
        await setActiveRoom(user.id, invite.room_id);
        await ctx.reply(`Ty prisoedinilsya k komnate "${invite.title}" kak ${invite.role}.`);
      }
    }
  }

  const text =
    "Privet! Ya bot biblioteki vospominaniy.\n\n" +
    "Komandy:\n" +
    "/room_create Nazvanie - sozdat komnatu (max 10)\n" +
    "/rooms - spisok komnat\n" +
    "/room_use ROOM_ID - vybrat aktivnuyu komnatu\n" +
    "/room_invite viewer|editor - ssylka-priglashenie s pravami\n" +
    "/room_members - uchastniki aktivnoy komnaty\n" +
    "/room_role TELEGRAM_ID viewer|editor - izmenit prava (tolko owner)\n\n" +
    "Otprav media ili text: ono sohranitsya v aktivnuyu komnatu.";

  await ctx.reply(
    text + "\n\nIspolzuy knopki menyu nizhe.",
    Markup.inlineKeyboard([[Markup.button.webApp("Otkryt biblioteku (WebApp)", `${BASE_URL}/miniapp`)]])
  );
  await sendMainMenu(ctx, "Glavnoe menu dostupno.");
});

bot.command("miniapp", async (ctx) => {
  await ctx.reply(
    `Pryamaya ssylka na mini app: ${BASE_URL}/miniapp`,
    Markup.inlineKeyboard([[Markup.button.url("Open mini app", `${BASE_URL}/miniapp`)]])
  );
});

bot.hears(MENU.OPEN_APP, async (ctx) => {
  await ctx.reply(
    "Otkryvayu mini app.",
    Markup.inlineKeyboard([[Markup.button.webApp("Otkryt biblioteku (WebApp)", `${BASE_URL}/miniapp`)]])
  );
});

bot.command("room_create", async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  const title = (ctx.message.text || "").replace("/room_create", "").trim();
  if (!title) {
    await ctx.reply("Primer: /room_create Family");
    return;
  }
  try {
    const roomId = await createRoom(user.id, title);
    await ctx.reply(`Komnata sozdana: "${title}"\nID: ${roomId}\nTeper eto aktivnaya komnata.`);
  } catch (error) {
    if (error.message === "LIMIT_10_ROOMS") {
      await ctx.reply("Dostignut limit: maksimum 10 komnat na owner.");
      return;
    }
    throw error;
  }
});

bot.command("rooms", async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  await showRooms(ctx, user);
});

bot.command("room_use", async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  const roomId = (ctx.message.text || "").replace("/room_use", "").trim();
  if (!roomId) {
    await ctx.reply("Primer: /room_use ROOM_ID");
    return;
  }
  const member = await getMembership(user.id, roomId);
  if (!member) {
    await ctx.reply("Ty ne uchastnik etoy komnaty.");
    return;
  }
  await setActiveRoom(user.id, roomId);
  await sendMainMenu(ctx, `Aktivnaya komnata: ${roomId}`);
});

bot.action(/^room_use:(.+)$/, async (ctx) => {
  const roomId = ctx.match[1];
  const user = await getOrCreateUser(ctx.from);
  const member = await getMembership(user.id, roomId);
  if (!member) {
    await ctx.answerCbQuery("Net dostupa");
    return;
  }
  await setActiveRoom(user.id, roomId);
  await ctx.answerCbQuery("Komnata vybrana");
  await ctx.reply(`Aktivnaya komnata: ${roomId}`, mainMenuKeyboard());
});

bot.command("room_invite", async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  const role = (ctx.message.text || "").replace("/room_invite", "").trim().toLowerCase();
  if (!["viewer", "editor"].includes(role)) {
    await ctx.reply("Primer: /room_invite viewer\nIli: /room_invite editor");
    return;
  }
  await createInviteForRole(ctx, user, role);
});

bot.command("room_members", async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  await showMembers(ctx, user);
});

bot.hears(MENU.MY_ROOMS, async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  await showRooms(ctx, user);
});

bot.hears(MENU.MEMBERS, async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  await showMembers(ctx, user);
});

bot.hears(MENU.INVITE_VIEWER, async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  await createInviteForRole(ctx, user, "viewer");
});

bot.hears(MENU.INVITE_EDITOR, async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  await createInviteForRole(ctx, user, "editor");
});

bot.hears(MENU.CREATE_ROOM, async (ctx) => {
  await sendMainMenu(
    ctx,
    "Napishi komandoy:\n/room_create Nazvanie\n\nPrimer:\n/room_create Family"
  );
});

bot.command("room_role", async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  const args = (ctx.message.text || "").replace("/room_role", "").trim().split(/\s+/).filter(Boolean);
  if (args.length !== 2 || !["viewer", "editor"].includes(args[1])) {
    await ctx.reply("Primer: /room_role 123456789 editor");
    return;
  }
  const [targetTelegramId, role] = args;
  const activeRoom = await getActiveRoom(user.id);
  if (!activeRoom) {
    await ctx.reply("Aktivnaya komnata ne naidena.");
    return;
  }
  const me = await getMembership(user.id, activeRoom.id);
  if (!me || me.role !== "owner") {
    await ctx.reply("Tolko owner mozet menyat roli.");
    return;
  }
  const target = await getUserByTelegramId(targetTelegramId);
  if (!target) {
    await ctx.reply("Polzovatel ne naiden v sisteme (on dolzhen hotya by raz zapustit bota).");
    return;
  }
  await pool.query("UPDATE room_members SET role = $1 WHERE room_id = $2 AND user_id = $3", [
    role,
    activeRoom.id,
    target.id
  ]);
  await ctx.reply(`Rol obnovlena: ${targetTelegramId} -> ${role}`);
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
  const user = await getOrCreateUser(ctx.from || {});
  const activeRoom = await getActiveRoom(user.id);
  if (!activeRoom) {
    await ctx.reply("Snachala sozday komnatu: /room_create Family");
    return;
  }
  const membership = await getMembership(user.id, activeRoom.id);
  if (!membership || !roleCanWrite(membership.role)) {
    await ctx.reply("U tebya net prav dobavlyat vospominaniya v etu komnatu.");
    return;
  }

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

  await pool.query(
    `INSERT INTO memories(id, room_id, author_user_id, color, note, media_type, file_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [uuidv4(), activeRoom.id, user.id, color, parsed.note, mediaType, fileId]
  );

  await ctx.reply(
    `Sohraneno v komnatu "${activeRoom.title}" (${color}).`,
    Markup.inlineKeyboard([[Markup.button.webApp("Otkryt biblioteku (WebApp)", `${BASE_URL}/miniapp`)]])
  );
});

bot.on("text", async (ctx) => {
  const value = (ctx.message.text || "").trim();
  if (value.startsWith("/")) return;
  const user = await getOrCreateUser(ctx.from || {});
  const activeRoom = await getActiveRoom(user.id);
  if (!activeRoom) {
    await ctx.reply("Snachala sozday komnatu: /room_create Family");
    return;
  }
  const membership = await getMembership(user.id, activeRoom.id);
  if (!membership || !roleCanWrite(membership.role)) {
    await ctx.reply("U tebya net prav dobavlyat vospominaniya v etu komnatu.");
    return;
  }
  const parsed = parseCaption(value);
  const allowedColors = new Set(["yellow", "blue", "red", "green", "purple"]);
  const color = allowedColors.has(parsed.color) ? parsed.color : "yellow";
  await pool.query(
    `INSERT INTO memories(id, room_id, author_user_id, color, note, media_type, file_id)
     VALUES ($1, $2, $3, $4, $5, 'text', '')`,
    [uuidv4(), activeRoom.id, user.id, color, parsed.note || value]
  );
  await ctx.reply(`Tekstovoe vospominanie sohraneno v "${activeRoom.title}".`);
});

const MINIAPP_DIR = path.join(__dirname, "miniapp");
app.use("/miniapp", express.static(MINIAPP_DIR));
app.get("/miniapp", (req, res) => {
  res.sendFile(path.join(MINIAPP_DIR, "index.html"));
});
app.get("/miniapp/", (req, res) => {
  res.sendFile(path.join(MINIAPP_DIR, "index.html"));
});

app.get("/api/rooms", async (req, res) => {
  const telegramId = String(req.query.telegramId || "");
  if (!telegramId) {
    return res.status(400).json({ error: "telegramId is required" });
  }
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    return res.json({ rooms: [] });
  }
  const rooms = await getRoomsForUser(user.id);
  const active = await getActiveRoom(user.id);
  return res.json({ rooms, activeRoomId: active ? active.id : null });
});

app.get("/api/memories", async (req, res) => {
  const telegramId = String(req.query.telegramId || "");
  const roomId = String(req.query.roomId || "");
  if (!telegramId || !roomId) {
    return res.status(400).json({ error: "telegramId and roomId are required" });
  }
  const user = await getUserByTelegramId(telegramId);
  if (!user) return res.json({ memories: [] });
  const member = await getMembership(user.id, roomId);
  if (!member) return res.status(403).json({ error: "Forbidden" });

  const result = await pool.query(
    `SELECT id, color, note, media_type, created_at
     FROM memories
     WHERE room_id = $1
     ORDER BY created_at DESC
     LIMIT 300`,
    [roomId]
  );

  return res.json({
    memories: result.rows.map((m) => ({
      id: m.id,
      color: m.color,
      note: m.note,
      mediaType: m.media_type,
      createdAt: m.created_at
    }))
  });
});

app.get("/api/memory/:id/playback", async (req, res) => {
  const telegramId = String(req.query.telegramId || "");
  if (!telegramId) return res.status(400).json({ error: "telegramId is required" });
  const user = await getUserByTelegramId(telegramId);
  if (!user) return res.status(403).json({ error: "Forbidden" });

  const result = await pool.query("SELECT * FROM memories WHERE id = $1", [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Memory not found" });
  const memory = result.rows[0];
  const member = await getMembership(user.id, memory.room_id);
  if (!member) return res.status(403).json({ error: "Forbidden" });

  if (memory.media_type === "text") return res.json({ mediaType: "text", note: memory.note || "" });

  try {
    const link = await bot.telegram.getFileLink(memory.file_id);
    return res.json({
      mediaType: memory.media_type,
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
    await initDb();
    const me = await bot.telegram.getMe();
    botUsername = me.username || botUsername;
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

const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Server started on ${HOST}:${PORT}`);
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
