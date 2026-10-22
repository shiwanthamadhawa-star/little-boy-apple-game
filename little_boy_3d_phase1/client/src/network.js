const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8787").replace(/\/$/, "");

export class RoomClient {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.socket = null;
    this.roomCode = null;
    this.playerId = null;
  }

  async createRoom(nickname) {
    const response = await fetch(`${API_BASE}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname })
    });
    if (!response.ok) throw new Error(`Room creation failed (${response.status})`);
    const result = await response.json();
    this.connect(result.roomCode, nickname);
    return result.roomCode;
  }

  joinRoom(roomCode, nickname) {
    this.connect(roomCode.trim().toUpperCase(), nickname);
  }

  connect(roomCode, nickname) {
    this.disconnect();
    this.roomCode = roomCode;
    const wsBase = API_BASE.replace(/^http/, "ws");
    const url = `${wsBase}/api/rooms/${encodeURIComponent(roomCode)}/ws?nickname=${encodeURIComponent(nickname || "Player")}`;
    this.socket = new WebSocket(url);

    this.socket.addEventListener("open", () => this.onStatus?.(`Connected to room ${roomCode}. Waiting for room state…`));
    this.socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "welcome") this.playerId = message.playerId;
        this.onMessage?.(message);
      } catch (error) {
        console.error("Ignoring invalid server message", error);
      }
    });
    this.socket.addEventListener("close", () => this.onStatus?.("Disconnected from room. Rejoin to continue."));
    this.socket.addEventListener("error", () => this.onStatus?.("Connection error. Check that the multiplayer server is running."));
  }

  send(type, payload = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.onStatus?.("Not connected to a room yet.");
      return false;
    }
    this.socket.send(JSON.stringify({ type, ...payload }));
    return true;
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
