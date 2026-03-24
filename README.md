# Golovolomka Memory Bot (MVP)

Prostoy prototip:
- Telegram bot prinimaet video/photo/text
- zapisivaet "vospominaniya" v JSON
- mini app pokazyvaet shariki po cvetu
- po nazhatiyu na sharik otkryvaetsya proigryvanie

## 1) Ustanovka

```bash
npm install
```

## 2) Nastroika

1. Sozday `.env` po primeru `.env.example`
2. Zapolni:
   - `BOT_TOKEN` - token bota iz BotFather
   - `BASE_URL` - public URL, naprimer `https://your-domain.com`
   - `PORT` - po umolchaniyu `3000`

> Dlya Telegram WebApp nuzhen dostupnyy iz interneta URL (https). Lokalno mozhno testit cherez tunnel (ngrok/cloudflared).

## 3) Zapusk

```bash
npm start
```

## 4) Kak polzovatsya

1. Napishi botu `/start`
2. Otprav video/photo s podpisyu v formate:
   - `yellow|Nasha progulka`
   - dopustimye cveta: `yellow`, `blue`, `red`, `green`, `purple`
3. Nazhmi `Otkryt biblioteku`
4. Klik po shariku -> video/text v "proektore"

## Primichaniya

- Eto MVP na JSON (`data/memories.json`) bez polnoy BД.
- Dlya production rekomenduetsya PostgreSQL + object storage.
