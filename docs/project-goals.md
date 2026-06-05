# Scorched Earth AR - Project Goals

## Prototype Goals

1. Prove shared AR works: multiple phones track the same table marker and see the same battlefield from their own seat angle.
2. Prove real-time sync is tight enough: projectile launch, flight, and explosion feel simultaneous across players. Target perceived lag: under 200 ms.
3. Prove the UX is fun in 5 minutes: scan QR, join, aim, fire, watch the shared shot.
4. Prove the venue model: one permanent QR per table, no app download, browser-only play.
5. Keep the prototype small enough to test on real phones quickly.

## Recommended Demo Scope

Build this first:

- Player lobby for 2-6 players.
- Host-only init session with sensible defaults.
- One custom AR marker copied locally from ARFly.
- One shared flat battlefield.
- Tanks arranged around the field.
- Turn-based aiming with azimuth, elevation, and power.
- Server-computed projectile trajectory.
- Broadcast projectile animation and explosion.
- One-shot elimination, last tank wins.

Defer this until the core loop feels good:

- Two-marker scaling.
- Terrain building.
- Terrain destruction.
- Wind.
- Sound.
- Venue subscription/payment features.
- Venue admin dashboard beyond a simple host panel.

## Field Size Decision

Default physical battlefield size: 0.8 m x 0.6 m.

This is large enough to feel like a tabletop game on a pub table, but still small enough that a phone camera can see the marker and the whole battlefield comfortably from a seated position.

Prototype size presets:

| Preset | Physical size | Use case |
| --- | --- | --- |
| Small | 0.6 m x 0.45 m | Small tables, tight camera angles |
| Medium | 0.8 m x 0.6 m | Default pub-table demo |
| Large | 1.0 m x 0.75 m | Larger tables with good lighting |

Implementation note: all clients receive the same arena config from the server. The AR scene applies that config as a root battlefield scale, so every phone renders the same logical field.

## Host Init Session

Yes, we should have a short init session from the lobby, but it should be host-only and default-driven.

Host chooses:

- Field size: Small, Medium, Large. Default: Medium.
- Scene preset: Classic Grid, Pub Table, Crater Field. Default: Classic Grid.
- Max players: 2-6. Default: 6.
- Optional fun mode: Normal Bomb or Leap-Frog Bomb. Default: Normal Bomb.

Players should not need to configure anything except nickname/avatar. The demo must still work if the host just clicks Start.

Terrain building should not be free-form in the first prototype. If included later, make it a 10-second preset selection or voting step, not an editor.

## Stable URL Structure

Printed QR codes must point to stable URLs.

Frontend routes:

```text
/venue/:venueId/table/:tableNo
/venue/:venueId/table/:tableNo/game/:gameId
/ar/game.html?gameId=:gameId&playerId=:playerId
/admin
```

Backend API routes:

```text
GET  /api/venue/:venueId/table/:tableNo/games
POST /api/venue/:venueId/table/:tableNo/games
GET  /api/games/:gameId
POST /api/games/:gameId/start
POST /api/games/:gameId/reset
```

Socket.IO namespace:

```text
/game
```

Room name:

```text
gameId
```

## Infrastructure

| Layer | Service | Notes |
| --- | --- | --- |
| Frontend | Netlify | Same operational pattern as dino-pub |
| Backend | Render | New service: `scorched-earth-api` |
| Database | MongoDB Atlas | Reuse same Atlas cluster/account as dino-pub |
| AR | AR.js + A-Frame | CDN is acceptable for prototype |
| Real-time | Socket.IO 4.x | Same room pattern as dino-pub |

## MongoDB Decision

For the prototype, use the same MongoDB Atlas cluster as `dino-pub`, but use a separate database name:

```text
scorched-earth
```

This keeps operational setup simple while keeping collections separate from the sibling project.

Initial persistence can be minimal:

- venues
- tables
- game_sessions
- optional event log for debugging

Live gameplay state should stay in memory first. Persist only enough to recover or inspect test games. If Render restarts during a live game, the prototype can lose that game.

## HTTPS Decision

For real phone AR testing, HTTPS is mandatory or effectively mandatory:

- iOS Safari requires secure context for camera access.
- Android Chrome behaves best with HTTPS for camera and sensor APIs.
- `localhost` is fine for desktop dev, but phones need a trusted HTTPS URL.

Netlify for frontend and Render for backend should be enough for real-device testing, provided:

- Netlify serves the AR page over HTTPS.
- Render serves the Socket.IO/backend API over HTTPS.
- CORS allows the Netlify origin.
- Socket.IO client points at the Render URL.

For quick local phone tests before deployment, use an HTTPS tunnel such as ngrok or Cloudflare Tunnel.

## Marker Assets

Use the local copied ARFly marker for the first prototype:

```text
frontend/ar/markers/pattern-ARFly_binary_clean_05.patt
frontend/ar/markers/pattern-ARFly_binary_clean_05.png
```

The AR scene should use the `.patt` file as a custom pattern marker. The `.png` file is for printing and documentation.

## Relationship to Dino-Pub

Scorched Earth is a sibling project in the same VentureBay / Heineken venue ecosystem.

Reuse directly:

- Socket.IO room lifecycle patterns.
- DiceBear avatar generation.
- Player identity stored in localStorage.
- Render backend deployment pattern.
- Netlify frontend deployment pattern.
- MongoDB Atlas account/cluster.

Adapt:

- Venue/table URL schema.
- Host/admin flow.
- QR code permanence.

Replace:

- Game engine.
- Rendering.
- Client control model.

## Business Goals Later

- Venue subscription model.
- Permanent QR/table cards per venue.
- Admin panel for operators.
- Analytics.
- Sponsor/brand-specific visual themes.
- Integration into a broader venue platform alongside Dino-Pub.
