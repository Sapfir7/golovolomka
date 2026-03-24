/**
 * UIOverlay – 2D HTML/Tailwind слой поверх 3D-сцены.
 *
 * Фазы:
 *  LOADING    → спиннер
 *  SHELF      → выбор комнаты (топ-бар) + счётчик шаров
 *  ZOOMED     → карточка воспоминания + кнопка "Смотреть"
 *  TRANSITION → тихая подсказка "Перемотка..."
 *  DESK       → ОВАЛЬНАЯ ПРОЕКЦИЯ (как в мультике) + панель управления
 *
 * Проекция (DESK-фаза):
 *  - Большой элемент с border-radius 50% (эллипс)
 *  - Размер адаптируется к соотношению сторон контента
 *  - Радиальный градиент-виньетка по краям
 *  - Видео/фото/текст внутри
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "../store/useStore";
import { fetchRooms, fetchMemories, patchMemoryNote, deleteMemory } from "../api/client";
import type { Room } from "../types";

const COLOR_LABEL: Record<string, string> = {
  yellow: "Радость 💛",
  blue:   "Грусть 💙",
  red:    "Злость ❤️",
  purple: "Тревога 💜",
};

const COLOR_GLOW: Record<string, string> = {
  yellow: "rgba(255,200,50,",
  blue:   "rgba(60,180,255,",
  red:    "rgba(255,70,70,",
  purple: "rgba(180,100,255,",
};

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
  } catch { return ""; }
}

// ─── Хук: определяем aspect ratio загруженного медиа ─────────────────────────
function useContentAspect(src: string | undefined, mediaType: string | undefined) {
  const [aspect, setAspect] = useState(16 / 9);

  useEffect(() => {
    if (!src) { setAspect(16 / 9); return; }
    if (mediaType === "photo") {
      const img = new Image();
      img.onload = () => setAspect(img.naturalWidth / img.naturalHeight);
      img.src = src;
    } else if (mediaType === "video") {
      const v = document.createElement("video");
      v.onloadedmetadata = () => setAspect(v.videoWidth / v.videoHeight || 16 / 9);
      v.src = src;
    }
  }, [src, mediaType]);

  return aspect;
}

export function UIOverlay() {
  const phase             = useStore((s) => s.phase);
  const rooms             = useStore((s) => s.rooms);
  const setRooms          = useStore((s) => s.setRooms);
  const activeRoomId      = useStore((s) => s.activeRoomId);
  const setActiveRoom     = useStore((s) => s.setActiveRoom);
  const memories          = useStore((s) => s.memories);
  const setMemories       = useStore((s) => s.setMemories);
  const selectedId        = useStore((s) => s.selectedMemoryId);
  const playback          = useStore((s) => s.playback);
  const isLoadingPb       = useStore((s) => s.isLoadingPlayback);
  const telegramId        = useStore((s) => s.telegramId);
  const initData          = useStore((s) => s.initData);
  const error             = useStore((s) => s.error);
  const setError          = useStore((s) => s.setError);
  const updateNote        = useStore((s) => s.updateMemoryNote);
  const removeMemory      = useStore((s) => s.removeMemory);
  const setPhase          = useStore((s) => s.setPhase);

  const [editMode, setEditMode]     = useState(false);
  const [editValue, setEditValue]   = useState("");
  const [isSaving, setIsSaving]     = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedMemory = memories.find((m) => m.id === selectedId) ?? null;
  const activeRoom     = rooms.find((r) => r.id === activeRoomId) ?? null;
  const canEdit        = activeRoom?.role === "owner" || activeRoom?.role === "editor";

  const contentUrl    = playback?.url;
  const contentType   = playback?.mediaType;
  const contentAspect = useContentAspect(contentUrl, contentType);

  // ── Переключение комнаты ──────────────────────────────────────────────────
  const switchRoom = useCallback(async (roomId: string) => {
    if (!telegramId) return;
    setActiveRoom(roomId);
    setPhase("LOADING");
    try {
      const { memories: mems } = await fetchMemories(telegramId, roomId, initData);
      setMemories(mems);
    } catch {
      setError("Не удалось загрузить воспоминания.");
    } finally {
      setPhase("SHELF");
    }
  }, [telegramId, initData, setActiveRoom, setPhase, setMemories, setError]);

  // ── Редактирование ────────────────────────────────────────────────────────
  const startEdit = () => {
    setEditValue(selectedMemory?.note ?? playback?.note ?? "");
    setEditMode(true);
    setTimeout(() => textareaRef.current?.focus(), 60);
  };

  const saveEdit = async () => {
    if (!telegramId || !selectedId) return;
    setIsSaving(true);
    try {
      await patchMemoryNote(telegramId, selectedId, editValue, initData);
      updateNote(selectedId, editValue);
      setEditMode(false);
    } catch {
      setError("Не удалось сохранить изменения.");
    } finally {
      setIsSaving(false);
    }
  };

  // ── Удаление ──────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!telegramId || !selectedId) return;
    if (!window.confirm("Удалить это воспоминание?")) return;
    setIsDeleting(true);
    try {
      await deleteMemory(telegramId, selectedId, initData);
      removeMemory(selectedId);
      window.dispatchEvent(new Event("scene:back"));
    } catch {
      setError("Не удалось удалить воспоминание.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Цвет акцента текущего воспоминания
  const glowBase = selectedMemory ? (COLOR_GLOW[selectedMemory.color] ?? "rgba(200,150,255,") : "rgba(200,150,255,";

  return (
    <div className="absolute inset-0 pointer-events-none z-10">

      {/* ── Тост ошибки ─────────────────────────────────────────── */}
      {error && (
        <div className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 bg-red-950/90 text-red-100 px-5 py-2 rounded-full text-sm shadow-lg border border-red-700/40 backdrop-blur-md">
          {error}
          <button className="ml-3 opacity-50 hover:opacity-100" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* ── LOADING ──────────────────────────────────────────────── */}
      {phase === "LOADING" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 pointer-events-auto">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-purple-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-purple-200 text-sm tracking-widest uppercase">Загрузка</p>
          </div>
        </div>
      )}

      {/* ── SHELF / ZOOMED: топ-бар с выбором комнаты ────────────── */}
      {(phase === "SHELF" || phase === "ZOOMED") && rooms.length > 0 && (
        <div className="pointer-events-auto absolute top-0 left-0 right-0 px-4 pt-safe pt-3 pb-2 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent">
          <span className="text-white/40 text-xs uppercase tracking-wider shrink-0">Комната:</span>
          <select
            value={activeRoomId ?? ""}
            onChange={(e) => switchRoom(e.target.value)}
            className="flex-1 min-w-0 bg-black/50 border border-purple-700/40 text-white text-sm rounded-lg px-3 py-1.5 backdrop-blur-md outline-none focus:ring-2 focus:ring-purple-500/50"
          >
            {rooms.map((r: Room) => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>
          <span className="text-white/25 text-xs shrink-0">
            {memories.length} шар{memories.length === 1 ? "" : memories.length < 5 ? "а" : "ов"}
          </span>
        </div>
      )}

      {/* ── SHELF: пустое состояние ───────────────────────────────── */}
      {phase === "SHELF" && memories.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-white/35 text-sm px-10 pb-20">
            <div className="text-5xl mb-4">✨</div>
            <p>В этой комнате пока нет воспоминаний.</p>
            <p className="mt-1 text-xs opacity-70">Добавь первое через бота!</p>
          </div>
        </div>
      )}

      {/* ── ZOOMED: карточка воспоминания ────────────────────────── */}
      {phase === "ZOOMED" && selectedMemory && (
        <div className="pointer-events-auto absolute bottom-0 left-0 right-0 pb-safe pb-6 px-4">
          <div
            className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl backdrop-blur-xl"
            style={{ background: "rgba(10,0,25,0.82)" }}
          >
            {/* Цветная полоска сверху */}
            <div
              className="h-1"
              style={{ background: `linear-gradient(90deg, ${glowBase}0.9) 0%, ${glowBase}0.4) 100%)` }}
            />
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: glowBase.replace(",", "").replace("rgba", "rgb") + ")" }}>
                  {COLOR_LABEL[selectedMemory.color] ?? selectedMemory.color}
                </span>
                <span className="text-white/30 text-xs">{formatDate(selectedMemory.createdAt)}</span>
              </div>
              {selectedMemory.note && (
                <p className="text-white/75 text-sm leading-relaxed mb-4 line-clamp-3">{selectedMemory.note}</p>
              )}
              <button
                onClick={() => window.dispatchEvent(new Event("scene:watch"))}
                className="w-full py-3 rounded-xl font-semibold text-sm tracking-wide text-white transition-all duration-200 active:scale-95"
                style={{
                  background: `linear-gradient(135deg, ${glowBase}0.85) 0%, ${glowBase}0.55) 100%)`,
                  border: `1px solid ${glowBase}0.35)`,
                }}
              >
                🎞 Смотреть воспоминание
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TRANSITION: подсказка ────────────────────────────────── */}
      {phase === "TRANSITION" && (
        <div className="absolute inset-0 flex items-end justify-center pb-10">
          <p className="text-white/30 text-xs tracking-widest uppercase animate-pulse">
            Перемещение...
          </p>
        </div>
      )}

      {/* ── DESK: ОВАЛЬНАЯ ПРОЕКЦИЯ (как в Головоломке) ──────────── */}
      {phase === "DESK" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">

          {/* Загрузка playback */}
          {isLoadingPb && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-purple-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-purple-300/60 text-xs tracking-wider">Загрузка воспоминания...</p>
            </div>
          )}

          {/* Овальное окно проекции */}
          {!isLoadingPb && playback && (
            <div
              className="relative overflow-hidden"
              style={{
                // Адаптивный размер: ограничен 88vw и 72vh
                width:  `min(88vw, ${72 * contentAspect}vh)`,
                height: `min(72vh, ${88 / contentAspect}vw)`,
                borderRadius: "50%",
                // Внешнее свечение как у оригинального проектора
                boxShadow: [
                  `0 0 60px 20px ${glowBase}0.25)`,
                  `0 0 120px 40px ${glowBase}0.12)`,
                  "inset 0 0 0 2px rgba(255,255,255,0.08)",
                ].join(", "),
              }}
            >
              {/* Видео */}
              {playback.mediaType === "video" && playback.url && (
                <video
                  src={playback.url}
                  autoPlay
                  controls
                  playsInline
                  className="pointer-events-auto w-full h-full object-cover"
                  style={{ display: "block" }}
                />
              )}

              {/* Фото */}
              {playback.mediaType === "photo" && playback.url && (
                <img
                  src={playback.url}
                  alt="Воспоминание"
                  className="w-full h-full object-cover"
                  style={{ display: "block" }}
                />
              )}

              {/* Текст */}
              {playback.mediaType === "text" && (
                <div
                  className="w-full h-full flex items-center justify-center p-10"
                  style={{ background: "radial-gradient(ellipse, #2a0a4a 0%, #0f0220 100%)" }}
                >
                  <p className="text-white/90 text-center text-lg leading-relaxed font-light">
                    {playback.note || selectedMemory?.note || ""}
                  </p>
                </div>
              )}

              {/* Виньетка поверх контента — тёмные края как в мультике */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(ellipse at center, transparent 38%, rgba(8,2,18,0.55) 68%, rgba(6,0,14,0.97) 90%)",
                  pointerEvents: "none",
                }}
              />
            </div>
          )}

          {/* Описание под проекцией */}
          {!isLoadingPb && playback && (playback.note || selectedMemory?.note) && !editMode && (
            <div className="mt-5 max-w-xs text-center">
              <p className="text-white/60 text-sm leading-relaxed">
                {playback.note || selectedMemory?.note}
              </p>
            </div>
          )}

          {/* Поле редактирования */}
          {editMode && (
            <div className="pointer-events-auto mt-4 w-full max-w-sm px-4">
              <textarea
                ref={textareaRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                rows={3}
                maxLength={1200}
                className="w-full bg-black/60 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm resize-none outline-none focus:ring-2 focus:ring-purple-500/50 backdrop-blur-md"
                placeholder="Описание воспоминания..."
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={saveEdit}
                  disabled={isSaving}
                  className="flex-1 py-2 bg-purple-700/80 hover:bg-purple-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-all"
                >
                  {isSaving ? "Сохранение..." : "Сохранить"}
                </button>
                <button
                  onClick={() => setEditMode(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm transition-all"
                >
                  Отмена
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── DESK: панель управления (снизу) ──────────────────────── */}
      {phase === "DESK" && (
        <div className="pointer-events-auto absolute bottom-0 left-0 right-0 pb-safe pb-5 px-4">
          <div
            className="flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2.5"
            style={{ background: "rgba(8,2,20,0.82)", backdropFilter: "blur(16px)" }}
          >
            {/* Назад */}
            <button
              onClick={() => window.dispatchEvent(new Event("scene:back"))}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/18 text-white text-sm font-medium transition-all active:scale-95"
            >
              ← Назад
            </button>

            <div className="flex-1" />

            {/* Редактировать */}
            {canEdit && !editMode && (
              <button
                onClick={startEdit}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-900/60 hover:bg-purple-800/80 text-purple-200 text-sm font-medium transition-all active:scale-95"
              >
                ✏️ Изменить
              </button>
            )}

            {/* Удалить */}
            {canEdit && (
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-950/60 hover:bg-red-900/80 disabled:opacity-50 text-red-300 text-sm font-medium transition-all active:scale-95"
              >
                {isDeleting ? "..." : "🗑"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
