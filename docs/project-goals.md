# Scorched Earth AR — Project Goals

## Prototype Goals (Current Phase)

1. **Prove shared AR works** — multiple phones, same marker, same scene, correct per-player perspective
2. **Prove real-time sync is tight enough** — projectile animation feels simultaneous across all players (<200ms perceived lag acceptable)
3. **Prove the UX is fun in 5 minutes** — players can scan, join, aim, and fire without explanation
4. **Two-marker scaling** — prove that playground can auto-size to physical table dimensions

## Business Goals (Post-Prototype)

- Venue subscription model: venue pays monthly fee, gets permanent QR codes + admin panel
- Heineken / hospitality context: game lives on table menu card, drives engagement during wait time
- No app install barrier: pure web, works on any modern smartphone
- Operator control: host (barman) can start/reset/end games from a simple dashboard

## Technical Goals

| Goal | Target |
|------|--------|
| No app install | PWA or plain web, iOS Safari + Android Chrome |
| Marker tracking | Works under typical bar/restaurant lighting |
| Sync latency | <200ms for projectile broadcast |
| Join flow | < 30 seconds from QR scan to in-game |
| Concurrent players | 2–6 per game, multiple games per venue |
| Hosting cost at prototype | $0 (free tiers: Render, Netlify, MongoDB Atlas) |

## Infrastructure

| Layer | Service | Notes |
|-------|---------|-------|
| Frontend | Netlify | Same account as dino-pub |
| Backend | Render | New service: `scorched-earth-api` |
| Database | MongoDB Atlas | Same cluster as dino-pub, DB: `scorched-earth` |
| AR | AR.js + A-Frame | CDN, no build step for AR page |
| Real-time | Socket.IO 4.x | Carried over from dino-pub |

## What We Are NOT Building Yet

- Venue subscription / payments
- Venue admin dashboard
- Player accounts (identity is ephemeral, localStorage only)
- Native app
- Sound
- Analytics

## Relationship to Dino-Pub

Scorched Earth is a **sibling project** in the same VentureBay / Heineken venue ecosystem. Code sharing policy:

- **Reuse directly:** Socket.IO room pattern, DiceBear avatar generation, QR code generation, player identity (localStorage)
- **Adapt:** Venue/table URL schema (new concept vs. dino-pub's TV-code pairing)
- **Replace:** Game engine entirely new (AR + 3D artillery vs. 2D canvas runner)
- **Future:** If prototype succeeds, Scorched Earth may be incorporated into the common venue platform alongside Dino-Pub

## URL Schema (must be stable for printed QR codes)

```
/venue/:venueId/table/:tableNo          → player entry point
/venue/:venueId/table/:tableNo/game/:id → specific game (deep link)
/admin                                   → host panel (password protected)
/ar/game.html                           → AR scene (loaded after join)
```
