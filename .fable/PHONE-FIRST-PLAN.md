# Phone-first plan (Fable audit, 2026-11-12)

Owner: "the phone is the primary experience… the map is so damn small and I can't really see the
different routes because everything is a white line."

Audited: production (main c1e860ff) and `ui/map-first` (#221, incl. the uncommitted
`max(40dvh, 252px)` half-sheet change) at 320x568, 390x844 and 440x956, Day and Night, map and
satellite. Shots: `.fable/shots/phonefirst/` (`prod-*`, `br-*`, `v2-*` = after the 252px change,
`linefix-*` = proof for PF-1). Scripts: `.fable/phonefirst-shot.mjs` (prints layout numbers per
shot), `-probe.mjs` (layer order), `-linefix.mjs`, `-ride.mjs` (moving GPS), `-homecheck.mjs`.

All selectors below are inside `@media (max-width: 1180px) and (min-height: 501px)` unless noted.
Desktop must not change. Every package ends with: unit tests green, the named screenshot check,
and visual baselines re-recorded with `[update-baselines]`.

## What the shots say (measured, branch, 390x844 unless noted)

| Fact | Number | Best in class |
|---|---|---|
| Clear map with a ride shown, sheet at half | 46% (trip card ends y118, sheet starts y506); the stats pill eats another 52px, so really 40% | Google/Apple Maps route preview: 55 to 60% |
| Same at 320x568 | 35% | n/a |
| "Peek" of the ride sheet | 473px tall, which is TALLER than half (338px) | Google: about 90px |
| Top chrome with a ride shown | 106px card + 44px pill = 158px, and both repeat what the sheet says | one 52px line |
| Ride line on the Day map | basemap roads are painted on top of it: a pale stripe runs down the middle (probe: 60+ basemap `road-*`/`bridge-*` layers sit above `ogv-route-selected`, index 51 of 206) | line is always the top line |
| Ride line on the handlebar screen | reads as a white road with a thin plum edge (`br-440-day-ride-a/b.png`) | REVER/Calimoto: fat solid line |
| Night map | every road is light grey (#7a857f to #b9c2bd) on near-black: a wire mesh; the city is a white grid (`br-440-night-map-3-place.png`) | dark roads, one bright line |
| Destination pin | sits under the Gravel/Twisty legend chip at the sheet edge (`v2-390-day-map-4-route.png`) | both ends inside the clear map |
| Names | map tag says "Best Ride" / "Alternative"; sheet says "Twistiest" / "Option 2" for the same lines | one name each |
| Compare rows | grey bar for every choice; the lines are teal/amber/sky | row colour = line colour |
| Tap targets under 44px | search chips 40, Compare rides 40, legend 32, weather pill 36, place close 36 wide | 44 minimum |

## Ranked packages

Ship order: **PF-1 first** (inside #221, with the fix list at the bottom), then PF-2, PF-3, PF-4,
PF-5, PF-6, PF-7, PF-8.

---

### PF-1  The ride line is the top line (SHIP FIRST)

**Rider:** "My ride is one fat solid colour I can follow, in town, off road, day or night, and when riding."

**Why first:** this is the real cause of "everything is a white line". #221 removed the sage band,
but the stripe is still there because the basemap draws its own roads over our line. One small
change, proven: `linefix-day-map-before.png` vs `-after.png`.

**Files:** `src/infrastructure/map/maplibre/host.ts` (`firstBasemapLabelId`, `addOverlayLayers`),
new pure helper in `src/infrastructure/map/maplibre/ride-focus-dim.ts` (or a new
`route-anchor.ts`), `tests/unit/map/map-host.test.ts`, new `tests/unit/map/route-anchor.test.ts`.

**Spec:**
- New pure `routeLineAnchorId(layers)`: find the index of the LAST basemap layer (id not starting
  `ogv-`/`og-`) that is `type: "line"` and is a road (`isBasemapRoadLayer(layer)` OR id matches
  `/^(road|bridge|tunnel)-/`). Return the id of the first basemap `symbol` layer after that index
  whose id does not match `/oneway|arrow|crosswalk|level-crossing|gate/`. No road layers found:
  fall back to today's `firstBasemapLabelId`. Nothing after: `undefined` (append).
- `addOverlayLayers` uses it for every id in `ROUTE_LINE_LAYER_IDS`. If a route line layer already
  exists but sits below the anchor (style kept, layers kept), `map.moveLayer(id, anchor)` in the
  existing order so casing stays under core.
- Road names, shields and place labels stay above the line (they are after the anchor).
- Satellite, hillshade, traffic, radar and 3D buildings keep using `belowOverlay`; confirm they
  still land under the ride line.
- Widths while planning (zoom 8 to 12), unchanged core 6px / casing 11px. No colour change.

**Pass/fail:**
1. Unit: for a Mapbox Outdoors-shaped layer list and an OpenMapTiles-shaped one, the anchor is
   after the last `bridge-*` line layer and before the first road label layer.
2. Browser (`node .fable/phonefirst-probe.mjs BASE day map`): `basemapLayersAboveSelected`
   contains no layer of type `line` or `fill`.
3. Screenshot: sample a 3px square at the middle of the selected line (probe already finds the
   point) on Day map, Night map and Satellite: every pixel is within 12 RGB of the line colour
   (Day #7b4fa0). Today the centre pixel on Day is near-white.
4. Handlebar screen (`phonefirst-ride.mjs`): same pixel test 60px ahead of the puck.

---

### PF-2  A sheet that gives the map back

**Rider:** "I see the whole ride on the map, the answer and Start under my thumb, and one flick
hides the rest."

**Files:** `src/ui/sheet/sheet.css` (lines 466 to 505), `src/ui/planner/plan-sheet.css` (the #221
block), `src/ui/planner/gmaps-layout.css` (line 373), `src/ui/planner/RideSummary.tsx`,
`src/ui/planner/PlannerWorkspaceDock.tsx` (detent mapping, lines 258 to 306),
`src/ui/planner/usePhonePlanner.ts`, `tests/e2e/critical/compact-sheet.spec.ts`,
`tests/e2e/critical/mobile-planner-ux.spec.ts`.

**Spec (ride on the map: directions, loop, saved ride):**

| Detent | Height | Shows |
|---|---|---|
| peek | 96px + safe-bottom, fixed | handle; one row: time 22px/700 in `--og-primary-text` ("39 min"), then "22 mi · all paved" 14px in `--og-ink-2`, then a Start button right-aligned, 48px tall, min-width 112px. Nothing else. |
| half | `min(var(--og-sheet-half), max(40dvh, 252px))` (keep #221's number) | title, time row, surface line + bar, Start / Save / Share, "Compare rides (n)". Nothing clipped. |
| full | unchanged | everything, scrolls |

- Half must not cut a row in half. Today the body is `overflow: hidden` and the weather alert,
  Options and Edit route rows are sliced by the bottom edge. At half hide
  `.og-route-options` rows "Options" and "Edit route", the weather alert line, and calm truth
  lines (already hidden by #221); they appear at full. Set the body to `overflow-y: auto` with
  `overscroll-behavior: contain` as a safety net.
- Compare view at half: hide `.og-phone-style` (Roads / Surface chips; they stay in full and in
  Options). The list shows up to 3 rows at 56px each and scrolls beyond; the Start / Save / Share
  row is pinned at the bottom of the sheet (`position: sticky; bottom: 0; background:
  var(--og-surface)`). Compare may grow to `max(40dvh, 300px)`.
- Peek is a real peek: remove the rule that gives peek `max(var(--og-sheet-half), 56dvh)` for
  `[data-directions="true"][data-sheet-view="choices"]`.
- Auto-peek: when the rider drags or pinches the map while the sheet is at half and a ride is
  shown, the sheet drops to peek (Google Maps does this). Tapping the peek row or handle returns
  to half. Never auto-peek from full, never while a text field has focus.
- Handle: keep the 64x5 bar, but the hit area is the full sheet width x 32px (today 24px tall).
- Motion: height change 220ms `var(--og-ease)`; `prefers-reduced-motion` = no transition.
- Tap targets: "Compare rides" back to 44px min-height.

**Pass/fail (Playwright, 320x568, 390x844, 440x956):**
1. peek: sheet height <= 96 + safe-bottom + 8; `start-ride` fully visible and >= 48px tall.
2. half: sheet top >= 58% of viewport height at 390 and 440; every visible direct child of the
   sheet body has its bottom edge <= the sheet's bottom edge (no sliced rows).
3. compare at half, 2 and 3 choices: every choice row and `start-ride` are fully inside the sheet
   at all three sizes (today at 320x568 one row shows and Start is gone; at 390 Start is a sliver).
4. peek height < half height < full height (today peek 473 > half 338).
5. Drag the map 80px at half: `data-detent` becomes `peek` within 400ms.

---

### PF-3  One line of top chrome while a ride is shown

**Rider:** "The top of my screen is map, not a form I already filled in."

**Files:** `src/ui/planner/TripCard.tsx`, `src/ui/planner/RouteContext.tsx`,
`src/ui/planner/route-context.css`, `src/ui/planner/itinerary.css` (`.og-trip*`),
`src/ui/planner/RideSummary.tsx`, `src/ui/planner/hooks/usePlannerCamera.ts`.

**Spec:**
- Once a ride is drawn, the trip card collapses to one pill: 52px tall, 12px from the top safe
  area and side edges, radius pill, glass. Content: green dot, "Your location", a 14px arrow,
  red dot, destination (ellipsis), then swap and close as 44x44 buttons. Loop: "Loop from
  {place}". Font 15px/600.
- Tapping the text opens the edit view exactly as today. While planning (no ride yet) and while
  the edit view is open, the card keeps today's two-line form.
- The stats pill (`route-context-row`: "22 mi · 39 min · arrive 4:27 PM · before dark") is removed
  from the map on phones. Its one new fact, daylight, becomes a small chip at the end of the
  sheet's stat line ("before dark" / "45 min after dark"; warn tone when after dark); tapping the
  chip opens the same Conditions sheet. The Ask control that shares that row moves into the
  sheet's Options (sliders) view.
- Map buttons column (Layers, 3D, Locate) starts 12px under the pill: top = safe-top + 76px.

**Pass/fail:**
1. With a ride shown at half, 390x844: bottom edge of `trip-card` <= 64 + safe-top;
   `route-context-row` not visible; clear map band (trip-card bottom to sheet top) >= 52% of the
   viewport (script prints `clearMapPct`; today 46, really 40 with the pill). At peek >= 75%.
2. Distance, time, arrival and daylight are all still readable in the sheet at half.
3. `trip-swap` and `trip-close` are >= 44x44.

---

### PF-4  The whole ride fits in the map you can see

**Rider:** "Start and finish are both in view; nothing sits on top of where I'm going."

**Files:** `src/ui/planner/hooks/usePlannerCamera.ts` (`TOP_CHROME`, `chromeBands`),
`src/application/map/insets.ts`, `src/ui/layers/LayeredMap.tsx` (line 117),
`src/ui/layers/layers.css`, `tests/unit/map/insets.test.ts`.

**Spec:**
- Legend chip is hidden whenever the scene has a selected ride (the discovery layers are already
  dimmed to 35% then, so the legend explains nothing): add
  `&& !map.scene.routes.some((r) => r.state === "selected")` to `legendVisible`.
- Fit padding: 28px breathing room on every side beyond the measured chrome, plus 20px extra at
  the bottom so the destination pin (40px tall, anchored at its foot) is never under the sheet's
  top edge. Add `route-context-row` to `TOP_CHROME` for as long as it exists (until PF-3).
- Re-fit when the sheet changes detent and the camera is not rider-owned (300ms after the
  transition ends, `fitBounds` duration 350ms).
- Comparing: the fit covers the selected ride AND every alternative.

**Pass/fail:**
1. After planning Langhorne to Reading Terminal Market at 320x568, 390x844 and 440x956: the
   projected screen points of the ride's first and last coordinates are both inside the clear band
   and >= 24px from the trip card, the sheet, the left edge and the button column.
2. `map-legend` is not in the DOM while a ride is shown, and is back after Close route.
3. In Compare, every alternative's bounding box is inside the clear band.

---

### PF-5  Night and satellite: dark roads, one bright line

**Rider:** "At night my map is calm and my ride glows; in town I don't get a white grid."

**Files:** `src/infrastructure/map/night-contrast-style.ts` (`NIGHT_CONTRAST`, `roadColour`,
`restyleLine`), `src/infrastructure/map/maplibre/ride-focus-dim.ts`,
`src/infrastructure/map/maplibre/host.ts` (`syncRideFocusDim`, `applySatelliteRoads`),
`tests/unit/map/night-contrast-style.test.ts`, `tests/unit/map/ride-focus-dim.test.ts`.
Overrides DESIGN.md where it says night roads "get brighter with importance": the order stays,
the whole scale drops.

**Spec:**
- Night road colours: minor/street/service `#7a857f` -> `#3d4843`; secondary/tertiary/primary
  `#b9c2bd` -> `#69746f`; motorway/trunk `#8e9994` -> `#98a29d`; unpaved stays `#d6a862` (gravel is
  the product) but at opacity 0.8; path `#6d7a73` -> `#4a5650`.
- Night minor roads fade in with zoom: `line-opacity` 0 at z10, 0.6 at z12, 1 at z14. City grid at
  z13 and below is quiet.
- Road labels night: `#aab4ae` -> `#8b9690`. Place labels unchanged.
- While a ride is shown (same trigger as `rideFocusChanges`): every basemap road layer
  (`isBasemapRoadLayer`) is scaled to 0.6 of its opacity on Day and Night, and to 0.25 on
  Satellite (0.4 when no ride, as #221 has it). Restores on Close route and after a style reload.
- Night ride line: core `#c9a2f0`, casing `#1a0f24` at 0.9, same widths. Alternatives keep
  teal/amber/sky with `#0a0f0d` casing.

**Pass/fail:**
1. Unit: `toNightContrast` output colours for `road-street`, `road-primary`,
   `road-motorway-trunk` equal the values above; minor-road opacity is a zoom interpolate.
2. Screenshot, Night map, Philadelphia place card (`*-night-map-3-place`): mean luminance of the
   map area drops from today's value by >= 35% (print it in the script; record before/after).
3. Screenshot, Night and Satellite with a ride: WCAG contrast between the ride line's centre pixel
   and the brightest road pixel within 60px of it is >= 3:1.
4. Ride focus dim unit test covers road layers and the restore.

---

### PF-6  A calmer home map with thumb-sized controls

**Rider:** "I open the app and see where I am and the good roads near me, not confetti."

**Files:** `src/infrastructure/map/maplibre/info-layers.ts`, `src/application/map-layers/catalog.ts`,
`src/ui/layers/MapLegendChip.tsx`, `src/ui/layers/layers.css`, `src/ui/planner/gmaps-layout.css`
(search chips), `src/ui/place/ConditionsPill.tsx` + its CSS.

**Spec:**
- Twisty roads (`great-roads`) below zoom 11: draw only segments with `weight >= 1000`, width
  2px, opacity 0.75; from zoom 11 all segments as today. Orange/red point dots
  (`ogv-info-point`): hidden below zoom 11, radius 3px at z11, 5px at z14.
- Legend chip: shows on the first 3 app opens only (count in `localStorage`
  `og-legend-seen`), fades out (200ms) 8s after the map is ready or on the first map gesture;
  36px tall with a 44px hit area (`::after` inset -4px).
- Search category chips: 44px tall (today 40), 8px gap, 16px side padding. Weather pill in the
  search bar: 44px hit area.
- Place card close button: 44x44.
- Home sheet stays 93px. Target clear map on home >= 68% at 390x844 (today 67%), no regression.

**Pass/fail:**
1. `phonefirst-shot.mjs ... home` prints an empty `under44` list apart from "Toggle attribution".
2. Home at zoom 10 over Langhorne (production data): count of rendered `ogv-info-point` features
   = 0; rendered `great-roads` features <= 40% of today's count.
3. Legend not visible 10s after load; not present on the 4th load.

---

### PF-7  Handlebar screen: glove-sized and unmistakable

**Rider:** "At a glance, at speed, I know where the road goes and which way I turn."

**Files:** `src/infrastructure/map/maplibre/style.ts` (`routeCasing`, `routeSelected`,
`riderHeading`), `src/infrastructure/map/maplibre/puck-image.ts`, `src/ui/ride/ride.css`,
`src/ui/ride/RideFocus.tsx`, `src/application/map/build-ride-scene.ts`.

**Spec (needs PF-1 first; the stripe is worst here):**
- Ride line in ride mode: core 10px at z15, 14px at z16, 18px at z17; casing = core + 6px.
  Day `#7b4fa0` on casing `#3a2250`; Night `#c9a2f0` on `#1a0f24`. The part already ridden: `#68716f`
  at 0.55, same width.
- Puck: 44px on screen (today about 31: 72px image / 3 x 1.3), white 3px ring, fill
  `--og-map-blue`, soft shadow. Sits at 70% of the map height so 2/3 of the screen is road ahead.
- Right rail buttons: 56x56 (today 48), 12px gaps, bottom one 16px above the strip.
- Bottom strip: numbers 28px/700 tabular, labels 12px; strip height 76px + safe-bottom.
- Turn banner stays as is (it is good). The warning triangle inside it gets a 44x44 hit area and
  must not overlap the road name (today it touches "Hulmeville Road" at 440 wide): reserve 52px
  on the right of the text block.
- "No GPS fix yet" state: show the ride overview (already does) with the banner in neutral
  surface colour; fine as is.

**Pass/fail:**
1. `phonefirst-ride.mjs`: pixel 60px ahead of the puck is the line colour (PF-1 test) and the
   line's rendered width at that point is >= 14px at 1x.
2. Puck bounding box 44 +/- 2px; puck centre between 66% and 74% of map height.
3. `ride-rail` buttons each >= 56x56; maneuver text box and warning button do not intersect.

---

### PF-8  Compare speaks one language

**Rider:** "The teal line is the teal row, with the same name, and I can tap either."

**Files:** `src/ui/planner/RouteDecisionCard.tsx`, `src/ui/planner/route-results.css`
(`--og-route-tint`), `src/application/map/build-map-scene.ts` (label text, `tint`),
`src/infrastructure/map/maplibre/place-images.ts` (`ALTERNATIVE_COLORS`),
`src/infrastructure/map/maplibre/host.ts` (route tap).

**Spec:**
- Each Compare row's left bar (4px wide, full row height, radius 2px) uses its line's colour:
  selected `--og-route` plum, others `ALTERNATIVE_COLORS[(tint % 3 === 1) ? 0 : (tint % 3 === 2) ? 1 : 2]`,
  the same mapping style.ts uses. Export the mapping as one function and use it in both places.
- Map tags use the sheet's names: "Twistiest · 39 min", and for others the difference:
  "Option 2 · +10 min". No "Best Ride" / "Alternative" wording on the map.
- Tapping a line or its tag on the map selects that ride (same action as tapping its row), with
  a 20px tolerance around the line.
- Entering Compare re-fits to all choices (PF-4) and lifts alternatives from the dimmed state to
  full strength; leaving Compare returns them to casing 0.55 / core 0.95 as #221 has them.

**Pass/fail:**
1. For 2 and 3 choices: computed `background-color` of each row's bar equals the `line-color`
   the map paints for that route id.
2. Text of every map tag starts with the same name as its row.
3. Tapping an alternative's line midpoint changes `aria-current`/checked row within 500ms.

---

## Not in this round (noted, lower value)
- Layers sheet covers 85% of the screen, so you cannot see the map change when you pick Satellite.
  Later: open at a 50% detent with Map type first.
- Explore is a list page with a small map card; fine for browsing. Later: a map-first toggle.

## Changes to #221 before it ships

Blocking:
1. **Peek is taller than half.** After full -> handle tap, the ride sheet lands on "peek" at
   473px (56dvh) while half is 338px (`v2-390-day-map-6-after-handle.png`). The 40dvh cap is only
   on `[data-detent="half"]`; `sheet.css:501` still gives peek `max(half, 56dvh)`. Apply the same
   cap to peek now (real peek comes in PF-2).
2. **Compare is broken by the cap.** The sheet body is `overflow: hidden`, and the pinned Roads /
   Surface chips take about 130px. At 390x844 Start is a 10px sliver; at 320x568 only one ride
   row shows and there is no Start (`v2-320-day-map-5-compare.png`,
   `v2-390-day-map-5-compare.png`). Smallest fix: at half hide `.og-phone-style` while
   `data-comparing="true"`, and let Compare use `max(40dvh, 300px)`.
3. **Half slices rows.** Weather alert, Options and Edit route are cut mid-text by the sheet's
   bottom edge at all sizes. Hide those three at half (they are in full), or make the body scroll.
4. **The stripe is still there.** The PR says "solid plum ride line", but on the Day map the
   basemap's roads still paint over it (`linefix-day-map-before.png`). Fold PF-1 into #221; it is
   one helper and a `moveLayer`.

Should fix:
5. "Compare rides" was dropped to 40px tall; put it back to 44px (the 320 fit should come from
   items 2 and 3, not from a smaller button).
6. Compare rows still show a grey bar for every choice; the code comment says the row matches the
   line. Colour the bar (PF-8, first bullet) or change the comment.
7. Hide the Gravel/Twisty legend chip while a ride is shown; today it sits on the destination pin
   (`v2-390-day-map-4-route.png`). One line in `LayeredMap.tsx`.
8. Add a browser test for the cap at 320x568, 390x844 and 440x956 (PF-2 checks 2 to 4), so the
   next sheet change cannot re-break Compare.

Check before merge:
9. On the branch dev server the home map opens at zoom 7 over all of New Jersey and does not move
   to the rider; production opens at zoom 10.3 on the rider (`phonefirst-homecheck.mjs`: branch
   `z 7.01` at 8s and 25s, prod `z 10.34`). Nothing in the diff touches the camera, so this is
   probably the dev build, but confirm on a production build of the branch.
10. `AGENTS.md` has an uncommitted edit in this worktree; keep it out of the PR unless intended.
