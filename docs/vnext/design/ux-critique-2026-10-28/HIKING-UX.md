# Hiking experience: code-grounded audit and interaction redesign

**Status:** owner-requested UX design/Claude guidance; documentation only. **Source:** `main@8fb189f` (2026-10-28). **Evidence tiers:** CODE = source-confirmed behavior, HANDOFF = documented known gap, VERIFY = needs actual browser/phone/physical-route proof. Do not claim an implementation or browser pass because this file describes it.

## 1. Core problem

Hike mode currently feels like an add-on to a motorcycle route planner in several places. A good hiking experience must answer **which trail, where does it start, how hard is it, how long will it take, can I get home before dark, can I follow it without reception?** — without exposing route-system concepts such as "breadcrumb", motorcycle "ride choices", bike profiles or road-fun ranking.

Product aim: **Gaia's map utility + AllTrails-style discovery and trail preparation + OpenGravel's trustworthy offline-first routing**. Do not copy layouts, brands, icons or proprietary assets. "Beautiful" means a coherent map-led trip from discovery through following a trail, with evidence and realistic failure messages.

The two activities should share navigational geometry, typography, accessibility, sheet mechanics, saved-route infrastructure and basic map interactions. They should **not** share inappropriate sport-specific vocabulary, scoring assumptions or routing providers.

## 2. Existing system — preserve rather than rebuild

| Surface | Current implementation | Interpretation |
|---|---|---|
| Mode | `src/ui/planner/ActivitySwitch.tsx`, `src/application/map/activity-mode.ts`, `AppMenu.tsx` | Ride/Hike selection exists and is persisted in local storage. It is behind a menu on the phone; current map may not loudly announce mode until Hike card renders. |
| Map hike controls | `src/ui/planner/HikeActivityControls.tsx`, `src/ui/nav/nav.css` | Large card displays Hiking, Back to riding, press-and-hold instruction, There and back, Plan hike, Draw hike, route warnings and grade-aware estimate. |
| Planner integration | `src/ui/planner/hooks/usePlannerHikeActivity.ts`, `PlannerWorkspaceFrame.tsx`, `PlannerWorkspaceDock.tsx` | Uses existing authored document, layout and planning session with Hike callbacks. The planner sheet still includes rider-first terminology and option projections. |
| Hike Explore | `src/app/ExploreClient.tsx:60+` delegates to `src/app/HikeExplore.tsx` | Separate list experience with Locate and filters; **not** the same map-linked Explore experience as Ride. |
| Trail cards | `src/app/HikeExplore.tsx` `HikeCard`, `TrailThumb` | Static thumbnail if Mapbox token; fallback miniature MapLibre; card displays trail name, distance to start, length, gain, estimated time and OSM difficulty. |
| Trail detail | `HikeDetail` in same file | Shows trail map, stats, OSM tags, elevation chart, trailheads (coordinates), sources, Share, **Open as breadcrumb** and **disabled Download for offline**. Multipart trail prevents breadcrumb opening. |
| Routing | `src/server/planning/hike-plan.ts`, dedicated GraphHopper hike provider | Dedicated foot graph; A→B, stops, there-and-back and breadcrumb planning exist. No motorcycle graph fallback or automatic scenic loop finder. |
| Hike recording/follow | `docs/vnext/HANDOFF-2026-10-28.md` and current Ride Focus | Some sharing/session components exist; polished Hike-focused recording, offline turn cues and complete physical acceptance remain future work. |

**Do not add an entirely new Hike backend or discard the foot router.** Most near-term gain comes from surfacing existing capabilities correctly and removing misleading controls.

## 3. Ranked hiking issue register

