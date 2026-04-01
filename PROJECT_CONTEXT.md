# Project Context (Golovolomka)

## What this project is
- Telegram bot + Telegram Mini App for shared "memory balls".
- Users create rooms, invite others with role-based access, and add memories.
- Mini App shows colored balls per selected room, with media playback and moderation actions.
- **3D Mini App** (`miniapp-3d/`): React Three Fiber scene with shelf → zoom → projector flow; **сейчас целимся в телефон** (портрет, маркеры `*_Mobile` в GLB). Отдельная десктоп-развёртка (`Plane_desktope`, `Cam*_Desktop`) запланирована позже.

## Current stack
- Backend: `Node.js + Express + Telegraf`
- Frontend Mini App (legacy): static HTML/CSS/JS in `miniapp/`
- **3D Mini App**: Vite + React + R3F in `miniapp-3d/`, production build in `miniapp-3d-dist/`, served under `/miniapp-3d/`
- Storage: PostgreSQL (`DATABASE_URL`)
- Deploy: Render Web Service

## 3D scene and assets
- **Файл сцены:** `miniapp-3d/public/temp2.glb` (glTF Binary: геометрия, встроенные текстуры, расширения вроде **`KHR_lights_punctual`**, `KHR_materials_*`). После `npm run build` копируется в `miniapp-3d-dist/temp2.glb`, URL **`/miniapp-3d/temp2.glb`**. Загрузка: `useGLTF(SCENE_MODEL_URL)` в `Scene.tsx`, затем `scene.clone(true)` без подмены материалов из кода.
- **Имена объектов (Blender → GLB):** слоты **`Slot00`…`Slot09`**; экран **`Erkan`**; камеры-ноды **`Camera.001`** (режим полки) и **`Camera`** (режим стола/проектора) — задаются константами **`GLTF_CAMERA_NODE_SHELF`** / **`GLTF_CAMERA_NODE_DESK`**; при перепутанных ролях в Blender поменять строки местами. Точка «посадки» шара у проектора: **`pos_final`** / **`Pos_final`**, иначе центр **`Erkan`**. Траектория шара: **`Temp1` → `Temp2` → `Temp3`** (в рендере скрыты). Средняя точка дуги камеры полка→стол: **`Cam_temp`** / **`cam_temp`** (тоже скрыт, только позиция).
- **Камера в коде:** позиция/«куда смотреть» для кадров берутся из GLB: `cameraFraming` — мировая позиция камеры + направление как **локальный −Z**, развёрнутый кватернионом ноды (`getWorldQuaternion` × `(0,0,-1)`). Стартовые `Canvas` **`INITIAL_CAMERA_POSITION`** / **`INITIAL_CAMERA_FOV`** синхронизированы с **`Camera.001`** в текущем temp2 (при смене GLB при необходимости обновить). FOV/near/far активной камеры подтягиваются с камеры полки (`camShelf`).
- **Свет в GLB (пример temp2):** в файле **`Spot.001`** (spot) и **`Sun`** (directional); в экспорте у spot часто **`intensity: 0`**, у Sun очень мало (~0.04 lx). Функция **`applyTemp2LightTuning`**: если spot **`intensity < 0.02`** → выставить **38 cd**; если directional **`intensity < 0.12 lx`** → **1.35 lx** (константы `TUNED_*`, пороги `SPOT_*` / `DIRECTIONAL_*`). Иначе значения из GLB не трогаются. Отдельных ambient/hemisphere в сцене нет.
- **Постобработка:** **`toneMappingExposure: 0.92`**, **`ACESFilmicToneMapping`** на `Canvas`. **`DeskVignette`** — только в режиме стола (UI), не часть GLB.
- Дополнительные точки камеры через код: `miniapp-3d/src/cameraPath.ts` (`SHELF_TO_DESK_WAYPOINTS`) — Catmull–Rom, если массив не пуст.
- Превью на шарах: `previewTextureCache.ts` (canvas + EXIF), перед `SHELF` — `awaitPreviewLoads`.
- Ранее использовались `gol_v3_2.glb` и отдельный экспорт `temp7.gltf`+`temp7.bin` — **не актуально**; в `blender/` может лежать старый `.blend` (не обязателен для деплоя).

## Key files
- `server.js` - bot handlers, API routes, mini app static routes (`/miniapp-3d` → `miniapp-3d-dist`), startup logic.
- `miniapp/index.html` - legacy UI shell.
- `miniapp/app.js` - legacy fetch rooms/memories, render balls.
- `miniapp-3d/src/components/Scene.tsx` - 3D сцена, камера, проектор, слоты.
- `miniapp-3d/src/components/MemoryOrb.tsx` - шары с превью.
- `render.yaml` - Render blueprint config.

## Runtime environment variables
- `BOT_TOKEN` (required): Telegram bot token.
- `BASE_URL` (required in production): public HTTPS service URL (without trailing slash).
  - Example: `https://golovolomka-bot.onrender.com`
- `DATABASE_URL` (required): Postgres connection string.
- `PORT`: provided by Render (`10000` on free plan is typical).
- `HOST` (optional): defaults to `0.0.0.0`.
- `BOT_USERNAME` (optional): used for invite links fallback if `getMe()` is unavailable.

## Current bot behavior
- `/start` shows one main button: `Мои комнаты`.
- `Мои комнаты` opens list of rooms and button `Добавить комнату`.
- Room click opens action buttons:
  - `Добавить воспоминание`
  - `Пригласить для просмотра`
  - `Пригласить с редактированием`
  - `Посмотреть комнату`
- Room creation is step-based with duplicate-name validation per owner.
- Memory creation is step-based: choose color, then send media/text.
- Invite links use role assignment (`viewer` or `editor`).
- `/start` payload `join_<token>` auto-joins room and sets it active.

## Data model (high level)
- `users`: Telegram users.
- `rooms`: memory rooms.
- `room_members`: membership with roles (`owner/editor/viewer`) and invite permission.
- `invites`: tokenized join links with role assignment.
- `user_prefs`: active room per user.
- `memories`: room-bound memories (`video/photo/text`) with `updated_at`.

## API overview
- `GET /api/rooms?telegramId=...` - rooms visible to user + active room id.
- `GET /api/memories?telegramId=...&roomId=...` - list memories for room.
- `GET /api/memory/:id/playback?telegramId=...` - playback payload (video/photo/text).
- `PATCH /api/memory/:id?telegramId=...` - update note (owner/editor only).
- `DELETE /api/memory/:id?telegramId=...` - delete memory (owner/editor only).

## Known limitations
- Mini App access check uses `telegramId` from WebApp context (lightweight, not full signature verification yet).
- Edit uses browser `prompt` UI (works, but not custom modal yet).
- Media still referenced by Telegram `file_id` (no external backup).
- Invites currently expire in 30 days and are capped by `max_uses`.

## Why white screen / not found happened before
- Wrong `BASE_URL` domain in env.
- Telegram client cached old button message.
- Render cold start latency (free tier).

## Next recommended upgrade path
1. Verify Telegram `initData` signature server-side for stronger auth.
2. Replace `prompt` editor with in-app modal editor.
3. Add audit fields (`edited_by`, soft delete, restore).
4. Add optional S3/R2 media backup for long-term retention.
5. 3D: отдельный проход для десктопа (камера + плоскость проектора).
