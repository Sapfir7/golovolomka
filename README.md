# Golovolomka Memory Bot

Telegram bot + Mini App with rooms and role-based access:
- room model (family/friends/etc), up to 10 owner rooms
- invite links with permission (`viewer` or `editor`)
- room-based memories with colored balls UI
- PostgreSQL storage (reliable for production)

## 1) Ustanovka

```bash
npm install
```

## 2) Nastroika

1. Sozday `.env` po primeru `.env.example`
2. Zapolni:
   - `BOT_TOKEN` - token bota iz BotFather
   - `BASE_URL` - public URL, naprimer `https://your-domain.com`
   - `DATABASE_URL` - postgres connection string
   - `PORT` - po umolchaniyu `3000`

> Dlya Telegram WebApp nuzhen dostupnyy iz interneta URL (https). Lokalno mozhno testit cherez tunnel (ngrok/cloudflared).

## 3) Zapusk

```bash
npm start
```

## 4) Komandy bota

- `/room_create Family`
- `/rooms`
- `/room_use ROOM_ID`
- `/room_invite viewer` или `/room_invite editor`
- `/room_members`
- `/room_role TELEGRAM_ID viewer|editor` (owner only)

Для добавления воспоминаний отправляй видео/фото/текст в активную комнату.
Подпись можно задавать в формате: `yellow|Nasha progulka`.

## Primichaniya

- Mini App показывает только комнаты текущего пользователя.
- На Render Free возможен cold start.