| ID | Priority | Evidence | Problem | Claude deliverable |
|---|---|---|---|---|
| H-01 | **P0** | HANDOFF + CODE | Mobile Hike card covers upper map; press-and-hold placement can land on card, and breadcrumb → Plan on trails remains `test.fixme`. | Compact, collapsible Hike control integrated with planner presentation; preserve drawing actions and make map placement accessible; enable test only after it passes. |
| H-02 | **P0** | HANDOFF + CODE | Desktop route inspector still projects rider labels/actions for Hike, including “Best ride”, Start ride and Free Ride. | Activity-aware view model/inspector semantics. Hike metrics/actions are explicit; no misleading ride actions. |
| H-03 | **P0** | CODE | A hike trail page's main route action is **Open as breadcrumb**; implementation creates a ride-shaped draft, saves it and returns to Map. | User-language CTA “Plan this hike” / “Open on map” with a clear preview and next action. Preserve track provenance and explain conversion; do not promise direct Start if not implemented. |
| H-04 | **P1** | CODE | Hike Explore presents a list of thumbnail cards only and lacks the Ride Explore synchronized list/map canvas. | Shared Explore shell with activity-specific map/list, selected route line, filters and Back restoration. |
| H-05 | **P1** | CODE | Hike Explore discovery depends on `readExploreOrigin` or granted geolocation; absent origin yields a location prompt; no location-name search in the current Hike Explore markup. | Search a place/trail/region and pan map without GPS permission; explicit “Use map area” and “Use my location”. |
| H-06 | **P1** | CODE / VERIFY | `ranked.slice(0, limit)` happens before elevation/gain/time filtering, and displayed count is `results.length` (current page only). `Show more trails` depends on ranked count, not fully filtered count. | Correct result-count and pagination/filter behavior with known vs unknown data semantics and clear loading states. Add unit tests before modification. |
| H-07 | **P1** | CODE | `Kid-friendly` is a heuristic of ≤3mi, ≤500ft gain and SAC hiking; “Dogs allowed” depends on OSM tagging. These aren't assured suitability or legal dog access. | Explain “Easy by mapped distance/gain” rather than a categorical child safety verdict; show “dog access reported” with source, unknown and stale states. |
| H-08 | **P1** | HANDOFF | Long named national trails appear with enormous full-route lengths (e.g., ~795mi), not the local section. | Display local accessible section; distinguish whole trail from nearby segment, with exact geometry and no invented section endpoint. |
| H-09 | **P1** | HANDOFF + CODE | Multipart trails lack breadcrumb open/elevation profile; current detail action is disabled for multipart lines. | View segments distinctly, select a real segment/section; never join disconnected geometries silently; extend planning with explicit decision. |
| H-10 | **P1** | CODE | Trailheads are presented as coordinates and distances; no primary “Get to trailhead”/parking navigation action in detail markup. | Present trailhead/parking choices and a truthful external directions handoff when supported; disclose if verified access/parking is unavailable. |
| H-11 | **P1** | CODE | Disabled Download for offline is prominent even though corridor download is unsupported. | Honest preparation checklist and available map packs; never imply a downloaded image or GPX means full offline rerouting. |
| H-12 | **P1** | HANDOFF | Jim Thorpe/Water Gap routes include roads; Lehigh Gorge probe detours 38.33km; snaps can be hundreds of meters from requested trail. | Prominent route-origin snap warnings and trail-vs-road distance, not a tiny note; no “all trail” badge without evidence. |
| H-13 | **P1** | CODE | Hike detail/list state is independent of Ride Explore's filter/query/scroll restoration; Hike Explore filters live in local component state, not URL. | Deep-linkable filters, retained selected item and scroll/back state; avoid losing a user's exploration upon returning from trail detail. |
| H-14 | **P2** | CODE | `HikeExplore.tsx` contains monolithic tightly packed JSX and concurrent geometry/elevation fetching with module caches; no-source-token thumbnail path falls back to many map instances. | Extract testable list/filter/detail components, limit rendering and requests. Preserve genuine offline and no-token fallback. |
| H-15 | **P2** | CODE + HANDOFF | Hike modes and activity copy are not consistently projected through My rides/Settings/map chips and source route actions. | Shared activity-terminology map and exhaustive content audit, not blind string-replace. |
| H-16 | **P2** | HANDOFF | Scenic loop planning, full offline hike graph packages, hike-specific following/alerts and pace learning are not yet implemented. | Honest roadmap with **future** visual states; do not ship attractive inactive “Start offline hike” or “5-mile waterfall loop” UI before backing services exist. |

