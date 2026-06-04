# OpenAI Codex — Agent Context & Prompt Templates

## How to Use This File

Each phase below contains a **self-contained prompt** to paste into Codex. The prompt includes all context Codex needs — do not assume it remembers previous phases. After each phase, the human orchestrator reviews output and pastes the next prompt.

---

## Project Summary (include in every prompt)

```
Project: Scorched Earth AR — a multiplayer tabletop AR artillery game
Stack:
  - Backend: Node.js 20, Express 4, Socket.IO 4, MongoDB (Mongoose 8), ESM modules
  - Frontend: Plain HTML/CSS/JS (no framework), AR.js 3 + A-Frame 1.5 via CDN
  - Realtime: Socket.IO 4 (shared between backend and frontend)
  - DB: MongoDB Atlas, database name "scorched-earth"
  - Auth: none (player identity is ephemeral localStorage only)
  - Avatars: DiceBear v9 adventurer SVG — URL: https://api.dicebear.com/9.x/adventurer/svg?seed={username}

File structure:
  backend/
    src/
      server.js          ← Express + Socket.IO entry point
      game/
        room-manager.js  ← in-memory game rooms
        game-engine.js   ← trajectory computation, hit detection
      routes/
        venue.js         ← venue/table REST endpoints
    package.json
  frontend/
    venue/
      index.html         ← player entry: scan QR → see games list → join
      join.js
    ar/
      game.html          ← AR scene (A-Frame + AR.js, loaded after join)
      game.js            ← Socket.IO client + A-Frame scene control
      controls.js        ← aiming UI (azimuth buttons, elevation slider, power slider)
    admin/
      index.html         ← host panel (start/reset game)
    package.json

Coding conventions:
  - ESM throughout (import/export, "type": "module" in package.json)
  - No TypeScript for prototype
  - No comments unless the WHY is non-obvious
  - socket.io room name = gameId (string, e.g. "abc123")
  - Use io.to(gameId).emit() for game state broadcasts (includes sender)
  - Use socket.to(gameId).emit() only for broadcasts that exclude the sender
  - All trajectory math is server-side; clients only animate pre-computed waypoints
```

---

## Phase 1 Prompt — Backend Skeleton + Lobby

```
Context: [paste Project Summary above]

Task: Build Phase 1 — backend skeleton and player lobby.

Backend (backend/src/server.js + game/room-manager.js + routes/venue.js):

1. Express server on PORT from env (default 3001). Serve frontend/public as static.
2. Socket.IO with CORS allowing all origins in dev.
3. Namespace: /game (all game socket events go here)
4. REST endpoint: GET /venue/:venueId/table/:tableNo/games
   → returns list of active games at this table as JSON: [{ id, playerCount, maxPlayers, status }]
5. room-manager.js — in-memory Map of games:
   - createGame(venueId, tableNo) → generates gameId (6-char alphanumeric), stores game object
   - joinGame(gameId, player) → adds player { id, username, avatarUrl } to game, returns { gameId, playerId, tankIndex }
   - getGames(venueId, tableNo) → returns active games array
   - Game object shape: { id, venueId, tableNo, players: [], status: 'lobby'|'playing'|'ended', createdAt }
6. Socket events on /game namespace:
   - client emits: join-game { gameId, username } → server calls joinGame, broadcasts player-joined { player } to room, emits joined { playerId, tankIndex, players } back to sender
   - client emits: start-game { gameId } → if playerCount >= 2, set status='playing', emit game-started { players, currentTurn: players[0].id } to room
   - client emits: request-games { venueId, tableNo } → server emits games-list { games } back to sender

Frontend (frontend/venue/index.html + join.js):

1. Single HTML page. URL param ?venueId=xxx&tableNo=1 or path /venue/:venueId/:tableNo
2. On load: emit request-games → display list of games (join button per game) + "Create new game" button
3. "Create new game" → POST /venue/:venueId/table/:tableNo/games → server creates game, returns { gameId } → redirect to join flow
4. Join flow (same page, step 2): input for username, show DiceBear preview SVG as user types (debounced 300ms), confirm button
5. On confirm: emit join-game { gameId, username } → on joined response: save { playerId, gameId, username, avatarUrl } to localStorage key "se-player" → show lobby waiting screen with list of joined players (update on player-joined events)
6. Lobby shows "Waiting for host to start..." and lists players with their DiceBear avatars (img tag with dicebear URL)
7. On game-started event: redirect to /ar/game.html?gameId=xxx&playerId=yyy

Add a minimal admin/index.html:
- Input for gameId, "Start Game" button → emits start-game { gameId } via socket
- No auth for prototype

Deliver: all files with full content, ready to run with "node backend/src/server.js" and opening frontend/venue/index.html via a local static server.
```

