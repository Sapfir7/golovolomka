const path = require("path");
const fs = require("fs");
const dns = require("dns");
const crypto = require("crypto");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
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
      preview_file_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_memories_room_created_at ON memories(room_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members(user_id);
  `);
  await pool.query(`
    ALTER TABLE memories
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);
  await pool.query(`
    ALTER TABLE memories
    ADD COLUMN IF NOT EXISTS preview_file_id TEXT;
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
  const normalizedTitle = title.trim();
  const duplicate = await pool.query(
    "SELECT 1 FROM rooms WHERE owner_user_id = $1 AND LOWER(title) = LOWER($2) LIMIT 1",
    [ownerUserId, normalizedTitle]
  );
  if (duplicate.rowCount > 0) {
    throw new Error("ROOM_NAME_EXISTS");
  }

  const countRes = await pool.query("SELECT COUNT(*)::int AS c FROM rooms WHERE owner_user_id = $1", [
    ownerUserId
  ]);
  if (countRes.rows[0].c >= 10) {
    throw new Error("LIMIT_10_ROOMS");
  }

  const roomId = uuidv4();
  await pool.query("INSERT INTO rooms(id, title, owner_user_id) VALUES ($1, $2, $3)", [
    roomId,
    normalizedTitle,
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
const userFlowState = new Map();
const MENU = {
  MY_ROOMS: "📂 Мои комнаты"
};

function startKeyboard() {
  return Markup.keyboard([[MENU.MY_ROOMS]]).resize();
}

function colorLabel(color) {
  const map = {
    yellow: "Жёлтый (радость)",
    blue: "Синий (грусть)",
    red: "Красный (злость)",
    purple: "Фиолетовый (тревога)"
  };
  return map[color] || color;
}

async function sendMainMenu(ctx, text) {
  await ctx.reply(text, startKeyboard());
}

async function showRooms(ctx, user) {
  const rooms = await getRoomsForUser(user.id);
  const active = await getActiveRoom(user.id);
  const buttons = rooms.map((room) => [
    Markup.button.callback(
      `${active && active.id === room.id ? "✅ " : ""}${room.title} (${room.role})`,
      `room_select:${room.id}`
    )
  ]);
  buttons.push([Markup.button.callback("➕ Добавить комнату", "room_add")]);
  const text = rooms.length
    ? "Ваши комнаты. Нажмите на комнату:"
    : "У вас пока нет комнат. Нажмите «Добавить комнату».";
  await ctx.reply(text, Markup.inlineKeyboard(buttons));
}

async function showRoomActions(ctx, user, roomId) {
  const roomRes = await pool.query(
    `SELECT r.id, r.title, rm.role
     FROM rooms r
     JOIN room_members rm ON rm.room_id = r.id
     WHERE r.id = $1 AND rm.user_id = $2`,
    [roomId, user.id]
  );
  if (roomRes.rowCount === 0) {
    await ctx.reply("Комната не найдена или нет доступа.");
    return;
  }
  const room = roomRes.rows[0];
  await setActiveRoom(user.id, room.id);
  await ctx.reply(
    `Комната: ${room.title}\nВаша роль: ${room.role}`,
    Markup.inlineKeyboard([
      [Markup.button.callback("➕ Добавить воспоминание", `room_add_memory:${room.id}`)],
      [Markup.button.callback("🔗 Пригласить для просмотра", `room_invite:${room.id}:viewer`)],
      [Markup.button.callback("✍️ Пригласить с редактированием", `room_invite:${room.id}:editor`)],
      [Markup.button.webApp("🎞 Посмотреть комнату", `${BASE_URL}/miniapp-3d/?roomId=${room.id}`)],
      [Markup.button.callback("⬅️ Назад к комнатам", "rooms_open")]
    ])
  );
}

async function createInviteForRole(ctx, user, roomId, role) {
  const member = await getMembership(user.id, roomId);
  if (!member || (!member.can_invite && member.role !== "owner")) {
    await ctx.reply("У вас нет прав создавать приглашения в этой комнате.");
    return;
  }
  const token = crypto.randomBytes(12).toString("hex");
  const inviteId = uuidv4();
  await pool.query(
    `INSERT INTO invites(id, room_id, token, created_by_user_id, role, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '30 days')`,
    [inviteId, roomId, token, user.id, role]
  );
  const username = botUsername || "Library_of_memories_bot";
  const link = `https://t.me/${username}?start=join_${token}`;
  const roleText = role === "editor" ? "просмотр + редактирование" : "только просмотр";
  await ctx.reply(`Ссылка-приглашение (${roleText}):\n${link}`);
}

