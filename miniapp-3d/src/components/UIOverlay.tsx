/**
 * UIOverlay – 2D Tailwind UI layer rendered on top of the R3F canvas.
 *
 * Renders different panels based on the current scene phase:
 *  LOADING     → spinner + "Загрузка..."
 *  SHELF       → room selector + orb count badge
 *  ZOOMED      → memory info card + "Смотреть воспоминание" CTA
 *  TRANSITION  → subtle "Перемотка..." hint
 *  DESK        → projector controls (prev/next attachment, edit note, delete, back)
 *
 * Communication with the 3D scene:
 *  - "Смотреть воспоминание" fires `window.dispatchEvent(new Event("scene:watch"))`
 *  - "Назад" fires `window.dispatchEvent(new Event("scene:back"))`
 *  - Edit/Delete call API directly and update Zustand store
 */
import { useState, useRef } from "react";
import { useStore } from "../store/useStore";
import { fetchRooms, fetchMemories, patchMemoryNote, deleteMemory } from "../api/client";
import type { Room } from "../types";

// ─── Color labels (Russian) ───────────────────────────────────────────────────
const COLOR_LABELS: Record<string, string> = {
  yellow: "Радость 💛",
  blue: "Грусть 💙",
  red: "Злость ❤️",
  purple: "Тревога 💜",
};

const COLOR_BORDER: Record<string, string> = {
  yellow: "border-yellow-400",
  blue: "border-blue-400",
  red: "border-red-400",
  purple: "border-purple-400",
};

const COLOR_TEXT: Record<string, string> = {
  yellow: "text-yellow-300",
  blue: "text-blue-300",
  red: "text-red-400",
  purple: "text-purple-300",
};

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" }).format(
      new Date(iso)
    );
  } catch {
    return iso;
  }
}

