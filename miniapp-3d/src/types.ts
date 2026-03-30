// ─── Domain types mirroring backend DB schema ─────────────────────────────

export type MemoryColor = "yellow" | "blue" | "red" | "purple";
export type MediaType = "video" | "photo" | "text";
export type Role = "owner" | "editor" | "viewer";

export interface Room {
  id: string;
  title: string;
  role: Role;
}

/** Lightweight summary returned by GET /api/memories */
export interface Memory {
  id: string;
  color: MemoryColor;
  note: string | null;
  mediaType: MediaType;
  previewUrl?: string | null;
  createdAt: string;
}

/** Full playback payload returned by GET /api/memory/:id/playback */
export interface Playback {
  mediaType: MediaType;
  url?: string;
  note?: string;
}

// ─── Scene phase FSM ────────────────────────────────────────────────────────

/** The 5 phases of the UI as a finite state machine */
export type ScenePhase =
  | "LOADING"   // fetching data, initializing
  | "SHELF"     // idle, browsing the shelf
  | "ZOOMED"    // camera zoomed to a single orb, "Watch" button visible
  | "TRANSITION"// tractor beam flying the orb to desk
  | "DESK";     // projector mode, reading memory

// ─── Shelf layout ───────────────────────────────────────────────────────────

/** 3-D position assigned to each orb once memories are loaded */
export interface OrbSlot {
  memoryId: string;
  position: [number, number, number];
  shelfIndex: number; // 0-based row on the shelf
}
