# One product, two activities: coherent Map / Explore / Plan / Follow architecture

**Companion to:** [FINDINGS.md](FINDINGS.md), [SCREEN-BLUEPRINTS.md](SCREEN-BLUEPRINTS.md) and [HIKING-UX.md](HIKING-UX.md). This describes a product-facing UI contract and adoption sequence. Do not create a new routing or persistent-state layer merely to conform to it.

## A. Shared shell, activity-specific meaning

**Recommendation:** Retain one app chrome and one map workspace. Apply an **activity presentation adapter** so the same region (search, sheet, map tools, route summary, context, Explore, library and live session) responds differently to Ride vs Hike.

| Role/screen | Shared by both | Motorcycle / ADV Ride | Hike |
|---|---|---|---|
| Mode choice | Current activity visible; accessible switch in Menu/Settings | Ride | Hike |
| Map home | Search, map, locate/layers, contextual quick actions | Where to?, Plan loop, Free Ride, Record; Gas/Coffee/roads when contextual | Find trail/place, Plan hike, Draw trail, Nearby trails; trailheads/terrain, never default Gas chip |
| Search | Geocoding, list selection, recent/nearby | Road destinations, stores/food, riding areas | Trail name vs region/place search, parks, trailheads |
| Plan | Existing authored geometry and map point tools | Destination/loop, bike, curves, surface, traffic/avoidances | Trail start/end/stops, there-and-back, foot eligibility, elevation, hike time |
| Preview | Title, geometry, time, distance, provenance, Start/Save/share as supported | Fast/Curvy/etc **only with actual candidates**; road and traffic facts | Foot route, known trail/road share, grade/gain/loss, remote snap to path, estimated walking time |
| Explore | Same search/list/map states, selection, filter storage | Saved/catalog rides, surface/curviness, source | Named trails/local sections, length/gain/grade/difficulty, trailheads, access uncertainty |
| Detail | One primary “use this route” task, source, map, metadata | Ride this / Plan route | Plan this hike / choose segment / get to trailhead |
| Live | Shared recording/GPS/safety lifecycle architecture | Maneuvers, ETA, fuel/along-road stops, glove controls | Trail progress, distance/gain/time left, backtrack, off-trail; only show supported capabilities |
| Library | Same persistence, file import/export and undo | Planned/recorded rides, bike profile | Planned/recorded hikes, foot profile, source trails |
| Offline | Honest capability breakdown | Saved GPX, basemap, local motorcycle graph, offline safety limitations | Saved trail, map pack, foot graph, offline hiking guidance (not all currently built) |

**Avoid the false shortcut:** `activity === "hike" ? "hike" : "ride"` string replacement on a motorcycle view model. Each projection must receive typed *activity-appropriate* facts or render “unknown/unavailable.”

## B. Mode persistence and routing transitions

Source currently persists `og-activity-mode` in local storage. The app may load a previous ride document, selected route or return pointer concurrently. Claude should map these crossings before optimizing the UI:

1. Enter Hike from Ride **without destroying an active ride/recording or modifying a source route silently**.
2. Cancel wrong-activity in-flight planning without hiding user-authored stops/sketch without explanation.
3. Returning to Explore uses the active mode; deep-link to a Hike trail detail still works regardless of previous stored mode, or offers an explicit Hike switch before planning. Preserve page/navigation identity.
4. Importing a GPX/old trail does not silently classify it as a road ride. If activity provenance is absent, ask/show unclassified and allow explicit mode choice.
5. Persistent previous-mode setting in browser does not mean the server has activity-specific data; show truthful loading/error when a provider is unavailable.
6. A user starting a new Hike should not see stale Ride “Best ride” results, bike, traffic, fuel chips, or a mismatched Start action. Similarly, Ride should not show a previous Hike candidate.

### Presentation mode precedence

A single derived *display state* should decide what occupies each interface slot:

1. Active navigational session (ride/hike) owns maneuver and instrument slots.
2. Explicit map editing/point-placement tool owns map gesture hints and Cancel/Done.
3. Route result/preview owns route summary and Start/Resume.
4. Selected place/trail owns its detail.
5. Search owns results and keyboard focus.
6. Idle map owns search, quick actions and bottom nav.

A high-priority mode **temporarily suppresses** lower-priority chrome; it does not reset their underlying data. One `BottomSurface` owner for the viewport, no parallel fixed bars and no invisible backdrop stealing events.

## C. Proposed shared visual slots

Phone 440×956 reference (flexible, with safe-area and keyboard insets):

```text
┌─ Top slot (Search / From-To / Maneuver) ─┐
│                                          │
│        Interactive MapLibre canvas        │
│       center/selected geometry fitted     │
│                                          │
│    Right slot: Locate / Layers / zoom     │
│                                          │
├─ Context slot (idle actions, place, route │
│   preview, editor, or active instruments) │
└─ Global nav OR active context, never both ┘
```

Desktop 1440×900 reference: top nav; left planning/explore rail (target 400px), flexible map; a right inspector only if map still useful. A context slot must never host unrelated Ride widgets during Hike. iPad landscape has compact side rail, not stretched phone-width sheet. Use existing `PlannerWorkspaceFrame`, `PlannerWorkspaceDock` and `Sheet` as the physical implementation seam.

