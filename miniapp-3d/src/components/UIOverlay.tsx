import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import { fetchMemories, patchMemoryNote, deleteMemory } from "../api/client";

export function UIOverlay() {
  const phase = useStore((s) => s.phase);
  const rooms = useStore((s) => s.rooms);
  const activeRoomId = useStore((s) => s.activeRoomId);
  const setActiveRoom = useStore((s) => s.setActiveRoom);
  const memories = useStore((s) => s.memories);
  const setMemories = useStore((s) => s.setMemories);
  const selectedMemoryId = useStore((s) => s.selectedMemoryId);
  const playback = useStore((s) => s.playback);
  const telegramId = useStore((s) => s.telegramId);
  const initData = useStore((s) => s.initData);
  const setPhase = useStore((s) => s.setPhase);
  const isLoadingPlayback = useStore((s) => s.isLoadingPlayback);
  const updateMemoryNote = useStore((s) => s.updateMemoryNote);
  const removeMemory = useStore((s) => s.removeMemory);
  const deskZoom = useStore((s) => s.deskZoom);
  const setDeskZoom = useStore((s) => s.setDeskZoom);
  const videoVolume = useStore((s) => s.videoVolume);
  const setVideoVolume = useStore((s) => s.setVideoVolume);

  const [edit, setEdit] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const selected = useMemo(
    () => memories.find((m) => m.id === selectedMemoryId) ?? null,
    [memories, selectedMemoryId]
  );
  const roomRole = rooms.find((r) => r.id === activeRoomId)?.role;
  const canEdit = roomRole === "owner" || roomRole === "editor";

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = videoVolume;
  }, [videoVolume, playback?.url]);

  const switchRoom = async (roomId: string) => {
    if (!telegramId) return;
    setPhase("LOADING");
    setActiveRoom(roomId);
    try {
      const data = await fetchMemories(telegramId, roomId, initData);
      setMemories(data.memories);
      setPhase("SHELF");
    } catch {
      setError("Не удалось загрузить комнату.");
      setPhase("SHELF");
    }
  };

  const onSave = async () => {
    if (!telegramId || !selectedMemoryId) return;
    setSaving(true);
    try {
      await patchMemoryNote(telegramId, selectedMemoryId, edit, initData);
      updateMemoryNote(selectedMemoryId, edit);
      setEditing(false);
    } catch {
      setError("Ошибка сохранения.");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!telegramId || !selectedMemoryId) return;
    if (!window.confirm("Удалить воспоминание?")) return;
    setDeleting(true);
    try {
      await deleteMemory(telegramId, selectedMemoryId, initData);
      removeMemory(selectedMemoryId);
      window.dispatchEvent(new Event("scene:back"));
    } catch {
      setError("Ошибка удаления.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      {error && (
        <div className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-xs bg-red-900/90 text-red-100">
          {error}
          <button className="ml-2" onClick={() => setError(null)}>x</button>
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
              <option value={r.id} key={r.id}>{r.title}</option>
            ))}
          </select>
          <div className="px-3 py-2 rounded-lg text-xs bg-black/45 text-white/70">
            {memories.length} шаров
          </div>
        </div>
      )}

      {phase === "ZOOMED" && selected && (
        <div className="pointer-events-auto absolute left-3 right-3 bottom-5 rounded-2xl border border-white/10 bg-black/70 backdrop-blur-lg p-4">
          <div className="text-xs text-white/70 mb-2">Выбрано воспоминание</div>
          <div className="text-sm text-white/90 mb-3 line-clamp-3">{selected.note || "Без описания"}</div>
          <button
            className="w-full py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold"
            onClick={() => window.dispatchEvent(new Event("scene:watch"))}
          >
            Смотреть воспоминание
          </button>
        </div>
      )}

      {phase === "DESK" && (
        <>
          <div className="absolute inset-0 flex items-center justify-center px-4 pointer-events-none">
            <div className="relative overflow-hidden pointer-events-auto" style={{ width: "min(90vw, 72vh)", height: "min(62vh, 55vw)", borderRadius: "50%" }}>
              {isLoadingPlayback && <div className="w-full h-full grid place-items-center bg-black/80 text-white/70 text-sm">Загрузка...</div>}
              {!isLoadingPlayback && playback?.mediaType === "video" && playback.url && (
                <video ref={videoRef} src={playback.url} autoPlay controls playsInline className="w-full h-full object-contain bg-black" />
              )}
              {!isLoadingPlayback && playback?.mediaType === "photo" && playback.url && (
                <img src={playback.url} alt="memory" className="w-full h-full object-contain bg-black" />
              )}
              {!isLoadingPlayback && playback?.mediaType === "text" && (
                <div className="w-full h-full grid place-items-center p-8 bg-[#12041f] text-white/90 text-center">
                  {playback.note || selected?.note || ""}
                </div>
              )}
              <div className="absolute inset-0 rounded-[50%] pointer-events-none" style={{ background: "radial-gradient(ellipse at center, transparent 35%, rgba(9,2,18,0.55) 68%, rgba(6,0,14,0.95) 94%)" }} />
            </div>
          </div>

          <div className="pointer-events-auto absolute left-3 right-3 bottom-3 space-y-2">
            <div className="rounded-xl border border-white/10 bg-black/65 backdrop-blur-md px-3 py-2 space-y-2">
              <label className="flex items-center gap-2 text-xs text-white/75">
                <span className="w-14">Камера</span>
                <input type="range" min={0} max={100} value={Math.round(deskZoom * 100)} onChange={(e) => setDeskZoom(Number(e.target.value) / 100)} className="flex-1 accent-purple-500" />
              </label>
              {playback?.mediaType === "video" && (
                <label className="flex items-center gap-2 text-xs text-white/75">
                  <span className="w-14">Звук</span>
                  <input type="range" min={0} max={100} value={Math.round(videoVolume * 100)} onChange={(e) => setVideoVolume(Number(e.target.value) / 100)} className="flex-1 accent-purple-500" />
                </label>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-black/65 backdrop-blur-md px-3 py-2 flex items-center gap-2">
              <button className="px-3 py-2 rounded-lg text-sm bg-white/10 text-white" onClick={() => window.dispatchEvent(new Event("scene:back"))}>
                Назад
              </button>
              <div className="flex-1" />
              {canEdit && !editing && (
                <button
                  className="px-3 py-2 rounded-lg text-sm bg-purple-900/70 text-purple-100"
                  onClick={() => {
                    setEdit(selected?.note || "");
                    setEditing(true);
                  }}
                >
                  Изменить
                </button>
              )}
              {canEdit && (
                <button className="px-3 py-2 rounded-lg text-sm bg-red-900/70 text-red-100" onClick={onDelete} disabled={deleting}>
                  {deleting ? "..." : "Удалить"}
                </button>
              )}
            </div>

            {editing && (
              <div className="rounded-xl border border-white/10 bg-black/65 backdrop-blur-md px-3 py-2">
                <textarea
                  rows={3}
                  maxLength={1200}
                  value={edit}
                  onChange={(e) => setEdit(e.target.value)}
                  className="w-full bg-white/10 rounded-lg p-2 text-sm text-white border border-white/10"
                />
                <div className="flex gap-2 mt-2">
                  <button className="px-3 py-2 rounded-lg text-sm bg-purple-700 text-white" onClick={onSave} disabled={saving}>
                    {saving ? "..." : "Сохранить"}
                  </button>
                  <button className="px-3 py-2 rounded-lg text-sm bg-white/10 text-white" onClick={() => setEditing(false)}>
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
