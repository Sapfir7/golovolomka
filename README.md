# Golovolomka Memory Bot

Telegram bot + Mini App with rooms and role-based access:
- комнаты (семья/друзья и т.д.), до 10 у владельца
- инвайт-ссылки с правами (`viewer` или `editor`)
- воспоминания по комнатам в интерфейсе шариков
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

## 4) Сценарий в боте

- `/start` -> кнопка `Мои комнаты`
- в `Мои комнаты`:
  - список комнат
  - кнопка `Добавить комнату`
- после выбора комнаты:
  - `Добавить воспоминание`
  - `Пригласить для просмотра`
  - `Пригласить с редактированием`
  - `Посмотреть комнату` (миниапп сразу в этой комнате)

## Primichaniya

- Mini App показывает только комнаты текущего пользователя.
- На Render Free возможен cold start.
