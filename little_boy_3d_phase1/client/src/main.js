import "./style.css";
import { AppleRushScene } from "./game.js";
import { RoomClient } from "./network.js";

const $ = (id) => document.getElementById(id);
const game = new AppleRushScene($("game-canvas"));

let roomClient;
let localLane = 1;
let lastSnapshot = null;
let selectedSlot = 0;

const setStatus = (message) => { $("status").textContent = message; };

function updateHud(state) {
  const me = (state.players || []).find((p) => p.id === roomClient?.playerId);
  $("room-label").textContent = state.roomCode || roomClient?.roomCode || "—";
  $("level-label").textContent = String(state.level ?? "—");
  const remaining = Math.max(0, Math.ceil((state.levelEndsAt || Date.now()) - (state.serverNow || Date.now())) / 1000);
  const seconds = Math.min(120, Math.max(0, Math.ceil(remaining)));
  $("timer-label").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  $("score-label").textContent = String(me?.score ?? 0);
  $("bag-label").textContent = `${me?.bag?.length ?? 0}/6`;

  const leaderboard = [...(state.players || [])].sort((a, b) => b.score - a.score);
  $("leaderboard").replaceChildren(...(leaderboard.length
    ? leaderboard.map((p) => {
        const li = document.createElement("li");
        li.textContent = `${p.nickname}${p.id === roomClient?.playerId ? " (you)" : ""} — ${p.score}`;
        return li;
      })
    : [Object.assign(document.createElement("li"), { textContent: "Waiting for players…" })]));

  const bag = me?.bag || [];
  $("bag-list").replaceChildren(...(bag.length
    ? bag.map((item, index) => {
        const li = document.createElement("li");
        li.textContent = `${index + 1}. ${item.wormy ? "🐛🍎 Wormy apple" : "🍎 Good apple"}${index === selectedSlot ? " ← selected" : ""}`;
        return li;
      })
    : [Object.assign(document.createElement("li"), { textContent: "Empty" })]));
}

function handleMessage(message) {
  if (message.type === "welcome") {
    game.setLocalPlayer(message.playerId);
    setStatus(`Joined room ${message.roomCode}. Share the code with friends.`);
  } else if (message.type === "error") {
    setStatus(message.message || "Server error.");
  } else if (message.type === "room_snapshot" || message.type === "state_update") {
    lastSnapshot = message.state;
    game.setSnapshot(message.state);
    updateHud(message.state);
  } else if (message.type === "level_result") {
    setStatus(message.message || "Level complete.");
  } else if (message.type === "game_over") {
    setStatus("Session ended.");
  } else if (message.type === "score_update") {
    if (message.state) {
      lastSnapshot = message.state;
      game.setSnapshot(message.state);
      updateHud(message.state);
    }
  }
}

function ensureClient() {
  if (!roomClient) roomClient = new RoomClient({ onMessage: handleMessage, onStatus: setStatus });
  return roomClient;
}

$("create-room").addEventListener("click", async () => {
  try {
    const nickname = $("nickname").value.trim() || "Player";
    const code = await ensureClient().createRoom(nickname);
    $("room-code").value = code;
    $("room-label").textContent = code;
  } catch (error) {
    console.error(error);
    setStatus(`Could not create room: ${error.message}`);
  }
});

$("join-room").addEventListener("click", () => {
  const code = $("room-code").value.trim().toUpperCase();
  if (!code) return setStatus("Enter a room code first.");
  ensureClient().joinRoom(code, $("nickname").value.trim() || "Player");
});

function move(delta) {
  localLane = game.setLocalLane(localLane + delta);
  ensureClient().send("move", { lane: localLane });
}
$("left-button").addEventListener("click", () => move(-1));
$("right-button").addEventListener("click", () => move(1));
$("throw-button").addEventListener("click", () => ensureClient().send("throw", { slot: selectedSlot }));

window.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", " "].includes(event.key)) event.preventDefault();
  if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") move(-1);
  if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") move(1);
  if (/^[1-6]$/.test(event.key)) {
    selectedSlot = Number(event.key) - 1;
    if (lastSnapshot) updateHud(lastSnapshot);
  }
  if (event.key === " " || event.key === "Enter") ensureClient().send("throw", { slot: selectedSlot });
});

window.addEventListener("beforeunload", () => {
  roomClient?.disconnect();
  game.dispose();
});
