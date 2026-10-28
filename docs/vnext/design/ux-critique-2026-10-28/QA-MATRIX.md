# Acceptance matrix and adversarial journeys

> Gate for subsequent implementation PRs. This document itself introduces no passing tests and no verified screenshot assets. **Do not tick a case without execution evidence.** Record browser/device, route fixture/provider, commit SHA and screenshot/test link.

## Baseline matrix

| Surface/state | 320×640 | 390×844 | 440×956 | iPad 1194×834 | 1440×900 | Day/Night | Keyboard/VoiceOver |
|---|---|---|---|---|---|---|---|
| Map: idle/search/results | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Selected place/long press | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Route preview/compare | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Route edit/options/tool | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Explore Ride list/map/detail | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Explore Hike list/map/detail | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Hike breadcrumb/Plan on trails | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| My rides empty/populated | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Settings/offline/data | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Ride Focus/free ride/record | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Failed map/provider/permission | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

A mobile web emulation passing is **not** a verified iPhone physical-device pass. Screenshot baselines must state whether map tiles were real, route geometry fixture-based, GPS simulated and network throttled.

## Journey tests (human-readable acceptance scripts)

### J01 — First-run motorcycle route, minimum friction (P0)

**Given** no saved rides and no active plan; phone at 440×956.
1. Open Map. The map, search, discoverable Plan loop/Free Ride/Record, 3 tabs and a named menu are usable.
2. Search for a real town/destination and select it.
3. With a known start or explicit start selection, route appears or an actionable provider error appears.
4. Preview shows destination, duration, distance and one primary Start. “Options” is available without requiring a configuration wall.
5. Compare (only if multiple actual candidates) switches map line and same selected candidate.
6. Back returns to preview; Back from preview restores prior context and retains resumable draft; no silent data loss.

**Fail:** starting requires advanced-setting selection; bar plus preview compete for lower screen; selected route/line mismatch; wrong start after reload.

### J02 — Search keyboard/sheet collision (P0)

1. Focus search on 320×640, open virtual keyboard, type ambiguous search.
2. List remains scrollable above keyboard, first result visible; map map-gesture hints do not block taps.
3. Tap a result, dismiss keyboard and expand/collapse place sheet.
4. Rotate to landscape and back. Map controls, sheet handle, safe areas and attribution remain operable.
5. Keyboard Escape or Back returns focus to the invoking search control.

**Fail:** hidden result, dead/tap-through overlay, pointer events blocked outside visible sheet, focus lost to document body.

### J03 — Advanced route modification and last-good recovery (P0)

1. Make route, open Options, change curviness or surface, observe loading without losing old route.
2. Add a stop, avoid an area and/or draw a segment via existing editor.
3. Force routing timeout or no-candidate error.
4. Last-good route remains visible, editable and explicitly identified; Retry/Discard/Edit work.
5. Undo restores prior authored intent and geometry; exit/return doesn't silently reset.

**Fail:** app swaps to a new geometry without consent; route Start points to stale candidate; misleading “saved/updated” on failure.

### J04 — Explore Ride map/list linkage (P1)

1. Open Explore, search/filter for a route, scroll to a result, note filter and scroll state.
2. Select a card: exact preview line highlights and camera fits in visible map area.
3. Choose a different result or, where supported, select its map line; selected card updates.
4. Open detail and return; filters, scroll and selection remain coherent.
5. Ride this → planner keeps **original catalog geometry** and source name until explicit edit.

**Fail:** generic/approximate line replaces original; source omitted; list resets to top; filters silently clear.

### J05 — Hike mode consistency / known blockages (P0)

1. Switch to Hike. Search/trail list maps use trail-specific facts (distance, elevation, difficulty/grade where supported) and no motorcycle fuel/twistiness controls.
2. On 390×844/440×956, open Hike planning card, long-press a point visible under the current card boundary; map responds correctly without card stealing touches.
3. Add breadcrumb points and invoke Plan on trails (dedicated hike router). Verify `hike-planning.spec.ts` previously marked fixme is re-enabled **only if actually passing**.
4. Desktop 1440×900: inspector must not show “Best ride”, “Free Ride”, motorcycle advisor text or other misleading rider actions in Hike.
5. Routing unavailable → honest Hike-specific failure, never motorcycle fallback.

**Fail:** activity merely changes button label while underlying provider, controls or explanation remain motorcycle-specific.

### J06 — Ride Focus / Free Ride regression (P0)

1. Start valid ride; verify maneuver and active-session map occupy intended space.
2. Recording status, 56px controls, zoom/compass, pause, voice and off-route recovery remain reachable.
3. Simulate lost GPS and lost network; no fake current-location claim or silent ride termination.
4. Resume/rejoin halfway through route: next route targets current progress/rejoin, not forced original start.
5. Tap End: requires confirmation before stopping session and recording; return has persisted outcomes.
6. Night mode: dark **actual map tiles** and legible speed/ETA, not a dark scrim hiding a light map.

