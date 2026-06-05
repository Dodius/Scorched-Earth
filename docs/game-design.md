# Scorched Earth AR - Game Design

## Concept

A multiplayer tabletop AR artillery game for pubs. Players sit around one physical table, scan a QR code, open a web page, point their phone camera at a printed AR marker, and see the same 3D battlefield anchored on the table.

The mood should be light and humorous: slow visible projectile arcs, toy-like tanks, playful explosions, and simple controls. Think artillery-party-game energy rather than simulation.

## Core AR Trick

Marker-based AR solves the multi-perspective problem for the prototype.

Each phone independently tracks the same marker and builds its own camera matrix relative to that marker. Because the battlefield is attached to the marker, players naturally see the same scene from different physical angles.

No shared world mapping is needed for the first prototype.

## Players

- 2-6 players.
- One phone per player.
- Browser only, no app install.
- Ephemeral identity stored in localStorage.
- DiceBear avatar generated from username.

## Venue Flow

```text
QR code printed on table card
  -> player opens /venue/:venueId/table/:tableNo
  -> player sees active game or lobby for the table
  -> player enters nickname
  -> player waits in lobby
  -> host starts game
  -> player is redirected to AR scene
```

One permanent QR code per table.

## Host Init Flow

The host sees a compact init panel before starting:

- Field size: Small, Medium, Large.
- Scene preset: Classic Grid, Pub Table, Crater Field.
- Max players: 2-6.
- Bomb mode: Normal Bomb, Leap-Frog Bomb.

Defaults should be preselected, so the host can start immediately.

Recommended defaults:

```text
fieldSize = medium
scenePreset = classic-grid
maxPlayers = 6
bombMode = normal
```

## Field Size

The default battlefield is 0.8 m x 0.6 m in physical intent. The logical AR scene can use normalized units and scale the battlefield root from the selected preset.

Suggested logical coordinate system:

```text
field width  = 1.0 AR units
field depth  = 0.75 AR units
field center = { x: 0, y: 0, z: 0 }
```

Preset scale mapping:

| Preset | Display intent | Root scale |
| --- | --- | --- |
| Small | 0.6 m x 0.45 m | 0.75 |
| Medium | 0.8 m x 0.6 m | 1.0 |
| Large | 1.0 m x 0.75 m | 1.25 |

This can be tuned after real phone testing. The main goal is consistent scale across all clients, not centimeter-perfect measurement in phase one.

## Arena Layout

For 2-6 players, distribute tanks around an ellipse near the field edges:

```text
x = cos(angle) * 0.38
z = sin(angle) * 0.28
```

Each tank starts facing the center, but the player can rotate it during their turn. Tank rotation is the horizontal aim.

## Aiming System

| Parameter | Control | Range |
| --- | --- | --- |
| Azimuth | Rotate tank left/right | 0-360 degrees |
| Elevation | Slider | 5-85 degrees |
| Power | Slider | 10-100 percent |

Prototype rule: no tank movement at first. Movement and battery can come later after shooting feels good.

## Turn Flow

1. Server picks current player.
2. Current player's phone shows aiming UI.
3. Other players see a waiting overlay.
4. Player adjusts azimuth, elevation, and power.
5. Player taps Fire.
6. Client sends `{ gameId, playerId, azimuth, elevation, power }`.
7. Server computes trajectory and hit result.
8. Server broadcasts projectile launch with waypoints and a launch timestamp.
9. All clients animate the projectile along the same waypoints.
10. Explosion appears at impact point.
11. Hit tank is eliminated.
12. Server advances to next living player.
13. Last surviving tank wins.

## Projectile Sync

The server should send:

```js
{
  waypoints,
  hit,
  targetId,
  impactPoint,
  launchAt
}
```

`launchAt` should be a server timestamp slightly in the future, for example `Date.now() + 300`. Clients wait until that timestamp before starting the projectile. This makes animation feel synchronized even when packets arrive at slightly different times.

## Projectile Physics

Server-side only.

```text
pos(t) = origin + horizontalDirection * speed * t + up * verticalSpeed * t - 0.5 * gravity * t^2
```

Guidelines:

- 60-90 waypoints per shot.
- 40-50 ms per visual step.
- Full flight around 2.5-3.5 seconds.
- Gravity tuned for fun, not realism.
- Power maps to a modest initial speed so the arc is readable.

## Leap-Frog Bomb

Feasible as a prototype extra.

Implement it as scripted trajectory segments, not real bouncing physics:

1. Compute normal trajectory.
2. When the projectile reaches the ground, create a smaller second hop.
3. Optionally create a third tiny hop.
4. Explosion happens at the final landing point.

This gives a fun visual without introducing collision physics.

## Hit Detection

Server checks the projectile waypoints against living tank positions.

Prototype rule:

```text
hitRadius = 0.06 AR units
one hit = eliminated
```

Ignore terrain and obstacles in the first version.

## Visual Style

- Battlefield: flat grid plane or simple textured tabletop arena.
- Tanks: simple toy-like geometry.
- Projectiles: glowing sphere with short trail.
- Explosion: expanding sphere/ring plus a few debris particles.
- Avatars: DiceBear billboard above each tank.
- Scene presets should change color/material/obstacles, not core gameplay.

## Scene Presets

Phase-one presets should be cheap and deterministic:

| Preset | Description |
| --- | --- |
| Classic Grid | Clean green wire/grid field |
| Pub Table | Dark tabletop, coasters/crates as visual props |
| Crater Field | Flat surface with non-destructive crater decals |

Props are visual only in the first prototype.

## Terrain Building

Do not build a free-form terrain editor for the prototype.

If we want a pre-game terrain moment, use one of these:

- Host selects a scene preset.
- Players vote between 2-3 generated layouts.
- Server picks a random seed and shows a short "building battlefield" animation.

This gives the feeling of setup without adding editing complexity.

## Two-Marker Scaling

Keep this as an experiment after the game loop works.

Idea:

- Main marker anchors the battlefield.
- Second marker helps estimate physical spacing.
- Server/host knows the printed reference distance.
- Client scales battlefield root based on measured marker distance.

Risk:

- Multi-marker tracking can jitter.
- Pub lighting and oblique phone angles can reduce reliability.
- It should not block the first demo.

## Out of Scope For First Prototype

- Terrain destruction.
- Real terrain physics.
- Tank movement and battery.
- Wind.
- Chat.
- Sound.
- Player accounts.
- Payments or venue subscriptions.
