/**
 * App – root application component.
 *
 * Responsibilities:
 *  1. Initialize Telegram WebApp SDK (expand, set header color, theme)
 *  2. Extract `telegramId` and `initData` from Telegram context (or URL param for dev)
 *  3. Load rooms + active room memories on mount
 *  4. Render the 3D Scene + 2D UIOverlay
 */
import { useEffect } from "react";
import WebApp from "@twa-dev/sdk";
import { Scene } from "./components/Scene";
import { UIOverlay } from "./components/UIOverlay";
import { useStore } from "./store/useStore";
import { fetchRooms, fetchMemories } from "./api/client";
import "./index.css";

function getTelegramId(): string | null {
  // 1. From Telegram WebApp context (production)
  const tgUser = WebApp.initDataUnsafe?.user;
  if (tgUser?.id) return String(tgUser.id);

  // 2. From URL param (local dev / testing)
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("telegramId");
  if (fromUrl) return fromUrl;

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

  // ── Telegram SDK init ────────────────────────────────────────────────────
  useEffect(() => {
    try {
      WebApp.ready();
      WebApp.expand();
      WebApp.setBackgroundColor("#000000");
      WebApp.setHeaderColor("#000000");
    } catch {
      // Not in Telegram context — ignore
    }

    const id = getTelegramId();
    const data = typeof WebApp.initData === "string" ? WebApp.initData : "";
    if (id) {
      setAuth(id, data);
    } else {
      setError("Откройте приложение через Telegram.");
      setPhase("SHELF"); // show scene anyway in dev
    }
  }, [setAuth, setError, setPhase]);

  // ── Load rooms + memories ────────────────────────────────────────────────
  useEffect(() => {
    if (!telegramId) return;

    async function bootstrap() {
      try {
        // Load rooms
        const { rooms, activeRoomId } = await fetchRooms(telegramId!, initData);
        setRooms(rooms, activeRoomId);

        // Determine which room to show
        const urlRoomId = getRoomIdFromUrl();
        const targetRoomId = urlRoomId ?? activeRoomId ?? rooms[0]?.id ?? null;

        if (!targetRoomId) {
          setPhase("SHELF"); // empty state
          return;
        }

        if (targetRoomId !== activeRoomId) {
          setActiveRoom(targetRoomId);
        }

        // Load memories for that room
        const { memories } = await fetchMemories(telegramId!, targetRoomId, initData);
        setMemories(memories);
        setPhase("SHELF");
      } catch (e) {
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
    </div>
  );
}
