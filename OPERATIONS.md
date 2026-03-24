# Operations Runbook

## Deploy checklist (Render)
1. Push code to `main`.
2. Render -> service `golovolomka-bot` -> `Manual Deploy`.
3. Confirm env:
   - `BOT_TOKEN=<active token>`
   - `BASE_URL=https://golovolomka-bot.onrender.com`
4. Wait for `Your service is live`.
5. Send `/start` to bot and test mini app open.

## BotFather checklist
- If token is exposed, rotate token:
  - `@BotFather` -> `/revoke` -> generate new token.
  - Update Render `BOT_TOKEN`.
- Set allowed domain for WebApp:
  - `@BotFather` -> `/setdomain` -> `golovolomka-bot.onrender.com`.

## Quick health checks
- Browser open:
  - `/miniapp`
  - `/api/memories`
- Render logs should contain:
  - `Server started on 0.0.0.0:<PORT>`
  - `Telegram connected as ...`
  - `Bot polling started`

## Common issues and fixes
- `EADDRINUSE` locally:
  - kill process on used port or run different local port.
- `Not Found` in Telegram:
  - check `BASE_URL` domain, redeploy, send fresh `/start`.
- White screen:
  - wait for cold start, then reopen from latest bot message.
- Render `Port scan timeout`:
  - ensure app binds to `0.0.0.0` and starts Express listener.

## Local run (for development)
```bash
npm install
npm start
```

For local Telegram testing, use a public HTTPS tunnel and set `BASE_URL` to tunnel URL.
