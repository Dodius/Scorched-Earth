# Scorched Earth AR — Game Design

## Concept

A multiplayer tabletop AR artillery game. Players sit around a physical table that has a printed menu card with one or two Hiro-style AR markers on it. Each player scans a QR code with their phone, opens a web page, points the camera at the marker, and sees a shared 3D battlefield appear on the table surface — each player from their own seated angle.

## The AR Trick

Marker-based AR (AR.js + A-Frame) solves multi-perspective viewing automatically. Each phone independently tracks the marker and builds its own camera matrix relative to it. Players on opposite sides of the table see the same scene from opposite angles without any extra engineering. This is the prototype's core value proposition.

## Players & Setup

- 2–6 players per game
- Each player uses their own smartphone (no app install; web browser only)
- One physical table with a printed menu card bearing the AR marker(s)
- Host (barman or self-hosted) starts the game via an admin panel

## Venue Flow

```
QR code printed on table card
  → player scans → /venue/:venueId/table/:tableNo
  → sees list of active games at this table
  → joins game (or creates one if none active)
  → enters name → avatar generated (DiceBear)
  → waits in lobby until host starts
```

One permanent QR code per table. URL schema is stable — QR codes printed today still work when venue subscriptions are added later.

## Aiming System (3 parameters)

| Parameter | Control | Range |
|-----------|---------|-------|
| **Azimuth** (horizontal direction) | Tank rotates left/right | 0–360° |
| **Elevation** (barrel tilt) | Vertical slider | 5–85° |
| **Power** | Horizontal slider | 10–100% |

Tank rotation IS the horizontal aim — no positional movement in prototype. The tank spins in place on the battlefield.

## Turn Flow

1. Server picks current player (round-robin)
2. Current player's phone shows aiming UI: rotate buttons, elevation slider, power slider, Fire button
3. All other players see "waiting for [name]..." overlay
4. Player taps Fire → sends `{ azimuth, elevation, power }` to server
5. Server computes full parabolic trajectory (array of 3D waypoints, ~60 points)
6. Server broadcasts trajectory to all clients
7. All clients animate projectile along waypoints simultaneously (same timing, no interpolation drift)
8. Server checks collision: if a tank is within hit radius of any waypoint, it's destroyed
9. Server broadcasts result: `projectile-result { hit: bool, targetId?: string }`
10. Hit → explosion animation at impact point; destroyed tank removed from scene
11. Next player's turn; repeat until one tank remains

## Win Condition

Last surviving tank wins. Winner screen shown to all players with DiceBear avatar.

## Projectile Physics

- Parabolic arc computed server-side (deterministic)
- Formula: `pos(t) = origin + dir * power * t - 0.5 * gravity * t²` (in AR-space units)
- Gravity constant tuned so a max-power shot crosses the table in ~3 seconds
- Waypoints pre-computed (array of ~60 xyz points) and sent to all clients
- Clients animate along waypoints at fixed step interval (no physics re-computation on client)

## Two-Marker Scaling (Experiment Phase)

- Place two Hiro markers on the table card at a known reference distance apart (e.g., 20 cm)
- AR.js tracks both simultaneously
- Each frame: compute 3D distance between marker origins
- Scale factor = measured distance / reference distance
- Apply scale to root `<a-entity>` wrapping the entire battlefield
- Effect: battlefield automatically resizes to fill the physical space between the markers

## Visual Style

- Battlefield: flat grid plane (wireframe or subtle texture) on the table surface
- Tanks: simple geometric shapes (box body, cylinder barrel) — no complex models in prototype
- Projectile: small glowing sphere
- Explosion: particle burst + shockwave ring, ~1.5 seconds, then fades
- Player avatars: DiceBear SVG rendered as billboard sprite above each tank

## Out of Scope (Prototype)

- Terrain destruction
- Tank health points (one shot = eliminated)
- Wind
- Spectator mode
- Chat
- Sound effects
