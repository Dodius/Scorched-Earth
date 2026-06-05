# Scorched Earth AR — Roadmap & Business Strategy

## Where We Are Now (June 2026)

Scorched Earth is a working prototype: full game loop, AR marker tracking, real-time projectile sync across multiple phones, scene presets, leap-frog bomb mode. Two bugs to fix before first real-phone demo (see Technical Debt section). Not yet deployed.

Sibling project AWKey.tv (Dino-Pub) is an MVP live on Render + Netlify: multiplayer Dino Run on bar TVs, prize claim flow, subscription-ready, city-partner distribution model documented. One product live, one prototype.

---

## The Core Question: One Brand or Two?

### What AWKey.tv does

TV screen. Players scan QR, join a shared game on the bar TV. Visible to the whole room. Passive entertainment. Barman controls it.

### What Scorched Earth does

Table surface. Players scan QR, point phones at the table, play in AR together around the table. Private to the group. Self-managed. Visible only to those at the table.

### They are not the same product. They are the same customer.

The bar owner pays one subscription. They get both. That is the pitch.

**Short term (0–6 months):** Keep separate codebases and repos. Scorched Earth needs to prove itself without dragging AWKey.tv's roadmap. Development speed matters more than consolidation right now.

**Medium term (6–18 months):** If real-phone demo succeeds and first venues pilot it, merge under AWKey.tv as "Table Mode." One venue dashboard, one subscription covering both TV and table. Scorched Earth becomes a premium AR tier.

**Long term:** AWKey.tv is the venue entertainment operating system. TV games. Table games. Jukebox. Analytics. Brands buy activation packages across the whole platform.

---

## The Heineken Angle (This Is the Real Opportunity)

Forget venue subscriptions for a moment. The prototype lives in a context Heineken already paid for: menu cards on tables in their partner pubs.

The play:

- Print the AR marker on Heineken-branded coasters or table tent cards.
- Scan the coaster → battlefield appears on the table.
- Heineken logo floats subtly above the battlefield as a 3D billboard.
- Winning player gets "Win a Heineken" screen.
- Explosion uses Heineken green and star particle effects (optional, tasteful).

Heineken does not pay per table. Heineken pays for a **brand activation package**: a batch of printed coasters + the hosted AR experience + a monthly engagement report (scans, plays, players reached, venues active).

This is a **€5,000–20,000 one-time activation deal** plus ongoing hosting. It maps exactly to the brand sponsorship layer already defined in the AWKey.tv business plan, but for table AR instead of TV screens.

The prototype does not need to be subscription-ready. It needs to be demo-ready for one Heineken meeting.

---

## Path to First Revenue

### Stage 0 — Fix and Deploy (2 weeks)
Fix the two known bugs. Deploy to Render + Netlify. Print the ARFly marker on a card. Test on real phones in a real bar. Get one short video: three people around a table, phones out, tank fires, explosion, laughter.

### Stage 1 — Heineken Demo (1 month)
Present to Heineken (already the context this was built for). Bring the printed coaster. Show the demo video first. Then do it live. Ask for a small paid pilot: 10 venues, branded coasters, 3-month hosting deal.

Pricing for a pilot like this: €3,000–8,000 flat fee covering design, print coordination, 3 months of hosting, and one analytics report.

### Stage 2 — Venue Pilot (months 2–4)
Alongside or after the brand deal: offer 3–5 venues the AR table game for free in exchange for feedback and photos. This feeds the AWKey.tv venue subscription pitch: "We now cover your TV and your tables."

### Stage 3 — AWKey.tv Premium Tier (months 4–12)
Add Scorched Earth as "Table AR" add-on: €15/month extra on top of any AWKey.tv plan. Venues that already trust AWKey.tv for their TV can activate table games with zero additional sales effort.

---

## Revenue Model for Scorched Earth

### Near term: Brand Activation (Higher margin, faster)

| Package | Price | What they get |
|---------|-------|---------------|
| Pilot activation | €5,000 flat | 10 venues, branded coasters, 3 months hosting, one report |
| City activation | €15,000 flat | 50 venues, coaster design + print, 6 months hosting, monthly reports |
| National activation | €40,000/year | 200+ venues, full branding, quarterly reports, custom game elements |