---

## Phase 2 Prompt — AR Scene (Static Tanks)

```
Context: [paste Project Summary above]

Prerequisite: Phase 1 is complete and running. The socket emits game-started with { players, currentTurn }.

Task: Build Phase 2 — AR scene with static tank meshes on the marker.

File: frontend/ar/game.html
  - Load via CDN (no build step):
      <script src="https://aframe.io/releases/1.5.0/aframe.min.js"></script>
      <script src="https://raw.githack.com/AR-js-org/AR.js/master/aframe/build/aframe-ar.js"></script>
  - Full-screen, no scrollbars, black background
  - <a-scene> with arjs="sourceType: webcam; debugUIEnabled: false;" embedded renderer="logarithmicDepthBuffer: true;"
  - <a-marker preset="hiro" id="main-marker"> wraps the entire battlefield
  - Inside marker:
      - Battlefield plane: <a-plane> 1m x 1m, rotation="-90 0 0", wireframe material, color #00ff88
      - Tank positions: distribute N tanks evenly around a circle of radius 0.35m on the plane
        - Tank = group entity: box body (0.08 x 0.04 x 0.06), cylinder barrel (radius 0.01, height 0.08, rotated to point outward from center)
        - Each tank colored differently (use hue rotation: hsl(i * 60, 80%, 50%))
        - Above each tank: <a-image> showing DiceBear avatar URL, billboard facing camera
        - Store tank entities in a JS Map keyed by playerId
  - <a-camera> outside the marker (standard AR camera setup)

File: frontend/ar/game.js
  - On load: read gameId and playerId from URL params
  - Read player data from localStorage "se-player"
  - Connect to socket /game namespace
  - Emit rejoin-game { gameId, playerId } (add this event to backend room-manager — return current game state)
  - On game-state response: call initScene(players) to place tanks
  - initScene(players): position tanks at equal angles around the circle, point barrels outward from center

Backend addition needed:
  - Add socket event rejoin-game { gameId, playerId } → emit game-state { players, status, currentTurn } back to sender

Deliver: game.html and game.js with full content, plus the backend addition.
Test criteria: Open game.html on a phone (via ngrok or local HTTPS), point at a printed Hiro marker — tanks appear on the marker plane, one per player.
```

---

## Phase 3 Prompt — Turn System + Aiming UI

```
Context: [paste Project Summary above]

Prerequisite: Phases 1 & 2 complete. Tanks visible in AR.

Task: Build Phase 3 — turn-based game loop with aiming controls.

Aiming UI (frontend/ar/controls.js + injected into game.html):
  - Overlay div (position: fixed, bottom 0, full width, semi-transparent dark panel)
  - Only visible when it is THIS player's turn (currentTurn === myPlayerId)
  - Controls:
      1. Azimuth: two buttons ← → that rotate the player's tank by ±5° per tap. Also show current degrees (0–360°).
      2. Elevation: vertical range input, 5–85°, default 45°
      3. Power: horizontal range input, 10–100, default 50
      4. "Fire!" button
  - When not your turn: show "Waiting for [username]..." overlay

Socket events to add:

Client → Server:
  - rotate-tank { gameId, playerId, azimuth }   ← broadcast to others so they see tank rotating live
  - fire { gameId, playerId, azimuth, elevation, power }

Server → Client:
  - tank-rotated { playerId, azimuth }           ← re-emit to room so all see rotation
  - your-turn { playerId }                        ← sent to room; each client checks if it matches
  - turn-timeout { playerId }                     ← if player hasn't fired in 30s, skip their turn (auto-aim straight up, low power)

Backend (game-engine.js):
  - Add computeTrajectory(origin, azimuth, elevation, power, gravity=9.8, steps=60, dt=0.05):
      Returns array of {x, y, z} points (AR-space meters)
      origin: {x, y, z} of the firing tank on the battlefield plane
      azimuth: degrees (0=north/+z), elevation: degrees above horizontal, power: 10–100 mapped to 0.3–1.5 m/s initial speed
      Formula: standard projectile, gravity along -y axis
  - Add detectHit(waypoints, tanks, hitRadius=0.06):
      For each waypoint, check distance to each living tank position
      Return { hit: bool, targetId: string|null, impactPoint: {x,y,z} }

Deliver: controls.js, updated game.js (handle rotate-tank, your-turn events, send fire), updated backend socket handler and game-engine.js.
```

