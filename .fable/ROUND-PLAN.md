# OpenGravel "world class" round plan (2026-11-10)

Shots are in `.fable/shots/`. Code paths are relative to the repo root. Nothing here was built or run; numbers marked "target" are estimates.

## 1. Verdict

1. **Curvy does not seek curves.** REVER sells a twisty engine and Butler roads ($39.99/yr PRO, rever.co/pro). Our twisty router profile has no curvature term (`infra/graphhopper/custom-models/motorcycle-twisty.json`); the only curvature rule sits behind a shadow switch (`src/infrastructure/routing/graphhopper/ride-formula-rules.ts`, `OGV_RIDE_FORMULA: 'shadow'` in `scripts/scorecard/run.ts`). Result: 0 wins on the 10 curvy rides (PR #210 table).
2. **Layers are a hiker's sheet.** Gaia sells 250+ maps and overlays (Gaia help centre, membership page). Ours opens on two map types and a "Hiking" quick set first; the first rider road layer is below the fold (`phone-light-layers.png`; `src/application/map-layers/catalog.ts:351`). A "Trail closures: not available yet" row ships with source "TODO" (`catalog.ts:88`).
3. **The planner asks 13 questions before it knows where you are going.** Four segmented groups plus two toggles, a grey disabled button and clipped helper text (`desktop-light-home.png`). Five green blocks compete with the one action.
4. **Night loses the map.** Night is grey streets with no forest, terrain or surface (`desktop-dark-planloop.png`, `phone-dark-planloop.png`), so the "trail instrument" look only exists by day.
5. **Small breaks that read as unfinished:** a sheet slab on phone home that `DESIGN.md` §5 forbids, three map buttons plus a fourth hidden behind Locate where the rule is two (`phone-light-home.png`), an orphan fifth quick-set tile (`desktop-light-layers.png`), a blank "Loading map…" 4 s after load (`phone-light-planloop.png`), and Explore's overview map is a grey scribble (`phone-light-explore.png`).

Gap in the evidence: no shot shows a planned route or the ride screen (`/?plan=loop` did not open a loop). Package 1 fixes that before any redesign is judged.

## 2. Look and layout

**Shared rules (all screens).** Five type sizes stay (28/20/16/14/12, `src/app/tokens.css:138-142`). Weights become 500 text, 600 controls, 700 titles; 650 and 800 go. One eyebrow level per panel (today "RIDE STYLE" sits over "ROADS"). One segmented control, one row, one card, one icon button, defined once in `src/app/controls.css`. Touch heights: 56 riding, 48 phone, 40 desktop; today 44, 40, 48, 52 and 56 are all hand-written.

**Desktop planner rail (1181 px and up).** Top bar 64 to 48 px, tagline removed, weather chip added (phone has it, desktop does not). Rail 384 px, full height, three zones: fixed head (mode tabs, From/To), scrolling body, fixed 72 px foot holding the action so nothing clips. Body shows two groups only: Roads (Fast, Balanced, Curvy, Backroads) and Surface (Paved, Mostly paved, Mixed, Dirt OK). Road familiarity, Traffic, Avoid highways and Avoid tolls move under one closed "More options" line that summarises their state. Removed: the "No plan yet ×" header, the grey disabled "Create ride", the helper sentence. In Loop mode the action is always live: "Plan a 2 h loop from here".

**Phone home and plan sheet (440 px).** Home: remove the slab; Loop, Record, Free Ride float 12 px above the tab bar as the rule already says. Map buttons: Layers and Locate only; 3D moves into Layers (it is already a tile there), compass folds into Locate. Chip row becomes Twisty, Gravel, Gas, Food (the first two switch quick sets). Plan sheet detents: peek 104 px (ride name, time, Start), half 46%, full. Hero per `DESIGN.md` §5; under it one fact line "62 mi · 41% gravel · 3 mi unknown" and a 6 px surface bar the full sheet width.

**Layers sheet.** Order: (1) Map type, one scrolling row of 72 px cards: Trail map, Night, Satellite, USGS Topo. (2) Quick sets, one scrolling row of four chips: Gravel day, Twisty day, Is it open?, Weather. No orphan tile; Hiking appears only when Settings activity is Hike. (3) "On the map now": active layers with colour swatch and an off switch. (4) Roads, Access, Conditions, Stops, Map view as collapsed groups with counts. Rows 56 px: swatch, name, one-line legend, switch. Any line-colour layer puts a small legend chip on the map bottom-left. Desktop: same component, 360 px popover, max height viewport minus 160 px.

**Ride screen.** No shot exists; spec from `DESIGN.md` §5 and the PLAN bar. Maneuver card 96 px (distance 44 px Outfit, street 20 px). Bottom strip 64 px, three 28 px tabular readouts. Right column: at most four 56 px buttons (Menu, Mute, Recenter, Report). Everything else (music, interest cards, fuel line, stop search) opens from Menu. Map at least 80% of the screen. `src/ui/ride/ride.css` (3,071 lines) splits into a core file of 900 lines or fewer and lazy extras.

**DESIGN.md proposals (owner must OK; workers build to the current rule until then).**
- P1: selected segments turn neutral (raised surface, ink text); green is only the action, active tab and switches. Changes the `--og-primary` job "selected control".
- P2: Night uses our own dark terrain style (forest tint, hillshade, gravel drawn as gravel) instead of Mapbox `navigation-night-v1`. Changes §3; feeds PLAN milestone 10.
- P3: glass only on chrome over the map; Explore and Settings cards go solid on the topo backdrop. Changes §2 "glass everywhere". Reason: 97 `backdrop-filter` declarations.
- P4 (additive): eight `--og-layer-*` colour tokens; layer colours are hex in TypeScript today (`src/ui/layers/MapLayersPanel.tsx:116-126`).

## 3. CSS strategy

Measured today: 35 files, 20,014 lines. Tokens are already respected (10 hex literals, zero literal font sizes outside `tokens.css`). Only 62 of 1,639 classes are unreferenced. So the bulk is **duplication, not dead code**: 97 `backdrop-filter` blocks, 659 `font-size` declarations, 35 literal radii, 20 literal shadows, 22 distinct media queries where `DESIGN.md` allows four breakpoints. No stylelint, no `toHaveScreenshot` baselines.

Order:
1. **Baselines first.** Record screenshots for 11 states (the nine in `scripts/og-shots/journeys.mjs` plus `layers-open` and `loop-planned`), two devices, two themes, fixture map, on the CI runner.
2. **Ratchet gate.** `npm run css:budget` (new, about 40 lines in `scripts/qa/`): counts total lines, lines per file, `backdrop-filter`, distinct media queries, literal radius/shadow. Fails if any number rises above the checked-in budget. Add stylelint with `declaration-property-value-disallowed-list` for hex, rgb, px font sizes, literal radius and shadow.
3. **Primitives** in `controls.css`: glass surface (two classes), segmented, row, card, pill, icon button, switch, sheet head.
4. **Migrate biggest first**, one file per PR, zero unapproved screenshot diffs: `ride.css`, `route-detail.css`, `ride-prep.css`, `itinerary.css`, `rides.css`, `explore.css`.
5. **Lazy-load frozen-feature styles** (advisor, emergency, follow, hike, music: about 1,500 lines) with their components.

Round targets: 20,014 to 13,000 lines or fewer; `ride.css` 1,800 or fewer; `backdrop-filter` 12 or fewer; media queries 8 or fewer; literal radius/shadow 0.

## 4. Layers for riders (ranked)

| # | Layer | Free, legal source | In repo? | How it shows |
|---|---|---|---|---|
| 1 | Road surface: paved, gravel, dirt, unknown | OSM (ODbL) via Gravel Atlas | Yes (`gravel`) | Line colours, unknown hatched, legend chip. Gravel day |
| 2 | Twisty roads, three grades | Own curvature catalogue | Yes (`great-roads`) | Three line weights. Twisty day. Our answer to Butler |
| 3 | Open today: seasonal gates, forest roads | USFS MVUM, PA/NJ agencies (public) | Yes (`mvum`, `src/server/planning/road-authority.ts`) | Green open, red closed, grey unknown. Is it open? |
| 4 | Closures, crashes, road work | WZDx (public), TomTom free tier | Yes | Icons plus red line. Is it open? |
| 5 | Rider routes on the map | Own catalogue, 112 routes | Data yes (`data/catalog/routes.json.gz`), layer no | Thin plum lines, tap for "Ride this". Answers REVER discovery. Licence note in PLAN risk 5 |
| 6 | Public land | USGS PAD-US (public domain) | Yes | Soft fill, name on tap. Gravel day |
| 7 | Fuel with range gaps | OSM `amenity=fuel` | Stops yes but from TomTom Search; move to OSM | Pumps plus amber route stretch beyond bike range (garage has range) |
| 8 | Private and no-access roads | OSM access tags | In router data, layer no | Red dashes at zoom 12+. Gaia charges for parcels; we show what matters to a rider |
| 9 | Gates, fords, water crossings | OSM `barrier=gate`, `ford=yes` | No | Small icons. Gravel day |
| 10 | Rain radar and weather alerts | RainViewer, NWS (public) | Yes | Raster with timeline. Weather |
| 11 | USGS Topo and USGS imagery map types | USGS National Map tiles (public domain) | No | Two more map-type cards, no Mapbox quota |
| 12 | Wildfires | NASA FIRMS (public) | Yes | Points. Is it open? |
| 13 | Rough tracks for your bike | OSM `tracktype`, `smoothness` | In router data, layer no | Lines beyond your bike's limit in red |
| 14 | Roads you have ridden | Own rides | Yes | Faint blue |
| 15 | No-signal areas | FCC mobile coverage (licence not confirmed) | No | Park until licence is read |

Leaves the rider sheet: Trails, Trailheads, Water sources, Shelters, Summits, Steep ground, Trail closures (Hike activity only). Not building: parcels with owner names (no free statewide source), smoke, more weather.

## 5. Routes: three changes

1. **Curvy really seeks curves.** Turn the curvature rules on for Curvy and Backroads requests (`ride-formula-rules.ts`, switch read at `src/server/planning/plan-service.ts:847`), or bake `curvature` into `motorcycle-twisty.json` and re-import the graph on the Windows PC. Delete the shadow switch either way. Proof: `npm run scorecard -- --set tuning`: curvy rides 0 to 4 or more wins, no other ride worse, trust failures 0.
2. **Loops built from known good roads, not a random turning point.** Loops use GraphHopper `round_trip` with a seed (`request-builder.ts:799`). The corridor tours that should replace it put via points on corridor ends the router treats as dead ends, so 0 of about 20 tours survive and about 90 good miles were lost (PR #210). Add a per-corridor "rides through for this bike" flag at atlas build time (`scripts/build-gravel-atlas.ts`, `src/server/roads/gravel-atlas.ts`), place via points mid-corridor on through corridors only (`src/application/planner/atlas-generators.ts`, `atlas-dirt-loops.ts`, `corridor-prize-loop.ts`), and do the same for curvy loops from the great-roads catalogue (`src/server/roads/known-roads-db.ts`, `fun-generators.ts`: on or deleted). Proof: scorecard rides 4, 5, 6, 14 go Tie to Win; good miles over fastest back above +250; trust 0; average planning 12 s or less.
3. **One detour budget, shown to the rider.** Dirt may run 75% over fastest (`DIRT_DETOUR_CAP = 1.75`, `src/application/planner/rider-mode-search.ts:47`) while the scorecard fails anything over 35%; curvy is 1.35, balanced 1.25. Rides 15 and 20 lose on time. Make it one dial (Direct 1.15, Balanced 1.35, Scenic 1.75; our version of REVER's twisty slider), default 1.35, and pick the most good miles inside it (`plan-service.ts:916-929`, `:1341`, `curvy-search.ts`). Proof: scorecard A-to-B rides (12, 15 to 20): none over budget, 3 or more wins.

First step of package 2: paste the per-ride tie reasons from `scorecard-out/latest.json` into the PR. That file is not in this worktree, so the ride-by-ride effects above are reasoned from code and PR #210, not measured.

## 6. Work packages

| # | Rider sentence | Files | Pass/fail | Worker | Size |
|---|---|---|---|---|---|
| 1 | "The app cannot quietly get uglier." | `scripts/og-shots/journeys.mjs`, `tests/e2e/visual/`, new `scripts/qa/css-budget.mjs`, `package.json` | `npm run css:budget` exits 0; `npm run shots -- --devices iphone17promax,desktop --themes light,dark --map fixture --repeat 2` exits 0 with 0 differing pixels and includes `layers-open`, `loop-planned`; CI visual spec green | Opus, DeepSeek for the script | S |
| 2 | "Ask for twisty, get twisty." | section 5.1 | scorecard: curvy wins 4 or more, total wins not lower, trust 0 | Codex Sol | M |
| 3 | "Open Layers and see roads worth riding first." | `src/ui/layers/*`, `src/application/map-layers/catalog.ts`, `src/app/tokens.css` | `npx vitest run tests/unit/ui tests/unit/map` passes; shots `layers-open` both themes; first screen at 440 px lists surface and twisty | Opus | M |
| 4 | "Plan a ride in two choices, not thirteen." | `src/ui/planner/RideStyleControls.tsx`, `ride-style.css`, `gmaps-layout.css`, `plan-sheet.css`, `src/ui/map/MapControls.tsx`, `src/ui/nav/` | critical browser test: cold load to route in 3 taps; shots `plan-idle`, `route-choices`; map buttons count is 2 at 440 px | Opus | M |
| 5 | "Loops follow real gravel and real curves." | section 5.2 | scorecard: 9 or more wins, trust 0, good miles above +250 | Codex Sol, atlas rebuild on Windows PC | L |
| 6 | "See gates, fords, private roads and other riders' routes." | `src/server/map-layers/providers.ts`, new provider files, `catalog.ts`, `src/infrastructure/map/basemap.ts` | `npx vitest run tests/unit/server tests/unit/map` passes; browser test sees zero TomTom Search requests with the Stops set on; shots of each new layer | DeepSeek, Sonnet if it stalls | M |
| 7 | "The ride screen is one glance." | `src/ui/ride/ride.css`, `RideFocus.tsx`, `src/app/controls.css`, then section 3 step 4 files | `npm run ride-sim` passes; `npm run css:budget` at 13,000 or fewer; shots `active-ride`: map 80%+, controls 56 px+ | Opus, DeepSeek for file migrations | L |
| 8 | "Tell it how far out of your way you will go." | section 5.3, `RideStyleControls.tsx` | scorecard: no ride over budget, 12 or more wins; hold-out within 2 | Codex Sol | M |

Order and parallelism: 1 first. Then 2 (Sol) runs beside 3 (Opus). Then 5 (Sol) beside 4 (Opus). 6 runs beside anything (light). 7 after 3 and 4. 8 after 5. Routing packages never overlap (one heavy worker); every routing PR attaches the scorecard, every screen PR the shots gallery. Reaching 16/20 needs 2, 5 and 8 together; I expect 12 to 14 after them and the atlas data work in PLAN milestone 7 for the rest.

## 7. Owner picks (side-by-side shots)

1. **Selected buttons:** green-filled segments as today, or neutral segments with green only on the action (P1). Shots: desktop rail and phone sheet, both themes.
2. **Night map:** today's grey Mapbox night, or our own dark terrain map with forest and gravel visible (P2). Shots: State College and Rothrock at two zooms.
3. **Glass:** glass on every card, or glass only over the map with solid cards on Explore and Settings (P3). Shots: Explore and Settings, both themes.
