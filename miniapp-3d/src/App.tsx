/**
 * App – root application component.
 *
 * Responsibilities:
 *  1. Initialize Telegram WebApp SDK (expand, set header color, theme)
 *  2. Extract `telegramId` and `initData` from Telegram context (or URL param for dev)
 *  3. Load rooms + active room memories on mount
 *  4. Show loading screen until GLB scene + preview textures are ready
 *  5. Render the 3D Scene + 2D UIOverlay
 */
import { useEffect } from "react";
import WebApp from "@twa-dev/sdk";
import { Scene } from "./components/Scene";
import { UIOverlay } from "./components/UIOverlay";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { useStore } from "./store/useStore";
import { fetchRooms, fetchMemories } from "./api/client";
import { awaitPreviewLoads, preloadAllPreviews } from "./previewTextureCache";
import "./index.css";

function getTelegramId(): string | null {
  const tgUser = WebApp.initDataUnsafe?.user;
  if (tgUser?.id) return String(tgUser.id);

  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("telegramId");
  if (fromUrl) return fromUrl;

  const devId = import.meta.env.VITE_DEV_TELEGRAM_ID;
  if (import.meta.env.DEV && devId) return String(devId);

  return null;
}

function getRoomIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("roomId");
}

export default function App() {
  const setAuth = useStore((s) => s.setAuth);
  const telegramId = useStore((s) => s.telegramId);
  const initData = useStore((s) => s.initData);
  const setRooms = useStore((s) => s.setRooms);
  const setActiveRoom = useStore((s) => s.setActiveRoom);
  const setMemories = useStore((s) => s.setMemories);
  const setPhase = useStore((s) => s.setPhase);
  const setError = useStore((s) => s.setError);

  useEffect(() => {
    try {
      WebApp.ready();
      WebApp.expand();
      WebApp.setBackgroundColor("#000000");
      WebApp.setHeaderColor("#000000");
    } catch {
      // Not in Telegram context
    }

    const id = getTelegramId();
    const data = typeof WebApp.initData === "string" ? WebApp.initData : "";
    if (id) {
      setAuth(id, data);
    } else {
      setError("Откройте из Telegram или укажите ?telegramId=… / VITE_DEV_TELEGRAM_ID для браузера.");
      setPhase("SHELF");
    }
  }, [setAuth, setError, setPhase]);

  useEffect(() => {
    if (!telegramId) return;

    async function bootstrap() {
      try {
        const { rooms, activeRoomId } = await fetchRooms(telegramId!, initData);
        setRooms(rooms, activeRoomId);

        const urlRoomId = getRoomIdFromUrl();
        const targetRoomId = urlRoomId ?? activeRoomId ?? rooms[0]?.id ?? null;

        if (!targetRoomId) {
          setPhase("SHELF");
          return;
        }

        if (targetRoomId !== activeRoomId) {
          setActiveRoom(targetRoomId);
        }

        const { memories } = await fetchMemories(telegramId!, targetRoomId, initData);
        const previewUrls = memories.map((m) => m.previewUrl);
        preloadAllPreviews(previewUrls);
        await awaitPreviewLoads(previewUrls, { timeoutMs: 15_000, minWaitMs: 600 });
        setMemories(memories);
        setPhase("SHELF");
      } catch {
        setError("Ошибка загрузки данных.");
        setPhase("SHELF");
      }
    }

    bootstrap();
  }, [telegramId, initData, setRooms, setActiveRoom, setMemories, setPhase, setError]);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <Scene />
      <UIOverlay />
      <LoadingOverlay />
    </div>
  );
}
