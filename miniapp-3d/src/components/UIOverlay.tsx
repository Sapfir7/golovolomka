import { useMemo } from "react";
import { useStore } from "../store/useStore";

export function UIOverlay() {
  const phase = useStore((s) => s.phase);
  const memories = useStore((s) => s.memories);
  const selectedMemoryId = useStore((s) => s.selectedMemoryId);
  const isLoadingPlayback = useStore((s) => s.isLoadingPlayback);

  const selected = useMemo(
    () => memories.find((m) => m.id === selectedMemoryId) ?? null,
    [memories, selectedMemoryId]
  );

  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
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
