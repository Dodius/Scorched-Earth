# OpenAI Codex - Agent Context & Prompt Templates

## How To Use This File

Each phase below contains a self-contained prompt to paste into Codex. Include the project summary every time. Do not assume a later prompt remembers earlier phases.

After each phase, test on a real phone before moving on.

## Project Summary

```text
Project: Scorched Earth AR - a multiplayer tabletop AR artillery game

Stack:
  - Backend: Node.js 20, Express 4, Socket.IO 4, MongoDB with Mongoose 8, ESM modules
  - Frontend: plain HTML/CSS/JS for AR pages, no TypeScript
  - AR: AR.js 3 + A-Frame 1.5 via CDN
  - Real-time: Socket.IO 4
  - DB: MongoDB Atlas, database name "scorched-earth"
  - Auth: none; player identity is ephemeral localStorage only
  - Avatars: DiceBear v9 adventurer SVG

Local marker assets:
  - frontend/ar/markers/pattern-ARFly_binary_clean_05.patt
  - frontend/ar/markers/pattern-ARFly_binary_clean_05.png

Stable frontend routes:
  - /venue/:venueId/table/:tableNo
  - /venue/:venueId/table/:tableNo/game/:gameId
  - /ar/game.html?gameId=:gameId&playerId=:playerId
  - /admin

Stable backend API routes:
  - GET  /api/venue/:venueId/table/:tableNo/games
  - POST /api/venue/:venueId/table/:tableNo/games
  - GET  /api/games/:gameId
  - POST /api/games/:gameId/start
  - POST /api/games/:gameId/reset

Socket namespace:
  - /game

Socket room:
  - gameId

Prototype defaults:
  - fieldSize = medium
  - scenePreset = classic-grid
  - maxPlayers = 6
  - bombMode = normal

Field sizes:
  - small: 0.6m x 0.45m, root scale 0.75
  - medium: 0.8m x 0.6m, root scale 1.0
  - large: 1.0m x 0.75m, root scale 1.25

Coding conventions:
  - ESM throughout: import/export, "type": "module"
  - No TypeScript for prototype
  - Use io.to(gameId).emit() for game state broadcasts that include sender
  - Use socket.to(gameId).emit() only when excluding sender is intended
  - Server computes projectile trajectory and hit detection
  - Clients only animate server-provided waypoints
  - Server includes launchAt timestamp for synchronized projectile animation
```

## Suggested File Structure

```text
backend/
  src/
    server.js
    db/
      connect.js
    game/
      room-manager.js
      game-engine.js
    models/
      GameSession.js
    routes/
      venue.js
      games.js
  package.json
  render.yaml

frontend/
  venue/
    index.html
    join.js
  ar/
    game.html
    game.js
    controls.js
    markers/
      pattern-ARFly_binary_clean_05.patt
      pattern-ARFly_binary_clean_05.png
  admin/
    index.html
    admin.js
  netlify.toml
  package.json
```

## Phase 1 Prompt - Backend Skeleton And Lobby

```text
Context: [paste Project Summary above]

Task: Build Phase 1 - backend skeleton, player lobby, host init, and marker assets.

Backend:
1. Express server on PORT from env, default 3001.
2. Socket.IO with CORS configured from CORS_ORIGIN, allowing all origins in dev.
3. Socket namespace: /game.
4. Connect to MongoDB only if MONGO_URI is present. Use database "scorched-earth" in the connection string.
5. Live game state can be in memory for the prototype.
6. Add optional GameSession persistence for created/started/ended sessions.

REST:
1. GET /api/venue/:venueId/table/:tableNo/games
   Returns active games for the table.
2. POST /api/venue/:venueId/table/:tableNo/games
   Creates a game with init config:
   {
     fieldSize: "small" | "medium" | "large",
     scenePreset: "classic-grid" | "pub-table" | "crater-field",
     maxPlayers: 2-6,
     bombMode: "normal" | "leap-frog"
   }
   Defaults are allowed if body is empty.
3. GET /api/games/:gameId
   Returns current game state.
4. POST /api/games/:gameId/start
   Starts if at least 2 players joined.
5. POST /api/games/:gameId/reset
   Resets game to lobby or creates a fresh game for same venue/table.

Room manager:
1. createGame(venueId, tableNo, config)
2. joinGame(gameId, player)
3. rejoinGame(gameId, playerId)
4. getGames(venueId, tableNo)
5. startGame(gameId)
6. resetGame(gameId)

Game object:
{
  id,
  venueId,
  tableNo,
  config,
  players: [],
  status: "lobby" | "playing" | "ended",
  currentTurn: null,
  createdAt,
  startedAt,
  endedAt
}

Socket events:
Client -> Server:
  - request-games { venueId, tableNo }
  - join-game { gameId, username }
  - rejoin-game { gameId, playerId }
  - start-game { gameId }

Server -> Client:
  - games-list { games }
  - joined { playerId, tankIndex, players, config }
  - player-joined { player, players }
  - game-state { game }
  - game-started { players, currentTurn, config }

Frontend venue page:
1. Route-compatible with /venue/:venueId/table/:tableNo.
2. Show active games for this table.
3. If creating a game, show host init controls with defaults:
   - field size
   - scene preset
   - max players
   - bomb mode
4. Join flow asks only username.
5. Show DiceBear avatar preview.
6. Save player data to localStorage key "se-player".
7. Lobby lists players and waits for host start.
8. On game-started, redirect to /ar/game.html?gameId=...&playerId=...

Admin page:
1. Input gameId.
2. Show game state.
3. Start/reset buttons.
4. No auth in prototype.

Deliver all files ready to run locally.
```

