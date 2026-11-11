# R3-7: This ride works in airplane mode

**Rider sentence:** "I keep a ride for no signal, switch to airplane mode, and still get the map, the line and the turns."
**Worker:** Opus leads (spike and design), DeepSeek for tests and the tile-list module, Sonnet for the one screen. **Size:** L (estimate), the only package with real unknowns. **Lane:** offline. Start after R3-1; its ride-screen part after R3-6. PLAN milestone 8.

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/next`. Read `AGENTS.md`, and `DESIGN.md` before any screen work.
House rules: on docker-dev run only `npm run typecheck`, `npm run lint` and the unit tests you touched; never `npm run build`, the full suite or the scorecard there (one heavy job at a time, 10 GB box). Never scan `/` or `~`. Frozen areas stay untouched: hiking, Spotify, cameras, Ask/Jev, wind, sun lighting, long trip, live follow. Unknown or unavailable is never shown as open, clear, legal, paved or safe. `npm run css:budget` must not rise. Report in plain English with the commands you ran and their results. Audit screenshots named below are in `.fable/shots/audit/`.

## Scope (decided)
One ride at a time, not regions. No offline planning. No offline rerouting: off the line the rider sees the way back to it (the head-back card already exists, `src/application/ride-session/head-back.ts`).

## What exists
- A service worker that keeps the app shell (`public/sw.js`, `src/app/OfflineShell.tsx`, `src/application/offline/shell-routes.ts`); Settings already says "This device can reopen OpenGravel without signal."
- Region packs, a basemap archive store and an in-browser router (`src/domain/offline/`, `src/infrastructure/offline/`, `src/application/offline/`, `src/server/offline/`), with browser tests `offline*.spec.ts`. Production offers no regions. Do not extend the region machinery this round.
- R3-1 makes a saved ride reopen from its stored line with no router call. The ride screen already restores a running ride from local storage (`src/application/persistence/ride-focus-pointer.ts`, `ride-session-recovery.ts`).

## Step 1: spike, one day, written answer in the PR description before any screen work
1. Which map tiles may be kept? The default map draws through Mapbox's style; its terms do not allow bulk caching. The Protomaps basemap (credited in Settings) is ours to keep. Decide: a kept ride renders on the Protomaps style when the network is gone. Measure tile count and megabytes for a 60 mi loop at zooms 8 to 14 in a 1 mi corridor (target: under 40 MB; say the real number).
2. Does the iPhone shell allow it? `apps/ios/capacitor.config.ts` has app-bound domains off, which the service worker needs. State what must change; do not need the paid Apple account.
3. What does the ride screen fetch while riding (weather, fuel, speed limits, reroute)? List each and its offline behaviour.
If any answer is "cannot", stop and report; do not build around it.

## Step 2: build
- **Module** `src/application/offline/ride-pack.ts`: from a line, the list of tile URLs (corridor, zooms 8 to 14) plus the ride document, turn instructions, surface runs and speed-limit spans. `keepRide(rideId)` stores them (tiles through the service worker cache, data in IndexedDB) with progress; `dropRide(rideId)`; `rideIsKept(rideId)` verifies every tile is present, not just a flag.
- **Screen:** on a saved ride (summary and My rides row) one switch: **Keep for no signal**, with progress and the size ("Kept, 31 MB"). Storage full or a failed tile says so and stays off. Nothing claims "offline" unless `rideIsKept` is true.
- **Ride screen with no network:** map from kept tiles; maneuver card, voice and surface-ahead work; weather, fuel search and reroute rows are disabled with "No signal"; off route shows the head-back card only. A small "No signal, kept ride" chip in neutral ink.
- Unknown stays unknown: a closure check made at keep time is shown with its time ("Checked Sat 9:14 AM, before you left signal").

## Files
New `src/application/offline/ride-pack.ts`, `public/sw.js`, `src/infrastructure/offline/basemap-archive-store.ts` (reuse if it fits), map style switch in `src/infrastructure/map/maplibre/`, `src/ui/rides/RidesLibrary.tsx`, the route summary from R3-4, `src/ui/ride/RideFocus.tsx` (offline states only), `src/ui/settings/OfflineMapsSection.tsx` (list kept rides with sizes and Remove).

## Pass/fail
- `npx vitest run tests/unit/application tests/unit/infrastructure` with `ride-pack.test.ts`: tile list for a fixture line is stable and covers every point at zoom 14; `rideIsKept` is false when one tile is missing.
- New `tests/e2e/critical/no-signal-ride.spec.ts`: plan, save, Keep for no signal, wait for "Kept"; `context.setOffline(true)`; reload; open the ride from My rides; Start; feed positions along the line: map canvas is not blank (sample pixels), at least one turn prompt changes, zero failed requests surface as rider errors; step 300 m off the line: the head-back card shows and no reroute is requested.
- `npm run ride-sim` passes; existing `offline*.spec.ts` pass.
- Same flow by hand on the iPhone simulator on the MacBook with the network off (`fleet run mac`), screenshots in the PR. If the shell blocks it, say so plainly; Safari alone still counts for this round.