**Fail:** single-tap destructive end, buried recover control, absent recording indicator, false live location or forced route-start regression.

### J07 — Local-first and offline truth (P1)

1. Save route, reload page and open My rides. A local saved route is actually present and previewable.
2. Export GPX and compare geometry/endpoints with source. Restore/import on fresh store and compare again.
3. Distinguish installed basemap region, downloaded offline route graph, unconfigured online provider and route artifact; each indicates what it can actually do.
4. In airplane-like network failure, planner shows offline capabilities and graceful failure, never “everything is ready” based only on a saved tile set.
5. Delete a saved ride: existing confirmation and undo behave; Delete all data requires typed DELETE.

**Fail:** data erased on UI navigation or unexplained storage loss, falsely offline-ready, safety-critical provider failure masked as success.

### J08 — Accessibility and contrast (P1)

1. Run with 200% text / system large text, reduced motion/transparency and 320px width.
2. Navigate Map search, tab bar, sheet handle, Compare candidates, Options, source detail, Hike card and End confirmation using keyboard only.
3. Screen reader announces tab/current, selected candidate (not just plum color), available and disabled actions, sheet expanded state and actionable errors.
4. Contrast: body text ≥4.5:1, ride data contrast targets per `DESIGN.md` (≥7:1) in Day/Night.
5. Sheet dragging has keyboard/button alternatives and focus returns after closing.

**Fail:** clipped label, accidental nested scroll trap, misleading live announcements, pointer-only essential action.

### J09 — Tablet/desktop continuity (P1)

1. At 1194×834 iPad landscape, confirm no stretched phone bar/giant bottom sheet; one navigation and one primary planner surface.
2. At 1440×900 desktop, use left rail and map (optional inspector after route) without duplicating Start or search.
3. Resize across 761/1181 breakpoints and short landscape while preview/editor is open.
4. Check map fit after resize, all controls insets and no scroll-driven route reset.

**Fail:** tab bar overlaps dock; inspector steals all map width; duplicate route choices/controls; resize clears selected route.

## Layout snapshot criteria

An accepted screenshot must show:

- no clipped actionable control or overlapping hit target,
- map attribution and insets visible,
- chosen route line visible and unobscured by preview,
- correct theme and legible selected route,
- exactly one obvious primary action,
- no unlabeled dead icon,
- no apparent double-sheet,
- appropriate content when data/permission/provider unavailable.

Record screenshot *before* and *after* at identical state and viewport; do not pass on a single pretty mockup. Large text and active keyboard are separate mandatory screenshot states, not just inferred from CSS.

## Suggested automation hooks

Prefer existing hooks over adding test-only UI: `data-testid="primary-nav"`, `planner-sheet`, `sheet-scroll`, `top-search`, `phone-ride-summary`, `start-ride`, `compare-rides`, `app-menu`, `map-locate-me`, `show-whole-ride` and `planner-inspector`, as applicable. Recheck the branch for changes in selectors.

Extend, don't discard:
- `tests/e2e/critical/compact-sheet.spec.ts`
- `tests/e2e/critical/mobile-planner-ux.spec.ts`
- `tests/e2e/critical/first-route.spec.ts`
- `tests/e2e/critical/ride-style.spec.ts`
- `tests/e2e/critical/map-gestures.spec.ts`
- `tests/e2e/critical/explore.spec.ts`
- `tests/e2e/critical/explore-browser.spec.ts`
- `tests/e2e/critical/hike-planning.spec.ts`
- `tests/e2e/critical/hike-drawing.spec.ts`
- `tests/e2e/critical/ride-focus.spec.ts`
- `tests/e2e/critical/free-ride.spec.ts`
- `tests/e2e/critical/record.spec.ts`
- `tests/e2e/critical/settings.spec.ts`
- `tests/e2e/critical/offline-routing.spec.ts`

When adding critical visual regression: test DOM visibility/placement and actual screenshots; don't assert exact static pixels for dynamic safe areas where semantic geometry is more stable.

## Release readiness scorecard

Score each screen from 0–5 independently in:

1. Primary task clarity
2. Information hierarchy
3. Map usability/space
4. Cross-state continuity
5. Touch/keyboard/screen-reader access
6. Error/offline/data-truth behavior
7. Visual coherence across themes and devices

**Release bar:** no P0 remaining; every critical journey passes; no screen under 4/5 in the first four categories; no false-data or safety regression; screenshots + tests + open limitations attached to implementation PR.

This is a **review rubric**, not a fabricated baseline score. Claude must score real before/after evidence and state which dimensions remain weak.
