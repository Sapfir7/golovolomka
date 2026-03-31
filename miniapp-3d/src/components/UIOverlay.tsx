import { useMemo, useState } from "react";
import { useStore } from "../store/useStore";
import { fetchMemories } from "../api/client";
import { awaitPreviewLoads, preloadAllPreviews } from "../previewTextureCache";

export function UIOverlay() {
  const phase = useStore((s) => s.phase);
  const rooms = useStore((s) => s.rooms);
  const activeRoomId = useStore((s) => s.activeRoomId);
  const setActiveRoom = useStore((s) => s.setActiveRoom);
  const memories = useStore((s) => s.memories);
  const setMemories = useStore((s) => s.setMemories);
  const selectedMemoryId = useStore((s) => s.selectedMemoryId);
  const telegramId = useStore((s) => s.telegramId);
  const initData = useStore((s) => s.initData);
  const setPhase = useStore((s) => s.setPhase);
  const isLoadingPlayback = useStore((s) => s.isLoadingPlayback);

  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => memories.find((m) => m.id === selectedMemoryId) ?? null,
    [memories, selectedMemoryId]
  );

  const switchRoom = async (roomId: string) => {
    if (!telegramId) return;
    setPhase("LOADING");
    setActiveRoom(roomId);
    try {
      const data = await fetchMemories(telegramId, roomId, initData);
      const previewUrls = data.memories.map((m) => m.previewUrl);
      preloadAllPreviews(previewUrls);
      await awaitPreviewLoads(previewUrls, { timeoutMs: 12_000, minWaitMs: 450 });
      setMemories(data.memories);
      setPhase("SHELF");
    } catch {
      setError("Не удалось загрузить комнату.");
      setPhase("SHELF");
    }
  };

  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      {error && (
        <div className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-xs bg-red-900/90 text-red-100">
          {error}
          <button type="button" className="ml-2" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      {(phase === "SHELF" || phase === "ZOOMED") && (
        <div className="pointer-events-auto absolute top-3 left-3 right-3 flex gap-2">
          <select
            className="flex-1 bg-black/55 text-white text-sm rounded-lg px-3 py-2 border border-white/10"
            value={activeRoomId ?? ""}
            onChange={(e) => switchRoom(e.target.value)}
          >
            {rooms.map((r) => (
              <option value={r.id} key={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {phase === "ZOOMED" && selected && (
        <div className="pointer-events-auto absolute left-3 right-3 bottom-5 rounded-2xl border border-white/10 bg-black/70 backdrop-blur-lg p-4">
          <div className="text-xs text-white/60 mb-2">Воспоминание</div>
          <div className="text-sm text-white/85 mb-4 line-clamp-3">{selected.note || "Без описания"}</div>
          <button
            type="button"
            className="w-full py-3 rounded-xl bg-violet-600/90 hover:bg-violet-500 text-white text-sm font-medium"
            onClick={() => window.dispatchEvent(new Event("scene:watch"))}
          >
            Посмотреть воспоминание
          </button>
        </div>
      )}

      {phase === "DESK" && (
        <div className="pointer-events-auto absolute left-3 right-3 bottom-5 flex flex-col gap-3">
          {isLoadingPlayback && (
            <div className="text-center text-xs text-white/50">Загрузка…</div>
          )}
          <button
            type="button"
            className="w-full py-3 rounded-xl bg-white/12 hover:bg-white/18 border border-white/15 text-white text-sm font-medium"
            onClick={() => window.dispatchEvent(new Event("scene:back"))}
          >
            Вернуться назад
          </button>
        </div>
      )}
    </div>
  );
}