One national brand deal equals two years of runway at prototype cost levels.

### Medium term: Venue Add-On (Recurring, lower effort)

Bundled into AWKey.tv plans once platform is merged:

| Plan | TV included | Table AR |
|------|------------|----------|
| Standard (€25/mo) | Yes | No |
| Plus (€40/mo) | Yes | Yes, 1 marker |
| Venue (€65/mo) | Yes, 3 TVs | Yes, 3 tables |

### Long term: Multi-Game Table Platform

Scorched Earth is game one. The table AR platform can host:
- Pub Quiz (AR answer cards rise from the table)
- Darts (AR target on the wall, phones as gyro controllers)
- Card games with AR reveal animations
- Brand-specific mini-games commissioned per activation

The marker + phone-as-controller model is the platform. Scorched Earth proves it.

---

## Technical Roadmap

### Now — Pre-Demo Fixes

- Fix games-list broadcast scope (namespace → venue/table room)
- Add 30-second turn timeout with auto-fire
- Deploy to Render + Netlify
- Test on iOS Safari and Android Chrome
- Print ARFly marker at correct scale, verify tracking in bar lighting

### Phase 1 — Demo Polish (2–4 weeks after deploy)

- Add Heineken branding mode: env flag enables logo billboard, green color scheme, "Win a Heineken" winner screen
- Improve explosion: add green star particles for branded mode
- Add QR code display on a simple `/table/:venueId/:tableNo` landing page that can be printed alongside the marker
- Disconnect/rejoin resilience: if phone drops, player can re-scan QR and rejoin by stored playerId
- Turn timeout working and tested

### Phase 2 — Platform Merge (months 3–6, after pilot success)

- Migrate Scorched Earth under AWKey.tv backend (shared MongoDB cluster, shared venue/auth model)
- Shared player identity: same localStorage schema as AWKey.tv so players carry avatars across games
- Unified venue dashboard: barman sees both TV and table games in one panel
- Two-marker scaling experiment (once core game is proven in real pubs)

### Phase 3 — Table Platform (months 6–18)

- Abstract the AR scene framework into a reusable table-game engine
- Game 2 on the table platform: Pub Quiz in AR (question cards rise from surface)
- Venue analytics: table scans per hour, sessions per evening, players per session
- Brand overlay system: any brand can upload logo + color scheme, applied at runtime
- Offline resilience: game continues if one player drops, server holds state for 5 minutes

---

## Technical Debt to Address Before Scaling

| Issue | Priority | Fix |
|-------|----------|-----|
| games-list broadcasts globally | High | Room-scope the emit |
| No turn timeout | High | 30s server setTimeout |
| No disconnect/rejoin during game | Medium | Preserve socket room on disconnect for 60s |
| GameSession model unused | Low | Wire up on game start/end for analytics |
| No rate limiting on fire event | Low | Server-side flag: firingInProgress |
| AR.js from raw.githack CDN | Medium | Pin to versioned CDN before production |

---

## What Should NOT Be Built Yet

- Venue subscription payment flow (Stripe, invoicing)
- Player accounts or persistent profiles
- Venue admin dashboard beyond the current simple panel
- Multi-marker scaling (experiment phase, not production)
- Sound
- Terrain destruction
- Tank movement

None of these block the Heineken demo or the first paying venue. Build them when the prototype is proven.

---

## The One-Slide Pitch

**AWKey.tv turns pubs into gaming venues.**

On the TV: multiplayer games the whole bar can watch and play.
On the table: AR games the group around you plays together.
No hardware. No app. Scan a QR code.

Bar owners pay €25–65/month. Beer brands pay €5,000–40,000/year for activations.
One city rep signs up 20 bars and earns €500/month passively.

Currently live: Dino Run on TV, 8 players, free drinks for winners.
In prototype: Scorched Earth AR, tanks on the table, Heineken-branded explosions.

Next step: 10-venue Heineken pilot.