## 4. Information architecture: two tasks, one app

### Task A: Find a hike (Explore)

```text
Choose Hike → Explore hikes → Search region or trail
  → Filters (length, gain, duration, surfaces/access where known)
  → List / Map synchronized → Trail detail
  → Select trailhead/segment → Plan this hike
  → Confirm actual route and any walk-to-trail gaps
  → Save/Share/Start (only when supported) or Open on map
```

At every step explain if the visible line is:
- **Catalog feature geometry**: an OSM/official mapped trail segment, possibly not a traversable loop;
- **Authored breadcrumb/drawing**: the user's track/line, not proof of a legal path;
- **Computed foot route**: GraphHopper returned path with its own snaps, length, time and road usage;
- **Recorded track**: a historical GPS trace, not necessarily a safe or legal recommendation.

These objects can be related but must **not be conflated** for preview, GPX export, distance or start.

### Task B: Plan a hike (Map)

```text
Choose Hike → Map → Select start/end or Draw
  → Optional stops/There and back → Plan on trails
  → See foot route, elevation/time, remote snaps, road portions and warnings
  → Edit/Save → Begin supported navigation or preserve map/track view
```

Use **one** compact planner surface. Do not render a large standalone Hike card in the map's primary gesture region while the generic planner sheet and inspector also render. A collapsed hike context may show the current activity, summary and primary action. The expanded sheet includes all Hike controls.

### Switching activity

`Ride → Hike` is **not** “clear the user's ride”. If the current implementation cancels pending planning when switching, preserve unsaved authored data deliberately or ask before destructive conversion. Refrain from calling a motorcycle route a foot route. If a route is incompatible with new activity, hide incompatible candidate and offer separate draft/replan, without silently changing it. On switching back, restore the correct per-activity context where technically supported; otherwise explain the current draft's state.

## 5. Proposed phone layout: hiking Map (440 × 956 CSS px)

All measurements are **targets**, not observed geometry. Respect `safe-area-inset-*`, system keyboard, dynamic type, and actual element bounding boxes. Follow locked `DESIGN.md`.

```text
┌──────────────────────────────────────────┐
│ [ Search trails or places        ] [Menu]│
│ [ Hike ▾ ]   [Nearby trails] [Layers]   │
│                                          │
│                MAP                       │
│  trail network + real contours           │
│                           [Layers]       │
│                           [Locate]       │
│                                          │
│             select/draw on map           │
│                                          │
│ ┌─ context/compact planning sheet ─────┐ │
│ │ Hiking   [From / To]     [Edit]       │ │
│ │ [Draw route]  [There & back]          │ │
│ │ [Plan on trails]  or [Explore hikes]  │ │
│ └───────────────────────────────────────┘ │
│  Map       Explore        My rides(*)     │
└──────────────────────────────────────────┘
```

(*) The locked nav says **My rides**. Changing global navigation to “Library”, “My routes”, or dynamically “My hikes” would affect product IA and needs deliberate owner approval. Contextual headings inside the library can say “Hikes” without silently rewriting the locked tab.

**Geometry:** top search x=16, y=safeTop+12, w=408, h≈52; main map controls right=16, h≥48, gap=8; collapsed Hike context under 110px where data allows, above the measured 3-tab nav when browsing; route preview replaces nav in established trip state. An expanded sheet can grow, but must not absorb long-press targets by accident.

**Contextual tools:** Place a start/end, add stops and draw. Keep keyboard-accessible equivalents for long-press. “There and back” is a shape option, not a global navigation toggle. If `Plan hike` is disabled because the required endpoints are absent, show a single clear instruction.

### The map's 3 interaction modes