bot.catch((err) => {
  console.error("Bot runtime error:", err);
});

bot.start(async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  const payload = ctx.startPayload || "";
  userFlowState.delete(user.id);
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
      await ctx.reply("Ссылка-приглашение не найдена.");
    } else {
      const invite = inviteRes.rows[0];
      const expired = invite.expires_at && new Date(invite.expires_at) < new Date();
      if (!invite.is_active || expired || invite.used_count >= invite.max_uses) {
        await ctx.reply("Ссылка-приглашение просрочена или уже неактивна.");
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
        await ctx.reply(`Вы присоединились к комнате «${invite.title}» с ролью ${invite.role}.`);
      }
    }
  }
  await sendMainMenu(
    ctx,
    "Добро пожаловать в библиотеку воспоминаний.\nНажмите «Мои комнаты», чтобы продолжить."
  );
});

bot.command("miniapp", async (ctx) => {
  await ctx.reply(
    "Открыть мини-приложение:",
    Markup.inlineKeyboard([[Markup.button.webApp("🎞 Открыть библиотеку", `${BASE_URL}/miniapp`)]])
  );
});

bot.command("room_create", async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  const title = (ctx.message.text || "").replace("/room_create", "").trim();
  if (!title) {
    await ctx.reply("Пример: /room_create Семья");
    return;
  }
  try {
    await createRoom(user.id, title);
    await ctx.reply(`Комната «${title}» создана.`);
    await showRooms(ctx, user);
  } catch (error) {
    if (error.message === "LIMIT_10_ROOMS") {
      await ctx.reply("Достигнут лимит: максимум 10 комнат.");
      return;
    }
    if (error.message === "ROOM_NAME_EXISTS") {
      await ctx.reply("Комната с таким названием уже существует.");
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
    await ctx.reply("Пример: /room_use ROOM_ID");
    return;
  }
  const member = await getMembership(user.id, roomId);
  if (!member) {
    await ctx.reply("Вы не участник этой комнаты.");
    return;
  }
  await showRoomActions(ctx, user, roomId);
});

bot.action(/^room_select:(.+)$/, async (ctx) => {
  const roomId = ctx.match[1];
  const user = await getOrCreateUser(ctx.from);
  const member = await getMembership(user.id, roomId);
  if (!member) {
    await ctx.answerCbQuery("Нет доступа");
    return;
  }
  await ctx.answerCbQuery("Комната выбрана");
  await showRoomActions(ctx, user, roomId);
});

bot.command("room_invite", async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  const role = (ctx.message.text || "").replace("/room_invite", "").trim().toLowerCase();
  if (!["viewer", "editor"].includes(role)) {
    await ctx.reply("Пример: /room_invite viewer или /room_invite editor");
    return;
  }
  const activeRoom = await getActiveRoom(user.id);
  if (!activeRoom) {
    await ctx.reply("Сначала выберите комнату через «Мои комнаты».");
    return;
  }
  await createInviteForRole(ctx, user, activeRoom.id, role);
});

bot.hears(MENU.MY_ROOMS, async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  await showRooms(ctx, user);
});

bot.action("rooms_open", async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  await ctx.answerCbQuery();
  await showRooms(ctx, user);
});

