# Project Context (Golovolomka)

## What this project is
- Telegram bot + Telegram Mini App for shared "memory balls".
- Users send photo/video/text to bot.
- Mini App shows colored balls; click a ball to open memory playback.

## Current stack
- Backend: `Node.js + Express + Telegraf`
- Frontend Mini App: static HTML/CSS/JS in `miniapp/`
- Storage: PostgreSQL (`DATABASE_URL`)
- Deploy: Render Web Service

## Key files
- `server.js` - bot handlers, API routes, mini app static routes, startup logic.
- `miniapp/index.html` - UI shell.
- `miniapp/app.js` - fetch memories, render balls, open player.
- `miniapp/styles.css` - ball visuals and projector modal animation.
- `render.yaml` - Render blueprint config.

## Runtime environment variables
- `BOT_TOKEN` (required): Telegram bot token.
- `BASE_URL` (required in production): public HTTPS service URL (without trailing slash).
  - Example: `https://golovolomka-bot.onrender.com`
- `DATABASE_URL` (required): Postgres connection string.
- `PORT`: provided by Render (`10000` on free plan is typical).
- `HOST` (optional): defaults to `0.0.0.0`.

## Current bot behavior
- `/start` sends one WebApp button: `Otkryt biblioteku (WebApp)`.
- `/miniapp` returns direct link to mini app (text + URL button).
- `/room_create <name>` creates room (owner limit: 10 rooms).
- `/rooms`, `/room_use <room_id>`, `/room_members`.
- `/room_invite viewer|editor` creates invite link with permissions.
- `/room_role <telegram_id> viewer|editor` (owner only).
- Media caption format for color tagging: `color|note`
  - Allowed colors: `yellow`, `blue`, `red`, `green`, `purple`.

## Data model (high level)
- `users`: Telegram users.
- `rooms`: memory rooms.
- `room_members`: membership with roles (`owner/editor/viewer`) and invite permission.
- `invites`: tokenized join links with role assignment.
- `user_prefs`: active room per user.
- `memories`: room-bound memories.

## Known limitations
- Mini App access check uses `telegramId` from WebApp context (lightweight, not full signature verification yet).
- No deletion/editing UI for memories yet.
- Media still referenced by Telegram `file_id` (no external backup).

## Why white screen / not found happened before
- Wrong `BASE_URL` domain in env.
- Telegram client cached old button message.
- Render cold start latency (free tier).

## Next recommended upgrade path
1. Move metadata from JSON to PostgreSQL.
2. Add libraries + invites + members tables.
3. Add role-based permissions.
4. Add optional S3/R2 media backup for long-term retention.
