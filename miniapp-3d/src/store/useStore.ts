import { create } from "zustand";
import type { Memory, Playback, Room, ScenePhase } from "../types";

interface StoreState {
  // ── Auth ────────────────────────────────────────────────────────────────
  telegramId: string | null;
  initData: string;
  setAuth: (telegramId: string, initData: string) => void;

  // ── Rooms ────────────────────────────────────────────────────────────────
  rooms: Room[];
  activeRoomId: string | null;
  setRooms: (rooms: Room[], activeRoomId: string | null) => void;
  setActiveRoom: (roomId: string) => void;

  // ── Memories (shelf contents) ────────────────────────────────────────────
  memories: Memory[];
  setMemories: (memories: Memory[]) => void;

  // ── Scene phase ──────────────────────────────────────────────────────────
  phase: ScenePhase;
  setPhase: (phase: ScenePhase) => void;

  // ── Selected orb ────────────────────────────────────────────────────────
  selectedMemoryId: string | null;
  selectMemory: (id: string | null) => void;

  // ── Playback (desk phase) ────────────────────────────────────────────────
  playback: Playback | null;
  setPlayback: (pb: Playback | null) => void;

  // ── Pagination for multi-attachment memories (future proof) ─────────────
  attachmentIndex: number;
  setAttachmentIndex: (idx: number) => void;
  nextAttachment: () => void;
  prevAttachment: () => void;

  // ── Error / loading ──────────────────────────────────────────────────────
  error: string | null;
  setError: (msg: string | null) => void;
  isLoadingPlayback: boolean;
  setLoadingPlayback: (v: boolean) => void;

  // ── Edit / delete helpers ────────────────────────────────────────────────
  removeMemory: (id: string) => void;
  updateMemoryNote: (id: string, note: string) => void;

  /** 0…1: приближение камеры к «экрану» в фазе DESK (движение вдоль луча к точке взгляда) */
  deskZoom: number;
  setDeskZoom: (v: number) => void;

  /** 0…1: громкость видео в режиме просмотра */
  videoVolume: number;
  setVideoVolume: (v: number) => void;
}

export const useStore = create<StoreState>((set, get) => ({
  // ── Auth ─────────────────────────────────────────────────────────────────
  telegramId: null,
  initData: "",
  setAuth: (telegramId, initData) => set({ telegramId, initData }),

  // ── Rooms ─────────────────────────────────────────────────────────────────
  rooms: [],
  activeRoomId: null,
  setRooms: (rooms, activeRoomId) => set({ rooms, activeRoomId }),
  setActiveRoom: (roomId) => set({ activeRoomId: roomId }),

  // ── Memories ──────────────────────────────────────────────────────────────
  memories: [],
  setMemories: (memories) => set({ memories }),

  // ── Phase ─────────────────────────────────────────────────────────────────
  phase: "LOADING",
  setPhase: (phase) => set({ phase }),

  // ── Selection ─────────────────────────────────────────────────────────────
  selectedMemoryId: null,
  selectMemory: (id) => set({ selectedMemoryId: id, attachmentIndex: 0 }),

  // ── Playback ──────────────────────────────────────────────────────────────
  playback: null,
  setPlayback: (pb) => set({ playback: pb }),

  // ── Pagination ────────────────────────────────────────────────────────────
  attachmentIndex: 0,
  setAttachmentIndex: (idx) => set({ attachmentIndex: idx }),
  nextAttachment: () => set((s) => ({ attachmentIndex: s.attachmentIndex + 1 })),
  prevAttachment: () =>
    set((s) => ({ attachmentIndex: Math.max(0, s.attachmentIndex - 1) })),

  // ── Error / loading ───────────────────────────────────────────────────────
  error: null,
  setError: (msg) => set({ error: msg }),
  isLoadingPlayback: false,
  setLoadingPlayback: (v) => set({ isLoadingPlayback: v }),

  // ── Mutations ─────────────────────────────────────────────────────────────
  removeMemory: (id) =>
    set((s) => ({ memories: s.memories.filter((m) => m.id !== id) })),
  updateMemoryNote: (id, note) =>
    set((s) => ({
      memories: s.memories.map((m) => (m.id === id ? { ...m, note } : m)),
      playback:
        s.playback && s.selectedMemoryId === id
          ? { ...s.playback, note }
          : s.playback,
    })),

  deskZoom: 0,
  setDeskZoom: (v) => set({ deskZoom: Math.min(1, Math.max(0, v)) }),

  videoVolume: 1,
  setVideoVolume: (v) => set({ videoVolume: Math.min(1, Math.max(0, v)) }),
}));