bot.action("room_add", async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  userFlowState.set(user.id, { step: "await_room_name" });
  await ctx.answerCbQuery();
  await ctx.reply("Введите название комнаты:");
});

bot.action(/^room_invite:([^:]+):(viewer|editor)$/, async (ctx) => {
  const roomId = ctx.match[1];
  const role = ctx.match[2];
  const user = await getOrCreateUser(ctx.from);
  await ctx.answerCbQuery();
  await createInviteForRole(ctx, user, roomId, role);
});

bot.action(/^room_add_memory:(.+)$/, async (ctx) => {
  const roomId = ctx.match[1];
  const user = await getOrCreateUser(ctx.from);
  const member = await getMembership(user.id, roomId);
  if (!member || !roleCanWrite(member.role)) {
    await ctx.answerCbQuery("Нет прав");
    await ctx.reply("У вас нет прав на добавление в этой комнате.");
    return;
  }
  await ctx.answerCbQuery();
  await ctx.reply(
    "Выберите цвет воспоминания:",
    Markup.inlineKeyboard([
      [Markup.button.callback("Жёлтый (радость)", `mem_color:${roomId}:yellow`)],
      [Markup.button.callback("Синий (грусть)", `mem_color:${roomId}:blue`)],
      [Markup.button.callback("Красный (злость)", `mem_color:${roomId}:red`)],
      [Markup.button.callback("Фиолетовый (тревога)", `mem_color:${roomId}:purple`)]
    ])
  );
});

