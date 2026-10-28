# Findings: live observations, source risks and redesign directives

**Review date:** 2026-10-28. **Repository snapshot:** `main@8fb189f`. **Legend:** `OBSERVED` = confirmed in public desktop walkthrough; `CODE` = verified in source or a current repository handoff; `VERIFY` = likely UX issue, requires fresh screenshot/interaction test; `KNOWN` = explicit current handoff gap. Do not promote a hypothesis to a fixed bug without reproduction.

## Critical framing

OpenGravel does **not** lack features. It lacks a predictable, singular visual hierarchy across **Map → Plan → Preview → Edit/Compare → Ride → Save/Explore**, plus a genuinely separate Hike interpretation. The large desktop planning form exposes the advanced intent model (start/destination, road character, familiarity, surface, traffic, tolls, highways) at the moment when a new user needs one simple decision. A polished screen can still fail if the route is replaced, controls are inaccessible while a sheet is open, or selecting a card does not change the map.

## Ranked issue register

| ID | Severity | Evidence | User-facing problem / source | Required product outcome |
|---|---|---|---|---|
| UX-01 | **P0** | OBSERVED | Initial Map planner reveals dense start/destination and road/familiarity/surface/traffic/avoidance form; many equally emphasized decisions. | Search/plan action dominates; advanced intent is progressively disclosed and remains reachable within 1–2 purposeful actions. |
| UX-02 | **P0** | CODE + VERIFY | `PlannerWorkspaceFrame`, `PlannerWorkspaceDock`, `Sheet`, `nav.css`, `gmaps-layout.css` jointly govern map, nav, sheet detents and gestures. `gmaps-layout.css` has legacy/transitional idle overlays and later overrides. | State-driven surface ownership, predictable detents/camera insets, no overlaid buttons or simultaneous competing bottom bars. Reproduce before labeling a current collision bug. |
| UX-03 | **P0** | CODE + VERIFY | `PlannerResultPanel`, `PhoneRideSummary`, `RouteOptions`, `PlannerWorkspaceDock` carry interleaved summary, compare, edit, style and briefing. | One route preview with a clear Start; compare and editor are explicitly named states; Back never loses route. |
| UX-04 | **P0** | KNOWN | `docs/vnext/HANDOFF-2026-10-28.md`: phone Hike card covers map/long-press interaction; breadcrumb-to-trails browser check is `test.fixme`. | Compact/reposition/collapse Hike controls, restore touchable map; unskip the test after actual repro/verification. |
| UX-05 | **P0** | KNOWN | Same handoff: desktop Hike inspector presents rider copy/actions (“Best ride”, “Free Ride”, etc.). | Activity-specific inspector and action labels; no deceptive motorcycle actions in Hike mode. |
| UX-06 | **P1** | OBSERVED | Explore ride cards compress title, distance, duration, curves, surface lengths and source in a visually dense block; matching map shown beside list. | Scan-first 96px target rows; distinguish primary numbers, surface and provenance. Selected row corresponds to exact line on map. |
| UX-07 | **P1** | CODE + KNOWN | `ExploreClient.tsx` and `HikeExplore.tsx` use separate UI; recent handoff identifies duplicated Explore architecture. | Shared discovery shell/list/sorting/empty states with activity-specific adapters; never erase hike-specific trail facts. |
| UX-08 | **P1** | OBSERVED | “Ride / Things” lens is not self-describing to a new user. Filters (“Near me”, “Length”, “Paved/gravel”, “Twisty”) carry equal visual weight, and some have availability restrictions. | Explain “Things” contextually or test “Places & stops” label; one quick-filter row; advanced filters in secondary surface; show why unavailable. |
| UX-09 | **P1** | CODE + VERIFY | `TopSearch` exposes place search, smart chips, Ask, and map layer switches; map controls and Hike activity may coexist with `PlannerMap` controls. | Separate search actions from layer toggles and advisor; reduce idle visual controls; preserve discoverability of layers, Ask, Record and Free Ride. |
| UX-10 | **P1** | CODE + VERIFY | `PrimaryNav` publishes `--og-tabbar-measured-h`; page shells and planner use separate positioning logic and tablet/short-landscape rules. | Exact safe-area, focus, keyboard and map-camera coordination across 320px–desktop; no layout jumps or dead click zones. |
| UX-11 | **P1** | OBSERVED | My rides empty state is reasonably navigable, but its storage explanation and import-from-old-version affordance are unclear. | Short, plain explanation of local-first storage and optional backup/export; obvious planned vs recorded organization when data exists. |
| UX-12 | **P1** | OBSERVED + CODE | Settings contains display/activity/map/home/music/bikes/privacy/data/offline; long page makes setup capability vs advanced integration less legible. | Clear task-based grouping; name offline coverage and provider limitations accurately; preserve existing danger-zone confirmation. |
| UX-13 | **P1** | CODE + VERIFY | Night chrome may be dark while base map fails to switch on some renderers/providers; various route/map panels use complex transparency layers. | Both basemap **and** chrome genuinely dark; readable bright sunlight and reduced-transparency fallbacks. Verify on real tiles. |
| UX-14 | **P1** | CODE + VERIFY | Original catalog route → planner handoff, candidate metrics, import geometry and map selection involve multiple view models. | Source track remains geometrically intact until explicit edit; source-vs-estimate metric differences are explained, never “corrected” by guessing. |
| UX-15 | **P1** | CODE + VERIFY | Active ride has maneuver, metrics, map controls, recovery, recording, Free Ride and End safeguards. Over-enthusiastic redesign risks removing glove-scale safety affordances. | Preserve 56px riding controls, two-step End, resume/rejoin from current position, voice, recording and failed-provider behavior. |
| UX-16 | **P2** | CODE | Dense TSX, repeated style overrides, and multi-role component structures raise modification risk. | Simplify components **after** tests lock behavior; consolidate token usage and CSS overrides, do not mass-refactor domain services. |