## Phase 2 Prompt - AR Scene With Static Tanks

```text
Context: [paste Project Summary above]

Prerequisite: Phase 1 complete.

Task: Build Phase 2 - AR scene using the local ARFly marker and static tanks.

frontend/ar/game.html:
1. Load A-Frame 1.5 and AR.js via CDN.
2. Full-screen, no scrollbars.
3. Use a custom pattern marker:
   frontend/ar/markers/pattern-ARFly_binary_clean_05.patt
4. Marker wraps the battlefield root entity.
5. Battlefield root scale comes from game config:
   small = 0.75
   medium = 1.0
   large = 1.25
6. Add a field plane with logical width 1.0 and depth 0.75.
7. Add simple tank meshes for each player.
8. Add DiceBear avatar billboard above each tank.

frontend/ar/game.js:
1. Read gameId and playerId from URL.
2. Connect to /game namespace.
3. Emit rejoin-game.
4. On game-state, initialize scene from players and config.
5. Distribute tanks around an ellipse.
6. Store tank entities by playerId.

Backend:
1. rejoin-game returns current players, config, status, currentTurn.

Test criteria:
Open the AR page on a phone over HTTPS, point at the printed ARFly marker PNG, and see all tanks anchored to the marker.
```

## Phase 3 Prompt - Turn System And Aiming UI

```text
Context: [paste Project Summary above]

Prerequisite: Phase 2 complete.

Task: Build Phase 3 - turn-based aiming and server-side trajectory calculation.

Controls:
1. Only current player sees aiming controls.
2. Controls:
   - rotate left/right by 5 degrees
   - elevation slider 5-85 degrees, default 45
   - power slider 10-100, default 50
   - Fire button
3. Non-current players see "Waiting for [username]".

Socket events:
Client -> Server:
  - rotate-tank { gameId, playerId, azimuth }
  - fire { gameId, playerId, azimuth, elevation, power }

Server -> Client:
  - tank-rotated { playerId, azimuth }
  - your-turn { playerId }
  - projectile-launched { waypoints, hit, targetId, impactPoint, launchAt }
  - turn-timeout { playerId }

Backend game-engine.js:
1. computeTrajectory(origin, azimuth, elevation, power, options)
2. computeLeapFrogTrajectory(origin, azimuth, elevation, power, options)
3. detectHit(waypoints, tanks, hitRadius)
4. Keep all math server-side.

Important:
The server must reject fire events from non-current players.
```

## Phase 4 Prompt - Projectile, Explosion, Elimination

```text
Context: [paste Project Summary above]

Prerequisite: Phase 3 complete.

Task: Build Phase 4 - projectile animation, explosion, elimination, and win condition.

Frontend:
1. Animate projectile along server-provided waypoints.
2. Use launchAt timestamp to synchronize start across clients.
3. Projectile should be slow enough to watch: around 2.5-3.5 seconds.
4. Explosion:
   - expanding sphere or ring
   - quick fade
   - a few simple debris particles
5. Remove eliminated tank after explosion.
6. Show game-over overlay with winner avatar and username.

Backend:
1. Mark hit player as alive=false.
2. Emit player-eliminated.
3. Check win condition.
4. Emit game-over if one player remains.
5. Otherwise emit your-turn for next living player.

Socket events:
  - player-eliminated { playerId }
  - game-over { winnerId }
```

## Phase 5 Prompt - Optional Two-Marker Scaling Experiment

```text
Context: [paste Project Summary above]

Prerequisite: Phase 4 complete and tested on phones.

Task: Add optional two-marker scaling experiment.

This is experimental and must not be required for normal play.

Approach:
1. Main marker anchors the battlefield.
2. Second marker is used only for measuring apparent distance.
3. If both markers are visible, compute distance between marker origins.
4. Compare to reference printed distance.
5. Apply a clamped battlefield root scale.
6. If second marker is not visible, keep selected field size scale.

Risk:
Multi-marker tracking can jitter in pub lighting, so keep this behind a debug/experiment flag.
```

## Testing Notes

- Real AR testing needs HTTPS on real phones.
- Netlify frontend plus Render backend is enough for deployed testing.
- For local phone testing, use ngrok or Cloudflare Tunnel.
- Test under warm/low pub lighting, not only bright office lighting.
- Keep printed marker flat, matte, and at least 8-10 cm wide.
- Avoid glossy table cards for the marker.

## Follow-Up Rules

- Do not introduce TypeScript.
- Do not rename socket events after Phase 1 unless the docs are updated.
- Keep in-memory game state as the source of truth during a live game.
- Persist only session metadata until prototype reliability requires more.