---

## Phase 4 Prompt — Projectile + Explosion

```
Context: [paste Project Summary above]

Prerequisite: Phases 1–3 complete. Firing sends trajectory to server.

Task: Build Phase 4 — projectile animation and explosion, closing the game loop.

New socket event flow:
  Client fires → server computes trajectory + hit detection → emits projectile-launched { waypoints, hit, targetId, impactPoint } to io.to(gameId)

Projectile animation (in game.js, inside A-Frame marker):
  - Create <a-sphere radius="0.02" color="#ffff00" emissive="#ffaa00"> entity for projectile
  - Animate along waypoints array using setInterval at 50ms per step
  - On last waypoint: trigger explosion at impactPoint

Explosion (A-Frame component or simple animation):
  - At impactPoint: create a <a-sphere> that scales from 0.01 to 0.2 over 0.3s then fades (opacity 1→0 over 0.5s) — use A-Frame animation component
  - Also create 6 small debris entities flying outward (simple, not physics-based: just translate outward + fade)
  - After explosion completes: if hit, remove the target tank entity from scene

Game loop closure (backend game-engine.js + socket handler):
  - After hit: mark target player as eliminated (players[i].alive = false)
  - Check win condition: if only one player alive, emit game-over { winnerId } to room
  - If no hit or not game over: advance turn (next alive player), emit your-turn { playerId } to room
  - If hit but not game over: emit player-eliminated { playerId } then your-turn

Frontend on game-over:
  - Show full-screen overlay: winner's DiceBear avatar, username, "Game Over!" text
  - After 5 seconds, redirect back to venue lobby

Deliver: updated game.js (animation + explosion + game-over screen), updated backend socket handler and game-engine.js.
```

---

## Phase 5 Prompt — Two-Marker Scaling (Experiment)

```
Context: [paste Project Summary above]

Prerequisite: Phases 1–4 complete. Full game working with one Hiro marker.

Task: Build Phase 5 — two-marker scaling experiment.

This is experimental. Goal: if a second marker is visible, compute 3D distance between the two markers and use it to scale the battlefield.

Setup:
  - In game.html, add a second <a-marker> using a custom pattern (provide a simple NFT or use "kanji" preset as second marker)
  - Wrap the entire battlefield content in an <a-entity id="battlefield"> inside the FIRST marker
  - The second marker will be used only for its world-space position

A-Frame component: scale-by-markers
  - Registers as AFRAME.registerComponent('scale-by-markers', ...)
  - On every tick:
      1. Get world position of marker1 and marker2 using el.object3D.getWorldPosition()
      2. If marker2 is not visible (check marker2.object3D.visible), use default scale (1.0)
      3. Compute distance = marker1WorldPos.distanceTo(marker2WorldPos)
      4. Reference distance = 0.2 (20cm, the physical distance between markers on the printed card)
      5. scaleFactor = distance / referenceDistance
      6. Clamp scaleFactor to 0.5–3.0 to avoid runaway scale
      7. Apply: battlefield.setAttribute('scale', `${scaleFactor} ${scaleFactor} ${scaleFactor}`)
  - Attach component to <a-scene>: <a-scene scale-by-markers ...>

Print guidance (add to docs/setup.md):
  - Print two Hiro markers exactly 20cm apart (center to center) on the same card
  - This is the reference distance. Moving markers closer shrinks the battlefield; farther apart expands it.
  - For the experiment, you can use one standard Hiro and one "kanji" preset marker

Deliver: updated game.html with second marker + scale-by-markers component, plus docs/setup.md with marker printing instructions.
```

---

## Notes for the Orchestrator

- After each phase, test on a real device (not desktop) — AR camera permissions don't work on localhost without HTTPS. Use ngrok: `ngrok http 3001` for backend, `npx serve frontend -l 4000` + `ngrok http 4000` for frontend.
- Socket event names are frozen after Phase 1. Do not rename them in later phases.
- If Codex produces TypeScript, ask it to rewrite in plain JS ESM.
- If Codex uses `require()`, ask it to use `import/export` instead.
