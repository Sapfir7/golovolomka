# Golovolomka Memory Bot

Telegram bot + Mini App с комнатами и ролями доступа:
- комнаты (семья/друзья и т.д.), до 10 у владельца
- инвайт-ссылки с правами `viewer` (просмотр) или `editor` (редактирование)
- воспоминания по комнатам в интерфейсе шариков
- просмотр медиа по типу (`video`/`photo`/`text`)
- редактирование текста и удаление воспоминаний в mini app для `owner/editor`
- PostgreSQL storage
- 3D Mini App на React Three Fiber с сценой из Blender (`temp7/temp7.gltf` + `temp7.bin`, исходник `blender/temp7.blend`)

## 1) Установка

```bash
npm install
```

## 2) Настройка

1. Создай `.env` по примеру `.env.example`
2. Заполни:
   - `BOT_TOKEN` - токен бота из BotFather
   - `BASE_URL` - публичный URL, например `https://your-domain.com`
   - `DATABASE_URL` - строка подключения Postgres
   - `PORT` - по умолчанию `3000`

> Для Telegram WebApp нужен доступный из интернета URL (`https`). Локально можно тестировать через туннель.

## 3) Запуск

```bash
npm start
```

### Сборка 3D mini app (обязательно после изменений фронта)

```bash
cd miniapp-3d
npm install
npm run build
cd ..
```

После сборки файлы попадают в `miniapp-3d-dist/`, и сервер раздает их по пути `/miniapp-3d`.

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
- приглашенный по ссылке пользователь получает комнату в свой список

## 5) Примечания

- Mini App показывает только комнаты текущего пользователя.
- На Render Free возможен cold start.
- Сцена после сборки: `miniapp-3d-dist/temp7/temp7.gltf` и `temp7.bin` (URL `/miniapp-3d/temp7/temp7.gltf`). Исходник Blender: `blender/temp7.blend`. Слоты: `Slot00`…`Slot09`, экран `Erkan`, камеры `Camera.001` / `Camera`.