bot.action(/^mem_color:([^:]+):(yellow|blue|red|purple)$/, async (ctx) => {
  const roomId = ctx.match[1];
  const color = ctx.match[2];
  const user = await getOrCreateUser(ctx.from);
  userFlowState.set(user.id, { step: "await_memory_content", roomId, color });
  await setActiveRoom(user.id, roomId);
  await ctx.answerCbQuery();
  await ctx.reply(
    `Цвет выбран: ${colorLabel(color)}.\nТеперь отправьте фото, видео или текст воспоминания.\nМожно добавить подпись к медиа.`
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

async function saveMemory({
  roomId,
  authorUserId,
  color,
  note,
  mediaType,
  fileId,
  previewFileId = null
}) {
  await pool.query(
    `INSERT INTO memories(id, room_id, author_user_id, color, note, media_type, file_id, preview_file_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [uuidv4(), roomId, authorUserId, color, note || "", mediaType, fileId || "", previewFileId]
  );
}

bot.action("video_preview_add", async (ctx) => {
  const user = await getOrCreateUser(ctx.from || {});
  const state = userFlowState.get(user.id);
  if (!state || state.step !== "await_video_preview") {
    await ctx.answerCbQuery("Черновик видео не найден");
    return;
  }
  await ctx.answerCbQuery();
  await ctx.reply("Отправьте фото, которое нужно использовать как превью этого видео.");
});

bot.action("video_preview_auto", async (ctx) => {
  const user = await getOrCreateUser(ctx.from || {});
  const state = userFlowState.get(user.id);
  if (!state || state.step !== "await_video_preview") {
    await ctx.answerCbQuery("Черновик видео не найден");
    return;
  }
  await saveMemory({
    roomId: state.roomId,
    authorUserId: user.id,
    color: state.color,
    note: state.note,
    mediaType: "video",
    fileId: state.videoFileId,
    previewFileId: state.autoPreviewFileId || null
  });
  userFlowState.delete(user.id);
  await ctx.answerCbQuery("Сохранено");
  await ctx.reply(
    "Видео сохранено. Установлено авто-превью (первый кадр).",
    Markup.inlineKeyboard([[Markup.button.webApp("🎞 Открыть комнату", `${BASE_URL}/miniapp-3d/?roomId=${state.roomId}`)]])
  );
});

bot.on(["video", "photo"], async (ctx) => {
  const user = await getOrCreateUser(ctx.from || {});
  const state = userFlowState.get(user.id);
  const roomId =
    state?.step === "await_memory_content" || state?.step === "await_video_preview" ? state.roomId : null;
  const activeRoom = roomId ? { id: roomId, title: null } : await getActiveRoom(user.id);
  if (!activeRoom) {
    await ctx.reply("Сначала выберите комнату в «Мои комнаты».");
    return;
  }
  const membership = await getMembership(user.id, activeRoom.id);
  if (!membership || !roleCanWrite(membership.role)) {
    await ctx.reply("У вас нет прав добавлять воспоминания в эту комнату.");
    return;
  }

  if (state?.step === "await_video_preview") {
    if (!ctx.message.photo) {
      await ctx.reply("Сейчас ожидается фото для превью. Отправьте фото или нажмите «Авто-превью».");
      return;
    }
    const previewFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    await saveMemory({
      roomId: state.roomId,
      authorUserId: user.id,
      color: state.color,
      note: state.note,
      mediaType: "video",
      fileId: state.videoFileId,
      previewFileId
    });
    userFlowState.delete(user.id);
    await ctx.reply(
      "Видео сохранено. Использовано ваше превью.",
      Markup.inlineKeyboard([
        [Markup.button.webApp("🎞 Открыть комнату", `${BASE_URL}/miniapp-3d/?roomId=${state.roomId}`)]
      ])
    );
    return;
  }

  const caption = ctx.message.caption || "";
  const parsed = parseCaption(caption);
  const color = state?.step === "await_memory_content" ? state.color : parsed.color || "yellow";

  let mediaType = "video";
  let fileId = "";
  let autoPreviewFileId = null;

  if (ctx.message.video) {
    mediaType = "video";
    fileId = ctx.message.video.file_id;
    autoPreviewFileId = ctx.message.video.thumbnail?.file_id || null;
  } else if (ctx.message.photo) {
    mediaType = "photo";
    fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  }

  if (mediaType === "video") {
    userFlowState.set(user.id, {
      step: "await_video_preview",
      roomId: activeRoom.id,
      color,
      note: parsed.note || "",
      videoFileId: fileId,
      autoPreviewFileId
    });
    await ctx.reply(
      "Видео получено. Добавьте превью или выберите авто-превью (первый кадр).",
      Markup.inlineKeyboard([
        [Markup.button.callback("🖼 Добавить превью", "video_preview_add")],
        [Markup.button.callback("⚡ Авто-превью (первый кадр)", "video_preview_auto")]
      ])
    );
    return;
  }

  await saveMemory({
    roomId: activeRoom.id,
    authorUserId: user.id,
    color,
    note: parsed.note || "",
    mediaType,
    fileId
  });
  if (state?.step === "await_memory_content") {
    userFlowState.delete(user.id);
  }

  await ctx.reply(
    `Воспоминание сохранено (${colorLabel(color)}).`,
    Markup.inlineKeyboard([[Markup.button.webApp("🎞 Открыть комнату", `${BASE_URL}/miniapp-3d/?roomId=${activeRoom.id}`)]])
  );
});

bot.on("text", async (ctx) => {
  const value = (ctx.message.text || "").trim();
  if (value.startsWith("/")) return;
  const user = await getOrCreateUser(ctx.from || {});
  const state = userFlowState.get(user.id);

  if (state?.step === "await_video_preview") {
    await ctx.reply("Для этого видео ожидается превью. Отправьте фото или нажмите «Авто-превью (первый кадр)».");
    return;
  }

  if (state?.step === "await_room_name") {
    if (value.length < 2 || value.length > 60) {
      await ctx.reply("Название должно быть от 2 до 60 символов. Попробуйте ещё раз.");
      return;
    }
    try {
      await createRoom(user.id, value);
      userFlowState.delete(user.id);
      await ctx.reply(`Комната «${value}» создана.`);
      await showRooms(ctx, user);
    } catch (error) {
      if (error.message === "LIMIT_10_ROOMS") {
        await ctx.reply("Достигнут лимит: максимум 10 комнат.");
        return;
      }
      if (error.message === "ROOM_NAME_EXISTS") {
        await ctx.reply("Комната с таким названием уже есть. Введите другое название.");
        return;
      }
      throw error;
    }
    return;
  }

  const roomId = state?.step === "await_memory_content" ? state.roomId : null;
  const activeRoom = roomId ? { id: roomId, title: null } : await getActiveRoom(user.id);
  if (!activeRoom) {
    await ctx.reply("Сначала выберите комнату в «Мои комнаты».");
    return;
  }
  const membership = await getMembership(user.id, activeRoom.id);
  if (!membership || !roleCanWrite(membership.role)) {
    await ctx.reply("У вас нет прав добавлять воспоминания в эту комнату.");
    return;
  }
  const parsed = parseCaption(value);
  const color = state?.step === "await_memory_content" ? state.color : parsed.color || "yellow";
  await saveMemory({
    roomId: activeRoom.id,
    authorUserId: user.id,
    color,
    note: parsed.note || value,
    mediaType: "text",
    fileId: ""
  });
  userFlowState.delete(user.id);
  await ctx.reply(
    `Текстовое воспоминание сохранено (${colorLabel(color)}).`,
    Markup.inlineKeyboard([[Markup.button.webApp("🎞 Открыть комнату", `${BASE_URL}/miniapp-3d/?roomId=${activeRoom.id}`)]])
  );
});

const MINIAPP_DIR = path.join(__dirname, "miniapp");
app.use("/miniapp", express.static(MINIAPP_DIR));
app.get("/miniapp", (req, res) => {
  res.sendFile(path.join(MINIAPP_DIR, "index.html"));
});
app.get("/miniapp/", (req, res) => {
  res.sendFile(path.join(MINIAPP_DIR, "index.html"));
});

// 3D Mini App (built Vite output served from miniapp-3d-dist)
const MINIAPP3D_DIR = path.join(__dirname, "miniapp-3d-dist");
if (fs.existsSync(MINIAPP3D_DIR)) {
  app.use("/miniapp-3d", express.static(MINIAPP3D_DIR));
  // Сцена: miniapp-3d-dist/1res_08042026.glb (из miniapp-3d/public при сборке)
  // SPA fallback — serve index.html for all /miniapp-3d/* routes
  app.get("/miniapp-3d/*", (req, res) => {
    res.sendFile(path.join(MINIAPP3D_DIR, "index.html"));
  });
}

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
    `SELECT id, color, note, media_type, created_at, file_id, preview_file_id
     FROM memories
     WHERE room_id = $1
     ORDER BY created_at DESC
     LIMIT 300`,
    [roomId]
  );

  const memories = await Promise.all(
    result.rows.map(async (m) => {
      const previewFileId = m.preview_file_id || (m.media_type === "photo" ? m.file_id : null);
      const previewUrl =
        previewFileId != null
          ? `/api/memory/${encodeURIComponent(m.id)}/preview?telegramId=${encodeURIComponent(telegramId)}`
          : null;
      return {
        id: m.id,
        color: m.color,
        note: m.note,
        mediaType: m.media_type,
        previewUrl,
        createdAt: m.created_at
      };
    })
  );

  return res.json({ memories });
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

  // Same-origin URL so WebGL (TextureLoader / VideoTexture) can sample without CORS tainting.
  const mediaUrl = `/api/memory/${encodeURIComponent(memory.id)}/media?telegramId=${encodeURIComponent(telegramId)}`;
  return res.json({
    mediaType: memory.media_type,
    url: mediaUrl,
    note: memory.note
  });
});

/** Stream Telegram file through our origin — required for Three.js textures in the mini app. */
app.get("/api/memory/:id/media", async (req, res) => {
  const telegramId = String(req.query.telegramId || "");
  if (!telegramId) return res.status(400).json({ error: "telegramId is required" });
  const user = await getUserByTelegramId(telegramId);
  if (!user) return res.status(403).json({ error: "Forbidden" });

  const result = await pool.query("SELECT * FROM memories WHERE id = $1", [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Memory not found" });
  const memory = result.rows[0];
  const member = await getMembership(user.id, memory.room_id);
  if (!member) return res.status(403).json({ error: "Forbidden" });

  if (memory.media_type === "text" || !memory.file_id) {
    return res.status(400).json({ error: "No media file" });
  }

  try {
    const link = await bot.telegram.getFileLink(memory.file_id);
    const upstream = await fetch(link.href);
    if (!upstream.ok) {
      return res.status(502).json({ error: "Upstream fetch failed" });
    }
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (!upstream.body) {
      return res.status(502).json({ error: "Empty body" });
    }
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ error: "Media stream failed" });
    }
  }
});

/** Preview thumbnail / photo for shelf orbs — same-origin for WebGL TextureLoader. */
app.get("/api/memory/:id/preview", async (req, res) => {
  const telegramId = String(req.query.telegramId || "");
  if (!telegramId) return res.status(400).json({ error: "telegramId is required" });
  const user = await getUserByTelegramId(telegramId);
  if (!user) return res.status(403).json({ error: "Forbidden" });

  const result = await pool.query("SELECT * FROM memories WHERE id = $1", [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Memory not found" });
  const memory = result.rows[0];
  const member = await getMembership(user.id, memory.room_id);
  if (!member) return res.status(403).json({ error: "Forbidden" });

  const previewFileId = memory.preview_file_id || (memory.media_type === "photo" ? memory.file_id : null);
  if (!previewFileId) return res.status(404).json({ error: "No preview" });

  try {
    const link = await bot.telegram.getFileLink(previewFileId);
    const upstream = await fetch(link.href);
    if (!upstream.ok) {
      return res.status(502).json({ error: "Upstream fetch failed" });
    }
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (!upstream.body) {
      return res.status(502).json({ error: "Empty body" });
    }
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ error: "Preview stream failed" });
    }
  }
});

app.patch("/api/memory/:id", async (req, res) => {
  const telegramId = String(req.query.telegramId || "");
  const note = String(req.body.note || "").trim();
  if (!telegramId) return res.status(400).json({ error: "telegramId is required" });
  if (note.length > 1200) return res.status(400).json({ error: "note is too long" });
  const user = await getUserByTelegramId(telegramId);
  if (!user) return res.status(403).json({ error: "Forbidden" });

  const result = await pool.query("SELECT * FROM memories WHERE id = $1", [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Memory not found" });
  const memory = result.rows[0];
  const member = await getMembership(user.id, memory.room_id);
  if (!member || !roleCanWrite(member.role)) return res.status(403).json({ error: "Forbidden" });

  await pool.query("UPDATE memories SET note = $1, updated_at = NOW() WHERE id = $2", [note, req.params.id]);
  return res.json({ ok: true });
});

app.delete("/api/memory/:id", async (req, res) => {
  const telegramId = String(req.query.telegramId || "");
  if (!telegramId) return res.status(400).json({ error: "telegramId is required" });
  const user = await getUserByTelegramId(telegramId);
  if (!user) return res.status(403).json({ error: "Forbidden" });

  const result = await pool.query("SELECT * FROM memories WHERE id = $1", [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Memory not found" });
  const memory = result.rows[0];
  const member = await getMembership(user.id, memory.room_id);
  if (!member || !roleCanWrite(member.role)) return res.status(403).json({ error: "Forbidden" });

  await pool.query("DELETE FROM memories WHERE id = $1", [req.params.id]);
  return res.json({ ok: true });
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
