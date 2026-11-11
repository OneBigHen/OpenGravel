# R3-5: Riding things first, no false promises

**Rider sentence:** "Layers and Settings show riding things first, and nothing promises what is not there."
**Worker:** DeepSeek V4.1 Flash on the overflow server (`fleet move auto`), Opus reviews. **Size:** S (estimate). Runs beside everything; land it before R3-8.

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/next`. Read `AGENTS.md`, and `DESIGN.md` before any screen work.
House rules: on docker-dev run only `npm run typecheck`, `npm run lint` and the unit tests you touched; never `npm run build`, the full suite or the scorecard there (one heavy job at a time, 10 GB box). Never scan `/` or `~`. Frozen areas stay untouched: hiking, Spotify, cameras, Ask/Jev, wind, sun lighting, long trip, live follow. Unknown or unavailable is never shown as open, clear, legal, paved or safe. `npm run css:budget` must not rise. Report in plain English with the commands you ran and their results. Audit screenshots named below are in `.fable/shots/audit/`.

## What is wrong today (seen on production)
- **Layers** (`phone-light-31-legend.png`, `phone-dark-30b-layers-scrolled.png`, `desktop-light-30-layers.png`): the first quick set is Hiking; the list holds Trails, Trailheads, Water sources, Shelters and campsites, Summits and Wind. Hiking and wind are frozen. Source: `src/application/map-layers/catalog.ts` (quick sets near line 365), `src/ui/layers/MapLayersPanel.tsx`.
- **Settings** (`phone-light-50b-settings-full.png`, `desktop-light-50-settings.png`): order is Day/Night, Ride/Hike, Ask, Traffic cameras, Map style, Spotify, then "My bike". "I understand and acknowledge this collection." "Offline areas: There are no areas to download right now."
- **Offline dead ends:** planner row "Save this area for offline" (`src/ui/planner/PlannerPreparation.tsx:560`), "Offline maps" on a curated ride (`src/ui/explore/RouteDetail.tsx:571`) and in route options (`src/ui/planner/RouteOptions.tsx:40`) all lead to that empty Settings section (`src/ui/settings/OfflineMapsSection.tsx:430`).
- **Explore map** (`phone-light-40-explore.png`, `phone-dark-40-explore.png`): "105 mapped" next to a longer list; the map credit box sits open over the map on a phone; list thumbnails stay light in dark theme.
- **My rides** (`phone-light-16b-myrides.png`, `phone-light-17-myrides-empty.png`): the ride line on a card is red (plum everywhere else); the empty card sits at the bottom of the screen on first load and at the top after an import.

## Build
- Layers: quick sets in this order: Fun roads, Weather, Gas and food, Traffic. The Hiking set, the four trail stop layers and Trails are listed only when Planning activity is Hike. Wind is not listed when Planning activity is Ride. Do not delete any layer or change its data.
- Settings order: Your bikes, Home, Day / Night, Map style, Units and data, Feedback, then one closed group "More" holding Planning activity (Ride/Hike), Ask, Traffic cameras, Spotify, Usage data. The usage checkbox reads "Share anonymous usage data".
- Offline: remove the three links and hide the Settings "Offline areas" section while the server offers no areas (keep the code; R3-7 reuses it). If areas exist, show the section as today.
- Explore: the count reads "112 rides" (the list's own count); the map credit starts collapsed on phones; thumbnails follow the theme if a dark picture exists, otherwise leave.
- My rides: card line in the route colour token; the empty card always at the top.

## Files
`src/application/map-layers/catalog.ts`, `src/ui/layers/MapLayersPanel.tsx`, `src/ui/layers/useMapLayers.ts`, `src/app/SettingsClient.tsx`, `src/ui/settings/*.tsx`, `src/ui/planner/PlannerPreparation.tsx`, `src/ui/planner/RouteOptions.tsx`, `src/ui/explore/RouteDetail.tsx` (the one link), `src/ui/explore/ExploreMap.tsx:119`, `src/ui/rides/RidesLibrary.tsx`, `src/ui/rides/rides.css`.

## Pass/fail
- `npx vitest run tests/unit/map-layers tests/unit/ui` passes, with a new case: with activity Ride the layer list has no id in `trails, trailheads, water-sources, shelters, summits, wind` and the first quick set is `fun-roads`; with Hike they are back.
- `grep -rn "settings#settings-offline-title" src/ui/planner src/ui/explore/RouteDetail.tsx` prints nothing.
- Browser (CI): `settings.spec.ts`: the first section heading is "Your bikes"; `offline*.spec.ts`, `hike-*.spec.ts`, `explore*.spec.ts`, `library.spec.ts` still pass (update selectors, do not skip).
- Shots: layers panel, settings, explore, my rides; phone and desktop; both themes.