export function UIOverlay() {
  const phase = useStore((s) => s.phase);
  const rooms = useStore((s) => s.rooms);
  const setRooms = useStore((s) => s.setRooms);
  const activeRoomId = useStore((s) => s.activeRoomId);
  const setActiveRoom = useStore((s) => s.setActiveRoom);
  const memories = useStore((s) => s.memories);
  const setMemories = useStore((s) => s.setMemories);
  const selectedMemoryId = useStore((s) => s.selectedMemoryId);
  const playback = useStore((s) => s.playback);
  const isLoadingPlayback = useStore((s) => s.isLoadingPlayback);
  const telegramId = useStore((s) => s.telegramId);
  const initData = useStore((s) => s.initData);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const updateMemoryNote = useStore((s) => s.updateMemoryNote);
  const removeMemory = useStore((s) => s.removeMemory);
  const setPhase = useStore((s) => s.setPhase);

  const [editMode, setEditMode] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedMemory = memories.find((m) => m.id === selectedMemoryId) ?? null;
  const activeRoom = rooms.find((r) => r.id === activeRoomId) ?? null;
  const canEdit =
    activeRoom?.role === "owner" || activeRoom?.role === "editor";

  // ── Room switch ────────────────────────────────────────────────────────────
  async function switchRoom(roomId: string) {
    if (!telegramId) return;
    setActiveRoom(roomId);
    setPhase("LOADING");
    try {
      const { memories: mems } = await fetchMemories(telegramId, roomId, initData);
      setMemories(mems);
    } catch (e) {
      setError("Не удалось загрузить воспоминания.");
    } finally {
      setPhase("SHELF");
    }
  }

  // ── Edit note ──────────────────────────────────────────────────────────────
  function startEdit() {
    setEditValue(selectedMemory?.note ?? "");
    setEditMode(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  async function saveEdit() {
    if (!telegramId || !selectedMemoryId) return;
    setIsSaving(true);
    try {
      await patchMemoryNote(telegramId, selectedMemoryId, editValue, initData);
      updateMemoryNote(selectedMemoryId, editValue);
      setEditMode(false);
    } catch {
      setError("Не удалось сохранить изменения.");
    } finally {
      setIsSaving(false);
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!telegramId || !selectedMemoryId) return;
    if (!window.confirm("Удалить это воспоминание?")) return;
    setIsDeleting(true);
    try {
      await deleteMemory(telegramId, selectedMemoryId, initData);
      removeMemory(selectedMemoryId);
      window.dispatchEvent(new Event("scene:back"));
    } catch {
      setError("Не удалось удалить воспоминание.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="absolute inset-0 pointer-events-none z-10 flex flex-col">
      {/* ── Error toast ─────────────────────────────────────────────────── */}
      {error && (
        <div className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 bg-red-900/90 text-red-100 px-5 py-2 rounded-full text-sm shadow-lg">
          {error}
          <button className="ml-3 opacity-60 hover:opacity-100" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      {/* ── LOADING phase ───────────────────────────────────────────────── */}
      {phase === "LOADING" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-blue-200 text-sm tracking-widest uppercase">Загрузка воспоминаний</p>
          </div>
        </div>
      )}

      {/* ── SHELF phase — room selector (top bar) ───────────────────────── */}
      {(phase === "SHELF" || phase === "ZOOMED") && rooms.length > 0 && (
        <div className="pointer-events-auto px-4 pt-4 pb-2 flex items-center gap-2">
          <span className="text-white/40 text-xs uppercase tracking-wider">Комната:</span>
          <select
            value={activeRoomId ?? ""}
            onChange={(e) => switchRoom(e.target.value)}
            className="bg-black/50 border border-white/20 text-white text-sm rounded-lg px-3 py-1.5 backdrop-blur-md outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            {rooms.map((r: Room) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
          <span className="ml-auto text-white/30 text-xs">
            {memories.length} воспоминани{memories.length === 1 ? "е" : memories.length < 5 ? "я" : "й"}
          </span>
        </div>
      )}

      {/* ── SHELF phase — empty state ────────────────────────────────────── */}
      {phase === "SHELF" && memories.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-white/40 text-sm px-8">
            <div className="text-4xl mb-3">✨</div>
            <p>В этой комнате пока нет воспоминаний.</p>
            <p className="mt-1 text-xs">Добавь первое через бота!</p>
          </div>
        </div>
      )}

      {/* ── ZOOMED phase — memory info card ─────────────────────────────── */}
      {phase === "ZOOMED" && selectedMemory && (
        <div className="absolute bottom-0 left-0 right-0 pointer-events-auto">
          <div className="mx-4 mb-6 rounded-2xl bg-black/70 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden">
            <div
              className={`h-1 w-full ${
                selectedMemory.color === "yellow"
                  ? "bg-yellow-400"
                  : selectedMemory.color === "blue"
                    ? "bg-blue-400"
                    : selectedMemory.color === "red"
                      ? "bg-red-500"
                      : "bg-purple-500"
              }`}
            />
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-medium uppercase tracking-wider ${COLOR_TEXT[selectedMemory.color]}`}>
                  {COLOR_LABELS[selectedMemory.color] ?? selectedMemory.color}
                </span>
                <span className="text-white/30 text-xs">{formatDate(selectedMemory.createdAt)}</span>
              </div>
              {selectedMemory.note && (
                <p className="text-white/80 text-sm leading-relaxed mb-4 line-clamp-3">
                  {selectedMemory.note}
                </p>
              )}
              <button
                onClick={() => window.dispatchEvent(new Event("scene:watch"))}
                className={`w-full py-3 rounded-xl font-semibold text-sm tracking-wide transition-all duration-200 active:scale-95 ${
                  selectedMemory.color === "yellow"
                    ? "bg-yellow-500 hover:bg-yellow-400 text-black"
                    : selectedMemory.color === "blue"
                      ? "bg-blue-600 hover:bg-blue-500 text-white"
                      : selectedMemory.color === "red"
                        ? "bg-red-600 hover:bg-red-500 text-white"
                        : "bg-purple-600 hover:bg-purple-500 text-white"
                }`}
              >
                🎞 Смотреть воспоминание
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TRANSITION phase — subtle hint ──────────────────────────────── */}
      {phase === "TRANSITION" && (
        <div className="absolute inset-0 flex items-end justify-center pb-10 pointer-events-none">
          <p className="text-white/40 text-xs tracking-widest uppercase animate-pulse">
            Перемещение воспоминания...
          </p>
        </div>
      )}

      {/* ── DESK phase — projector controls ─────────────────────────────── */}
      {phase === "DESK" && (
        <div className="absolute bottom-0 left-0 right-0 pointer-events-auto">
          <div className="mx-4 mb-6 rounded-2xl bg-black/75 backdrop-blur-xl border border-white/10 shadow-2xl">
            {/* Loading playback indicator */}
            {isLoadingPlayback && (
              <div className="flex justify-center py-4">
                <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Playback note / text content */}
            {!isLoadingPlayback && playback && (
              <div className="px-5 pt-4">
                {/* Video playback (HTML video element shown above canvas) */}
                {playback.mediaType === "video" && playback.url && (
                  <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black mb-3">
                    <video
                      src={playback.url}
                      controls
                      autoPlay
                      playsInline
                      className="w-full h-full object-contain"
                    />
                  </div>
                )}

                {/* Note / caption */}
                {!editMode && (
                  <p className="text-white/70 text-sm leading-relaxed min-h-[2rem] mb-3">
                    {playback.note || selectedMemory?.note || (
                      <span className="italic text-white/30">Без описания</span>
                    )}
                  </p>
                )}

                {/* Edit textarea */}
                {editMode && (
                  <div className="mb-3">
                    <textarea
                      ref={textareaRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      maxLength={1200}
                      rows={3}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-white text-sm resize-none outline-none focus:ring-2 focus:ring-blue-500/50"
                      placeholder="Описание воспоминания..."
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={saveEdit}
                        disabled={isSaving}
                        className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-all"
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

            {/* ── Action buttons row ──────────────────────────────────── */}
            <div className="flex gap-2 px-4 pb-4 pt-1">
              {/* Back button */}
              <button
                onClick={() => window.dispatchEvent(new Event("scene:back"))}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all active:scale-95"
              >
                ← Назад
              </button>

              <div className="flex-1" />

              {/* Edit button (owner/editor only) */}
              {canEdit && !editMode && (
                <button
                  onClick={startEdit}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all active:scale-95"
                >
                  ✏️ Изменить
                </button>
              )}

              {/* Delete button (owner/editor only) */}
              {canEdit && (
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-red-800/60 hover:bg-red-700/80 disabled:opacity-50 text-red-200 rounded-xl text-sm font-medium transition-all active:scale-95"
                >
                  {isDeleting ? "..." : "🗑 Удалить"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
