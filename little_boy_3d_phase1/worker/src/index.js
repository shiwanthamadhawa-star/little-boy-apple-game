const MAX_PLAYERS = 8;
const LEVEL_SECONDS = 120;
const INTERMISSION_SECONDS = 5;
const BAG_CAPACITY = 6;
const GOOD_APPLE_POINTS = 10;
const FEED_POINTS = 20;
const THEFT_PENALTY = 10;
const WORMY_PENALTY_PER_SECOND = 1;
const LEVEL_CLEAR_BONUS = 50;
const RETAINED_APPLE_BONUS = 10;
const LANES = [-3, 0, 3];
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" }
  });
}

function makeCode(length = 4) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ROOM_CODE_CHARS[b % ROOM_CODE_CHARS.length]).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json({ ok: true });

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const roomCode = makeCode();
      const id = env.ROOMS.idFromName(roomCode);
      const stub = env.ROOMS.get(id);
      const initResponse = await stub.fetch("https://room.internal/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode, hostNickname: String(body.nickname || "Player").slice(0, 18) })
      });
      if (!initResponse.ok) return json({ error: "Could not initialize room" }, 500);
      return json({ roomCode });
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/ws$/i);
    if (match) {
      const roomCode = match[1].toUpperCase();
      const id = env.ROOMS.idFromName(roomCode);
      return env.ROOMS.get(id).fetch(request);
    }

    return json({ error: "Not found" }, 404);
  }
};

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = {
      roomCode: "----",
      phase: "lobby",
      level: 1,
      levelStartedAt: null,
      levelEndsAt: null,
      intermissionEndsAt: null,
      players: [],
      apples: [],
      monkeys: [],
      nextEntityId: 1,
      version: 0,
      lastPenaltyAt: Date.now(),
      lastSpawnAt: Date.now(),
      lastMonkeyAt: Date.now()
    };
    this.alarmScheduled = false;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      const body = await request.json();
      this.state.roomCode = body.roomCode;
      await this.ctx.storage.put("state", this.state);
      return json({ ok: true });
    }

    await this.loadState();

    if (url.pathname.endsWith("/ws")) {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "WebSocket upgrade required" }, 426);
      if (this.state.players.length >= MAX_PLAYERS) return json({ error: "Room is full" }, 409);

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();

      const nickname = (url.searchParams.get("nickname") || "Player").slice(0, 18);
      const playerId = crypto.randomUUID();
      const player = {
        id: playerId,
        nickname,
        lane: 1,
        x: 0,
        z: 5,
        score: 0,
        level: this.state.level,
        bag: [],
        connected: true,
        lastActionAt: Date.now()
      };
      this.state.players.push(player);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ playerId });
      this.broadcast({ type: "welcome", playerId, roomCode: this.state.roomCode });
      this.broadcastState();
      await this.persist();
      await this.scheduleAlarm();
      return new Response(null, { status: 101, webSocket: client });
    }

    return json({ error: "Not found" }, 404);
  }

  async loadState() {
    const saved = await this.ctx.storage.get("state");
    if (saved) this.state = saved;
  }

  async persist() {
    this.state.version += 1;
    await this.ctx.storage.put("state", this.state);
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(data); } catch { /* A closed socket will be removed by the runtime. */ }
    }
  }

  snapshot() {
    const now = Date.now();
    return {
      roomCode: this.state.roomCode,
      phase: this.state.phase,
      level: this.state.level,
      levelStartedAt: this.state.levelStartedAt,
      levelEndsAt: this.state.levelEndsAt,
      intermissionEndsAt: this.state.intermissionEndsAt,
      serverNow: now,
      version: this.state.version,
      players: this.state.players.map((p) => ({
        id: p.id, nickname: p.nickname, lane: p.lane, x: p.x, z: p.z,
        score: p.score, level: p.level, bag: p.bag, connected: p.connected
      })),
      apples: this.state.apples,
      monkeys: this.state.monkeys
    };
  }

  broadcastState(type = "room_snapshot") {
    this.broadcast({ type, state: this.snapshot() });
  }

  getPlayer(socket) {
    const attachment = socket.deserializeAttachment();
    return this.state.players.find((p) => p.id === attachment?.playerId);
  }

  async webSocketMessage(socket, rawMessage) {
    await this.loadState();
    let message;
    try { message = JSON.parse(rawMessage); } catch {
      socket.send(JSON.stringify({ type: "error", message: "Invalid JSON message" }));
      return;
    }

    const player = this.getPlayer(socket);
    if (!player) {
      socket.send(JSON.stringify({ type: "error", message: "Player is no longer in this room" }));
      return;
    }

    const now = Date.now();
    player.lastActionAt = now;

    if (message.type === "start_game") {
      if (this.state.phase === "lobby" && this.state.players.filter((p) => p.connected).length >= 2) {
        this.startLevel(now);
      }
    } else if (message.type === "move") {
      if (!Number.isInteger(message.lane) || message.lane < 0 || message.lane >= LANES.length) {
        socket.send(JSON.stringify({ type: "error", message: "Invalid lane" }));
        return;
      }
      player.lane = message.lane;
      player.x = LANES[player.lane];
    } else if (message.type === "throw") {
      this.handleThrow(player, message.slot, now);
    } else if (message.type === "request_snapshot") {
      socket.send(JSON.stringify({ type: "room_snapshot", state: this.snapshot() }));
      return;
    } else if (message.type === "ready") {
      // Reserved for lobby ready-state UI in the next client iteration.
    } else {
      socket.send(JSON.stringify({ type: "error", message: "Unknown action" }));
      return;
    }

    await this.persist();
    this.broadcastState("state_update");
    await this.scheduleAlarm();
  }

  handleThrow(player, slot, now) {
    if (this.state.phase !== "playing") return;
    if (!Number.isInteger(slot) || slot < 0 || slot >= player.bag.length) return;
    const item = player.bag[slot];
    if (!item?.wormy || this.state.monkeys.length === 0) return;

    // Prototype targeting rule: any active monkey can be fed. Add real 3D range/aim validation before public launch.
    player.bag.splice(slot, 1);
    player.score += FEED_POINTS;
    this.state.monkeys.shift();
    this.broadcast({ type: "event", event: "monkey_fed", playerId: player.id, points: FEED_POINTS });
  }

  startLevel(now) {
    this.state.phase = "playing";
    this.state.levelStartedAt = now;
    this.state.levelEndsAt = now + LEVEL_SECONDS * 1000;
    this.state.intermissionEndsAt = null;
    this.state.apples = [];
    this.state.monkeys = [];
    this.state.lastPenaltyAt = now;
    this.state.lastSpawnAt = now;
    this.state.lastMonkeyAt = now;
    for (const p of this.state.players) p.level = this.state.level;
    this.broadcast({ type: "game_started", state: this.snapshot() });
  }

  spawnApple(now) {
    const lane = Math.floor(Math.random() * LANES.length);
    const wormy = Math.random() < 0.28;
    this.state.apples.push({
      id: `a${this.state.nextEntityId++}`,
      lane,
      x: LANES[lane],
      y: 7,
      z: -5 + Math.random() * 2,
      wormy,
      spawnedAt: now,
      caughtBy: null
    });
  }

  spawnMonkey() {
    const lane = Math.floor(Math.random() * LANES.length);
    this.state.monkeys.push({
      id: `m${this.state.nextEntityId++}`,
      lane,
      z: -2,
      spawnedAt: Date.now()
    });
    if (this.state.monkeys.length > 2) this.state.monkeys.shift();
  }

  simulate(now) {
    if (this.state.phase === "playing") {
      // Server-side fall and collection simulation. A production version should use fixed-step simulation and collision tests.
      for (const apple of this.state.apples) apple.y -= 0.055;
      for (const apple of [...this.state.apples]) {
        if (apple.y <= 0.75) {
          const collector = this.state.players.find((p) => p.connected && p.lane === apple.lane);
          if (collector && collector.bag.length < BAG_CAPACITY) {
            collector.bag.push({ id: apple.id, wormy: apple.wormy });
            if (!apple.wormy) collector.score += GOOD_APPLE_POINTS;
            apple.caughtBy = collector.id;
          }
          this.state.apples = this.state.apples.filter((a) => a.id !== apple.id);
        }
      }

      if (now - this.state.lastSpawnAt >= 1400) {
        this.spawnApple(now);
        this.state.lastSpawnAt = now;
      }
      if (now - this.state.lastMonkeyAt >= 10000 && this.state.monkeys.length < 2) {
        this.spawnMonkey();
        this.state.lastMonkeyAt = now;
      }

      // Wormy-apple penalty: one point per wormy apple per elapsed second.
      const elapsedSeconds = Math.floor((now - this.state.lastPenaltyAt) / 1000);
      if (elapsedSeconds > 0) {
        for (const p of this.state.players) {
          const wormyCount = p.bag.filter((item) => item.wormy).length;
          p.score = Math.max(0, p.score - wormyCount * WORMY_PENALTY_PER_SECOND * elapsedSeconds);
        }
        this.state.lastPenaltyAt += elapsedSeconds * 1000;
      }

      // Basic monkey theft: periodically remove a good apple from a bag, if present.
      for (const monkey of this.state.monkeys) {
        if (now - monkey.spawnedAt > 5000 && !monkey.hasStolen) {
          const victim = this.state.players.find((p) => p.connected && p.bag.some((item) => !item.wormy));
          if (victim) {
            const index = victim.bag.findIndex((item) => !item.wormy);
            victim.bag.splice(index, 1);
            victim.score = Math.max(0, victim.score - THEFT_PENALTY);
            monkey.hasStolen = true;
          }
        }
      }

      if (now >= this.state.levelEndsAt) this.finishLevel(now);
    } else if (this.state.phase === "intermission" && now >= this.state.intermissionEndsAt) {
      this.state.level += 1;
      this.startLevel(now);
    }
  }

  finishLevel(now) {
    this.state.phase = "intermission";
    this.state.intermissionEndsAt = now + INTERMISSION_SECONDS * 1000;
    const results = [];
    for (const p of this.state.players) {
      const goodCount = p.bag.filter((item) => !item.wormy).length;
      const cleared = goodCount >= 1;
      const bonus = cleared ? LEVEL_CLEAR_BONUS + goodCount * RETAINED_APPLE_BONUS : 0;
      p.score += bonus;
      if (cleared) p.level = this.state.level + 1;
      results.push({ playerId: p.id, nickname: p.nickname, cleared, goodCount, bonus, score: p.score, nextLevel: p.level });
    }
    this.broadcast({ type: "level_result", results, message: "Level complete. Next level begins shortly." });
  }

  async alarm() {
    await this.loadState();
    this.simulate(Date.now());
    await this.persist();
    this.broadcastState("state_update");
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    const now = Date.now();
    // Frequent alarms keep the prototype simulation and timer reasonably current.
    const next = Math.min(now + 250, this.state.levelEndsAt || now + 250, this.state.intermissionEndsAt || now + 250);
    await this.ctx.storage.setAlarm(Math.max(now + 50, next));
  }

  async webSocketClose(socket) {
    await this.loadState();
    const player = this.getPlayer(socket);
    if (player) {
      player.connected = false;
      await this.persist();
      this.broadcastState("state_update");
    }
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }
}
