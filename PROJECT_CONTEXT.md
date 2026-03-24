# Project Context (Golovolomka)

## What this project is
- Telegram bot + Telegram Mini App for shared "memory balls".
- Users send photo/video/text to bot.
- Mini App shows colored balls; click a ball to open memory playback.

## Current stack
- Backend: `Node.js + Express + Telegraf`
- Frontend Mini App: static HTML/CSS/JS in `miniapp/`
- Storage: local JSON file `data/memories.json` (MVP only)
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
- `PORT`: provided by Render (`10000` on free plan is typical).
- `HOST` (optional): defaults to `0.0.0.0`.

## Current bot behavior
- `/start` sends one WebApp button: `Otkryt biblioteku (WebApp)`.
- `/miniapp` returns direct link to mini app (text + URL button).
- Media caption format for color tagging: `color|note`
  - Allowed colors: `yellow`, `blue`, `red`, `green`, `purple`.

## Known MVP limitations
- JSON storage is ephemeral on Render free instances (disk not durable).
- No auth model for shared private libraries yet.
- No pagination, no deletion/editing memories.
- No permanent media storage (uses Telegram `file_id` only).

## Why white screen / not found happened before
- Wrong `BASE_URL` domain in env.
- Telegram client cached old button message.
- Render cold start latency (free tier).

## Next recommended upgrade path
1. Move metadata from JSON to PostgreSQL.
2. Add libraries + invites + members tables.
3. Add role-based permissions.
4. Add optional S3/R2 media backup for long-term retention.
