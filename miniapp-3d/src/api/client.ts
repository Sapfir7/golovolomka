import type { Memory, Playback, Room } from "../types";

// Base URL: in production the app is served from the same Express server,
// so relative paths work. In dev Vite proxies /api → localhost:3001.
const BASE = "";

function headers(initData: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    // Pass Telegram initData for future server-side verification
    Authorization: initData ? `tma ${initData}` : "",
  };
}

async function request<T>(
  url: string,
  options: RequestInit = {},
  initData = ""
): Promise<T> {
  const res = await fetch(BASE + url, {
    ...options,
    headers: { ...headers(initData), ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Rooms ──────────────────────────────────────────────────────────────────

export async function fetchRooms(
  telegramId: string,
  initData: string
): Promise<{ rooms: Room[]; activeRoomId: string | null }> {
  return request(`/api/rooms?telegramId=${encodeURIComponent(telegramId)}`, {}, initData);
}

// ─── Memories ───────────────────────────────────────────────────────────────

export async function fetchMemories(
  telegramId: string,
  roomId: string,
  initData: string
): Promise<{ memories: Memory[] }> {
  return request(
    `/api/memories?telegramId=${encodeURIComponent(telegramId)}&roomId=${encodeURIComponent(roomId)}`,
    {},
    initData
  );
}

export async function fetchPlayback(
  telegramId: string,
  memoryId: string,
  initData: string
): Promise<Playback> {
  return request(
    `/api/memory/${encodeURIComponent(memoryId)}/playback?telegramId=${encodeURIComponent(telegramId)}`,
    {},
    initData
  );
}

export async function patchMemoryNote(
  telegramId: string,
  memoryId: string,
  note: string,
  initData: string
): Promise<void> {
  await request(
    `/api/memory/${encodeURIComponent(memoryId)}?telegramId=${encodeURIComponent(telegramId)}`,
    { method: "PATCH", body: JSON.stringify({ note }) },
    initData
  );
}

export async function deleteMemory(
  telegramId: string,
  memoryId: string,
  initData: string
): Promise<void> {
  await request(
    `/api/memory/${encodeURIComponent(memoryId)}?telegramId=${encodeURIComponent(telegramId)}`,
    { method: "DELETE" },
    initData
  );
}
