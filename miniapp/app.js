const ballsContainer = document.getElementById("balls");
const refreshButton = document.getElementById("refreshButton");
const roomSelect = document.getElementById("roomSelect");
const roomInfo = document.getElementById("roomInfo");
const overlay = document.getElementById("playerOverlay");
const closeButton = document.getElementById("closeButton");
const video = document.getElementById("playerVideo");
const playerText = document.getElementById("playerText");
const noteText = document.getElementById("noteText");
let currentTelegramId = "";
let rooms = [];
let activeRoomId = "";

const COLOR_MAP = {
  yellow: "radial-gradient(circle at 30% 25%, #fff4b0, #ffda2f 45%, #e2b400)",
  blue: "radial-gradient(circle at 30% 25%, #bde9ff, #4cbcff 45%, #1f6ad6)",
  red: "radial-gradient(circle at 30% 25%, #ffc2c2, #ff5f5f 45%, #be1616)",
  green: "radial-gradient(circle at 30% 25%, #cbffc8, #5dd76a 45%, #2f9b39)",
  purple: "radial-gradient(circle at 30% 25%, #eccbff, #bd6aff 45%, #7132b2)"
};

function formatDate(isoDate) {
  try {
    return new Date(isoDate).toLocaleDateString();
  } catch (error) {
    return "";
  }
}

function detectTelegramId() {
  if (window.Telegram && window.Telegram.WebApp) {
    const user = window.Telegram.WebApp.initDataUnsafe?.user;
    if (user?.id) return String(user.id);
  }
  const urlUser = new URLSearchParams(window.location.search).get("telegramId");
  return urlUser || "";
}

async function loadRooms() {
  const res = await fetch(`/api/rooms?telegramId=${encodeURIComponent(currentTelegramId)}`);
  const data = await res.json();
  rooms = data.rooms || [];
  activeRoomId = data.activeRoomId || (rooms[0] ? rooms[0].id : "");
  renderRoomSelect();
}

function renderRoomSelect() {
  roomSelect.innerHTML = "";
  if (!rooms.length) {
    roomSelect.innerHTML = `<option value="">No rooms</option>`;
    roomInfo.textContent = "Sozday komnatu v bote: /room_create Family";
    return;
  }
  for (const room of rooms) {
    const option = document.createElement("option");
    option.value = room.id;
    option.textContent = `${room.title} (${room.role})`;
    if (room.id === activeRoomId) option.selected = true;
    roomSelect.appendChild(option);
  }
  const activeRoom = rooms.find((r) => r.id === activeRoomId);
  roomInfo.textContent = activeRoom
    ? `Aktivnaya komnata: ${activeRoom.title} (${activeRoom.role})`
    : "Vyberi komnatu";
}

async function loadMemories() {
  if (!activeRoomId) {
    renderBalls([]);
    return;
  }
  const res = await fetch(
    `/api/memories?telegramId=${encodeURIComponent(currentTelegramId)}&roomId=${encodeURIComponent(activeRoomId)}`
  );
  const data = await res.json();
  renderBalls(data.memories || []);
}

function renderBalls(memories) {
  ballsContainer.innerHTML = "";
  if (!memories.length) {
    ballsContainer.innerHTML = "<p>Poka net vospominaniy. Otprav video botu.</p>";
    return;
  }

  for (const memory of memories) {
    const wrap = document.createElement("div");
    wrap.className = "ball-wrap";

    const ball = document.createElement("button");
    ball.className = "ball";
    ball.style.background = COLOR_MAP[memory.color] || COLOR_MAP.yellow;
    ball.title = memory.note || "Memory";
    ball.addEventListener("click", () => onBallClick(ball, memory.id));

    const meta = document.createElement("p");
    meta.className = "ball-meta";
    meta.textContent = `${memory.mediaType} - ${formatDate(memory.createdAt)}`;

    wrap.appendChild(ball);
    wrap.appendChild(meta);
    ballsContainer.appendChild(wrap);
  }
}

async function onBallClick(ballElement, memoryId) {
  ballElement.classList.add("animating");
  setTimeout(() => ballElement.classList.remove("animating"), 530);

  const res = await fetch(`/api/memory/${memoryId}/playback?telegramId=${encodeURIComponent(currentTelegramId)}`);
  const data = await res.json();

  overlay.classList.remove("hidden");
  noteText.textContent = data.note || "";

  if (data.mediaType === "text") {
    video.pause();
    video.removeAttribute("src");
    video.classList.add("hidden");
    playerText.textContent = data.note || "Tekstovoe vospominanie";
    playerText.classList.remove("hidden");
    return;
  }

  playerText.classList.add("hidden");
  video.classList.remove("hidden");
  video.src = data.url;
  video.load();
}

function closeOverlay() {
  overlay.classList.add("hidden");
  video.pause();
  video.removeAttribute("src");
  playerText.classList.add("hidden");
}

refreshButton.addEventListener("click", loadMemories);
roomSelect.addEventListener("change", async () => {
  activeRoomId = roomSelect.value;
  renderRoomSelect();
  await loadMemories();
});
closeButton.addEventListener("click", closeOverlay);
overlay.addEventListener("click", (event) => {
  if (event.target === overlay) {
    closeOverlay();
  }
});

if (window.Telegram && window.Telegram.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
}

async function boot() {
  currentTelegramId = detectTelegramId();
  if (!currentTelegramId) {
    roomInfo.textContent = "Open mini app from Telegram bot";
    renderBalls([]);
    return;
  }
  await loadRooms();
  await loadMemories();
}

boot();