**No new hard-coded top offsets across `nav.css`, `planner-shell.css`, `route-context.css` and `layers.css`.** Consolidate ownership of the header, map tools, overlays and inspector after real screenshots/behavior tests. Base camera fit on element measurements, not arbitrary padding.

## D. Five complete user journeys to make feel coherent

### 1. Motorcycle: "I have an hour and want curvy backroads"

Map opens to search/Plan loop, not an advanced control wall. Tap Plan loop → 60 minutes → Curvy (if chosen) → Make my loop. Show actual candidates, concise time/distance and character. Start or Save. Advanced exclusions are one intentional step away. No hidden settings requirement.

### 2. Motorcycle: "I found a shared GPX and want to ride it"

Explore/import → route detail with original source, geometry, reliable distance, provenance → Ride this opens **the same track**. Show meaningful warning when imported/catalog metrics differ from a computed alternative. Let the rider replan *explicitly*, never automatically swap original geometry on Back or reload.

### 3. Hike: "I want an easy waterfall hike near Jim Thorpe"

Choose Hike → Explore → search location/park (not granted GPS prerequisite) → filter ≤5 mi and modest gain from known data; waterfall tag **only if sourced**. Choose real trail/section, inspect map, elevation, trailhead and access uncertainty. Plan on foot graph → verify snap/road warning and intended route. Never fabricate a waterfall or claim kid-safe from raw grade.

### 4. Hike: "I want to draw this trail and follow it"

Map → Draw hike → map gestures go to sketch, with Undo/Cancel/Done → source line shown as user sketch, not an automatically valid foot route → optional Plan on trails (may change actual geometry) → Save track vs computed plan clearly distinguishable. Reload keeps draft; offline limitation made explicit.

### 5. Hike: "I'm halfway along and lose coverage"

If supported, keep existing session/recording and show last known location and downloaded coverage. Do not assert online guidance works offline or silently create a detour from original trail start. If foot-graph follow is not implemented, describe exactly what remains available (e.g., static breadcrumb/position) and do not display an active unsupported Start hike control.

## E. Cross-cutting data contracts that prevent pretty misinformation

- **Route identity:** source feature id, source geometry, revision, chosen computed candidate id, and rendered map line must stay consistently linked. Track vs route vs reference preview are distinct.
- **Distance:** mapped trail segment length vs planned one-way route vs total out-and-back vs recorded distance are different quantities. Label them.
- **Time:** candidate ETA vs predicted hike duration based on Tobler grade vs personal pace vs daylight are different quantities. Avoid false minute-level confidence.
- **Difficulty:** sourced SAC classification vs calculated grade/gain vs hiker skill are different. Don't substitute one as another.
- **Access:** OSM/path/hike graph eligibility is not a legal access guarantee. Closures/seasonality/land manager restrictions need separate authoritative sources.
- **Offline:** basemap, trail geometry, routing graph, weather/alerts, Live Activity and location fixes have separate readiness states.
- **Suggestions:** category/rating/dogs/children/“easy” tags are evidence-backed when possible, otherwise labelled as estimates or unknown. Unsupported computed labels should not look authoritative.

## F. Error and empty-state matrix (both activities)

| Condition | Ride response | Hike response |
|---|---|---|
| GPS permission denied | Search/select start manually; don't block Explore | Search trail/place/region; use map area; no “nothing nearby” conclusion |
| No chosen route | Plan route with start/destination or loop | Choose trail or set map points; Draw hike if map supports |
| No candidates | Explain routing constraints and useful edits | Explain foot routing unavailable/no trail connection; show source sketch/catalog line separately |
| Remote endpoint snap | Warn as appropriate; don't invent connector | Surface meters and likely foot approach issue prominently |
| Missing surface/access | Unknown/unclear, no safe-road guarantee | Unknown/unclear, no legal or dog/kid suitability guarantee |
| DEM/weather unavailable | Route exists without those optional facts | Hike exists, estimated time caveat; no invented gain |
| Offline map but no routing graph | Offline map view only | Same; don't show offline foot reroute |
| Catalog source is multipart | Preserve original pieces | Select actual segment; never join fragments through phantom trails |
| Mode change mid-draft | Preserve draft or request explicit decision | Same; hide incompatible candidate rather than changing it |
| Map error | Search may still work; retry map | Trail list/details can still work; retry map, show source status |

## G. Delivery and architecture discipline

Do **not** combine this entire roadmap into a giant all-or-nothing PR. First implement the shared-slot/visibility contract and fix Hike P0 correctness defects. Next, consolidate Explore presentation with activity-aware adapters; then route detail/preparation. Later features (AI hike loops, offline foot guidance, pace learning) require separate domain/infra projects.

Suggested review assertions:

- There is no screenshot in which a Hike card, map tool, inspector and tab bar all compete for the same tap region.
- No active Hike screen displays "Best ride", road traffic preference, bike profile or motorcycle "Free Ride" copy.
- No motorcycle user has to change six route preferences before getting directions.
- Explore selection and Back keep map line, filter and scroll consistent.
- The same ride/hike route line is used for map, actions, save and export.
- Reduced motion, reduced transparency, large type and denied permissions still produce a complete flow.
- No new routing engine, copied route store, invented alternatives or silently mutated GPX is introduced by the UX work.

**Proof artifact:** side-by-side annotated screenshots of both activities in the **same state and viewport**, with Playwright assertions and a concise user journey. It is not enough to show only a beautiful static idle screen.