- **Browse:** pan/zoom, tap trail/point to see details, no accidental add-stop.
- **Place points:** map taps/long-press are explicitly armed; toast/hint says "Tap a starting point", "Add finish", "Add a stop". Undo/Cancel visible.
- **Draw:** an explicit Draw mode with Done/Undo/Cancel; while drawing, suppress conflicting map pan and sheet drag. When Done, show actual length, provenance and "Keep as sketch" vs "Plan on trails" as backed by current capabilities.

The current HikeActivityControls can be refactored into compact/expanded placements; do **not** rebuild the underlying `sketch` callbacks or foot plan requests.

## 6. Proposed Explore hikes layout

### Mobile discovery
- Top: **Explore hikes** and activity badge / quick switch, clear current search area.
- Search: "Search hikes, places or parks" via existing place search when appropriate. Distinguish trail-name filter (catalog) from geographic center lookup; a place search recenters the map, it does not falsely create a trail result.
- Quick filters: **Length, Gain, Time, More filters**; sort Near me / near map / recommended from available evidence. “Dogs” and “Easy” secondary with clear sourcing.
- A meaningful **Map / List** affordance, or a single bottom sheet over map with predictable detents; reuse shared Explore shell if feasible.
- One selected result; selected card highlights exact trail portion on map. Even if the preview thumbnail is static, the main map must not need a WebGL instance per card.
- Card: picture/line thumbnail 88–96px, trail name, local section length, gain, estimated time and distance to start. Secondary line: trail operator/source, known trail classification. Unknown facts are blank or “Not available” as appropriate.
- Trail listing can render 10–20 rows in a viewport with virtualization/incremental rendering; do not fetch detailed geometry/elevation for all 50+ merely to display the first results if a catalog summary already has those facts.

### Results accuracy
- Filter before paginating whenever source facts are available. If gain/time depends on asynchronous geometry, define an explicit **provisional vs verified** count and never label page count as "all matching hikes."
- On filter change, avoid false “0 results” while calculations are still pending. Make clear which filters **exclude unknown** and which show unknown with a caution.
- “Show more” must lead to additional **matching** results, not empty pages repeatedly because the candidate page was filtered afterward.
- Distinguish large named **trail system** from a local section. Show “local 5.2mi section of a long-distance trail” only when geometry supports that actual section, not by cutting an arbitrary segment with no trailhead.
- Preserve search area, filters, selected item and scroll position across trail detail and Back (URL search params or a shared state source, not mutable module state for page navigation).

### Desktop and tablet
- Desktop: 360–420px list rail + map; selected trail detail on map or in a coherent side panel. Hike card and inspector must not overlap or produce two competing Start buttons.
- iPad: left floating/anchored compact planner rail, map dominates; avoid a giant stretched 104px-card list with no map.
- 320px phone: permit two lines for names, never truncate the only meaningful distance/duration, collapse optional metadata.

## 7. Proposed trail detail and route preparation

**Headline:** trail name, operator/location, public route category and source. Main map with trail line, parking/trailheads, and key landmarks when available. Follow with an immediately readable facts row:

```text
[ 4.2 mi mapped ]   [ 760 ft ↑ ]   [ ~2 h 15 m estimate ]
```

Call the first metric **mapped trail length**, not “hike total” unless the plan is genuinely a round trip. If hiking “There and back” doubles traversed distance, show that **only after** a route is computed or clearly selected. Show “based on terrain grade, not your pace” in details.

**Primary CTA contract:**
- **Plan this hike** when the mapped line can be opened as a draft. On action, say "Opening this trail as an editable route" rather than surfacing the internal word “breadcrumb.”
- **Choose section / trailhead** if multi-segment or if the nearest start isn't obvious.
- **Start hike** only if a real supported guidance/recording handoff exists. Do not merely rename “Open as breadcrumb” to Start without implementing lifecycle.
- **Get to trailhead** shows actual available parking/trailhead and an external map directions action; if only coordinates are available, say “Mapped trailhead (parking unverified)” and allow copy coordinates.
- **Save / Share / Export GPX** secondary when implemented and geometry complete.
- **Offline readiness** shows separately: saved track, cached basemap, installed foot graph, offline turn/follow availability. The currently disabled “Download for offline” should move to an honest unsupported capability note, or link to already supported offline map areas without implying trail download.