## What was actually seen in the public walkthrough

1. **Map / initial planning (OBSERVED, desktop):** header “OpenGravel”; Map/Explore/My rides; the left rail showed start and destination placement, roads Fast/Balanced/Curvy/Backroads, familiarity New/Balanced/Familiar, surface Paved/Mostly paved/Mixed/Dirt OK, traffic and avoid-highway/toll controls. A Free Ride action and other controls were present. This is **excessive first-visit cognitive load**, not proof that any individual control is defective.
2. **Explore (OBSERVED, desktop):** search, Ride/Things, quick filters, dense route cards with distance/estimated time/curves/surface/source, and map. Cards including “Pre-Event Ride (Wayne County)” were metadata-heavy. A redesign should preserve all metadata in the expanded detail state, not delete it.
3. **My rides (OBSERVED, empty browser store):** “No saved rides yet” includes **working-looking** “Plan a ride” and “Find a ride” calls to action; GPX import is present. The walkthrough did not test populated-library behavior.
4. **Settings (OBSERVED, desktop):** appearance, activity, map, home, Spotify, bikes, consent, offline and data actions. The page is comprehensive but not concise. The visual walkthrough **did not establish missing delete confirmation or missing deletion controls**.

No phone screenshot or real route lifecycle was validated in this observation; all touch/clipping claims remain VERIFY unless the repository explicitly documents the problem.

## Corrections — do not assign Claude fake tickets

- **Do not “add” basic three-item mobile navigation.** `PrimaryNav.tsx` already provides Map, Explore, My rides, with Settings via `AppMenu` on phone/tablet.
- **Do not “implement” hiding the phone tab bar in trip state.** `gmaps-layout.css` already hides it under `[data-trip="true"]`. Verify tablet/short-landscape gaps instead.
- **Do not add a new bottom-sheet framework.** `Sheet.tsx` handles drag, arrow keys, detents, Escape and focus. Improve the current geometry/state contract.
- **Do not add a second route preview/compare store.** `PlannerResultPanel`, `PhoneRideSummary` and `PlannerWorkspaceDock` already carry it; reconcile state and remove duplicate rendering.
- **Do not add basic ride deletion confirmation.** `RidesLibrary.tsx` already implements confirmation plus undo; `SettingsSurface.tsx` already requires typing `DELETE` before wiping all local data.
- **Do not suggest a Clear Data button is missing.** Settings already includes Export all data and Delete all data.
- **Do not change ending a ride to one tap.** The two-step safeguard is intentional.
- **Do not treat Mapbox-only thumbnails as a production outage.** `ExplorePanel` has a route-line fallback; current handoff notes quota/style limitations. Verify each provider separately.
- **Do not assume “Record” is broken** merely because the initial walkthrough found it visually secondary or disabled in one state. Investigate its documented preconditions and whether Free Ride recording is distinct.

## What Claude must investigate experimentally before touching CSS

- In 440×956 mobile Safari/PWA, does the idle top search overlap a bottom sheet, map attribution or Hike card?
- When the keyboard opens, do search results and controls remain tappable and is the sheet lowered correctly?
- After a point is selected, do the search header, From/To card, sheet, tab bar and map-control stack each own unique screen regions?
- Does an Explore route selection synchronize selected row and map line, and does Back preserve filters/scroll?
- Does selecting/dragging a route draw/avoid tool accidentally drag the sheet? Does long-press placement trigger browser menus on touch?
- Does switching Ride↔Hike leak labels, wrong route candidates, invalid controls or stale state?
- Are map controls usable with VoiceOver, hardware keyboard, large text and reduced transparency?
- Does route option selection change the same canonical candidate used for Start and export, including across reload/offline?
- Does closing a route preserve a draft and offer a resumable action without silently replacing geometry?
- Are source/time/distance metrics consistent with actual candidate and provenance; if not, where do units/models diverge?

## Visual quality criteria

“Gorgeous” is not more glass, more shadows, more chips or an elaborate background. It is:

- The map remains visibly **useful** under every state.
- At most one obvious primary CTA per view.
- Typography answers “where, how long, how far” before technical metadata.
- Distance/time numerals line up (tabular numbers), and unknown values aren't painted as confident facts.
- Route selection is obvious even without color perception.
- Margins, radii, shadows and blur all come from `src/app/tokens.css`.
- A contextual panel never forces a rider into a maze to get back.
- Every screen has polished loading, empty, error, offline and permission-denied states.

**Definition of bad implementation:** a screenshot looks better, but touch gestures, route identity, off-route recovery, disabled options or map layer providers are broken.
