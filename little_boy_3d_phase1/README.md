# Little Boy & Monkey Apple Challenge — 3D multiplayer starter

This is a runnable starter structure for a Three.js/WebGL client and a Cloudflare Worker + Durable Objects WebSocket backend.

## What's included
- Three.js scene with a simple 3D boy, falling apples, and a monkey.
- Keyboard movement, selecting a wormy apple, and throwing toward a target.
- Room creation/join UI and WebSocket snapshots.
- Server-owned room timer, levels, scores, bag inventory, basic apple/monkey spawning, wormy-apple penalties, and level-clear bonuses.
- A room-only leaderboard.

## Important scope note
This is a **development scaffold**, not a certified production-ready game. The server is authoritative for scores, room state, level timing, and basic inventory rules, but the prototype still needs security review, automated tests, rate limiting, robust collision reconciliation, accessibility checks, and load testing before a public launch. Visual models are primitive placeholders.

## Requirements
- Node.js 20+
- Cloudflare account and Wrangler for deployment
- A current browser with WebGL support

## Run the client locally
```bash
cd client
npm install
npm run dev
```
The local client expects the backend at `http://localhost:8787` by default. Start the backend in a second terminal.

## Run the backend locally
From the project root:
```bash
npm install
npm run dev:worker
```
This runs Wrangler on `http://localhost:8787`.

## Deploy
1. Update `worker/wrangler.toml` with your unique Worker name and verify the Durable Objects migration syntax against the current Cloudflare documentation.
2. From the project root, run `npm run deploy:worker`.
3. Deploy the client to a static host such as Cloudflare Pages. Set `VITE_API_BASE` to the deployed Worker URL before building:
   ```bash
   cd client
   VITE_API_BASE=https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev npm run build
   ```
4. Serve the generated `client/dist` directory using Cloudflare Pages or another static host.
5. Verify CORS/origin restrictions, quotas, Durable Objects availability, and WebSocket behavior in the target account before inviting players.

## Controls
- Left / Right arrows or A / D: move.
- 1–6: select a bag slot.
- Space / Enter: throw selected wormy apple toward the monkey.
- Use the on-screen controls on mobile (basic buttons are provided).

## Rules in this scaffold
- Each level lasts 120 seconds, measured by the server.
- Good apple collected: +10.
- Feeding a wormy apple to a monkey: +20.
- Monkey theft: -10.
- Each wormy apple in bag: -1 point per second.
- Level clear: at least one good apple remains in the bag; +50 plus +10 per good apple retained.
- Five-second intermission between levels.
- Maximum 8 players per room.

## Next hardening steps
- Add unit/integration tests for room creation, join/leave, duplicate actions, timer boundary behavior, reconnects, and level progression.
- Add rate limits and origin allowlists.
- Add client prediction/reconciliation and interpolation for remote players.
- Replace primitive meshes with licensed GLTF models and proper animations.
- Add server-side collision validation against the actual 3D game world.
- Add observability, error reporting, and deployment rollback.