**Content order:** Title/hero map → Metrics and source freshness → Trailheads/parking → Elevation/difficulty → Route/road/snaps/access warnings → Weather/daylight/conditions if sourced → About/sources → Save/share/advanced.

**Dangerous assumptions to avoid:**
- OSM SAC scale is not a personalized difficulty rating; show its taxonomy and when unknown.
- Dog tags do not prove rules at a park; never state legal dog access unless current authoritative source confirms.
- “Kid-friendly” calculated from length/gain is an unvalidated heuristic, not safety certification; consider "Short & gentle (estimated)" with an explanation.
- Trailhead existence does not prove usable parking or access/permission. Operator/official data may correct or override in a provenance-aware way, not assumed.
- Remote snap distance beyond 300m is a genuine navigation problem, not a cosmetic footnote.
- Some computed hikes include roads; label road portions, source and distance, with no hiking-only badge if unsupported.

## 8. Real foot-router cases to design around

Repository's `docs/vnext/research/hike-planning-2026-10-28.md` records probes: 10/10 returned geometry after graph updates, but only 7 are all-trail routes. Specific limitations:
- **Hawk Mountain:** a local all-trail route returned; use as positive fixture.
- **Ricketts Glen:** all-trail positive fixture.
- **Jim Thorpe:** one endpoint snapped hundreds of meters away and route includes roads.
- **Lehigh Gorge:** 38.33km computed detour, not a sensible local trail outing.
- **Delaware Water Gap:** uses roads; caution needed.

Claude should build test fixtures for:
1. A valid short trail with normal close snap.
2. A remote snap that requires start/finish confirmation.
3. A long, largely-road route that should be visibly warned and perhaps not recommended as “a hike.”
4. A disconnected/multipart trail where one computed route does not exist.
5. Unavailable DEM, surface, dog tag, trailhead or foot routing.
6. A saved original catalog line that must not become a rerouted geometry accidentally.

These are **example validation scenarios**, not new requirements to change the route engine within a UX-only PR.

## 9. Implementation boundaries and staged delivery

**H0 — fix correctness/obstruction before cosmetics:** `HikeActivityControls` placement/compact state, desktop Hike inspector wording and existing `hike-planning.spec.ts` fixme. Do not interfere with `PlannerMap` pointer ownership.

**H1 — discovery coherence:** shared Explore presentation seam (list/map/filter/selected state) with a `Hike` adapter and a clearly activity-aware view model. Keep `ExploreClient` and `HikeExplore` backend providers isolated; eliminate duplicate UI structure only after parity tests.

**H2 — trail detail and preparation:** main actions, trailhead/parking, geometry source, multipart sections, status/unknown and offline honesty. Refactor monolithic `HikeExplore.tsx` into testable components/functions after coverage.

**H3 — purposeful enhancement:** route-capability-aware features like real trail loop discovery, downloaded trail corridors/foot graphs, night/daylight/weather briefing, trail following and pace learning. These require their own backend/product acceptance; never sneak them in as decorative buttons.

### Minimum tests after each H phase

- `tests/e2e/critical/hike-planning.spec.ts`, `hike-drawing.spec.ts`
- New Explore Hike tests covering origin denial, search area, filters and pagination with asynchronously missing elevation
- Trail detail tests: known/unknown/multipart line, mapped geometry preservation, source, route handoff, disabled/offline truth
- Component/contract unit tests for activity-specific labels, selected source line, route context, date/distance units
- Screenshot day/night at 320, 390, 440, iPad and desktop, real MapLibre map when possible
- Real-device PWA checks: touch long-press and Draw, keyboard/safe areas, GPS denied and airplane-mode mapping

**Definition of done:** first-time hiker can find a suitable *mapped* trail, understand its length/grade/access limitations, identify a verified or clearly unverified start, open an editable plan, and return without lost state. A physically tested active navigation session remains a separately scoped proof gate.
