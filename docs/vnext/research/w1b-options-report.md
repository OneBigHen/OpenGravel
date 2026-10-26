Wave 1B: rider options, readable pins and one sheet

Directions frames the supplied route and both endpoints between the search/chips and the sheet. Places stay above their cards. Changing the sheet height refits that visible map. Search and category results use 32px category images; selection grows the pin and adds its name without relying on a map font service, in Day and Night.

Phone and iPad Directions show up to three evidence-based choices with time, distance and a short reason. Missing or tied character evidence earns no comparative label. The selected recommendation stays selected. The header names both endpoints, preserves My location through a swap, and reverses through ride.reverse. Edit opens the existing composer; Options opens ride style and refinement at full height and changes replan. Start ride appears once.

Place cards, results and Directions share Sheet, with peek / half / full, a 48px handle, swipe, keyboard arrows, Escape, focus handling and reduced motion. Half leaves at least half the screen above the sheet. At 320x568 the choices and Options row scroll together so a complete first choice and Start ride remain visible. Full keeps a 160px map strip and folds away the top search. Explore and Ride sheet migration remains outside this wave.

Decisions made without another owner round:

- Keep existing routing authority and measured evidence. Retain neutral option names when character is unknown, tied or zero; claim Paved only only with complete paved evidence.
- Give one row one name, prioritizing Fastest, then Twistiest, then Most gravel when a candidate wins several comparisons. Keep the selected recommendation among the maximum three rows.
- Put the short-phone list and Options row in one scroll area, keeping the trip header and Start reachable. Keep a full 48px handle rather than clipping its hit area.
- Remove duplicate legacy compact Places chrome, which otherwise reserved invisible-map space at full height on iPad. Keep the desktop and short-landscape rails, matching the existing responsive composition.
- Browser screenshots use a labeled synthetic route fixture rotated/scaled to the authored search endpoints. The original canned route is in a different town and would appear as a speck when framed with these endpoints. This proves layout, not real routing quality.
- Debug method comparisons continue to use the existing composer through explicit endpoint authoring. The short-landscape comparison is authored in portrait and then rotated for inspection.
- Update the old dead-band test to the map contract: a tap authors nothing; hold and Start here authors a point. No gesture-engine change.

Verification:

- TypeScript, changed-file ESLint and production build passed.
- Focused Vitest: 485 passed across 30 files (312 unit/integration and 173 architecture checks), including type-scale. Architecture plus Sheet/options tests passed again after the final visual cleanup (179 checks).
- Focused critical Chromium: 46 passed across seven specs (40 critical journeys and six screenshot cases). This includes compact-sheet, first-route, mobile-planner-ux, search-card, avoid-area and routing-method-comparison. After the final place-card visual cleanup, all 20 affected compact-sheet/search-card/screenshot cases passed again.

The wider suite is not green. Its 117 critical tests plus six screenshot cases finished with 105 passed and 18 failed before the final fixes. Five failures were in the dead-band and developer-comparison paths; their tests and compact layout were corrected here and included in the final focused gate. The known 1280x800 desktop case failed. Eleven other failures also reproduce at the pre-Wave-1B commit 1c22b4a: two short-landscape rail cases, two Explore expanded-map focus cases, the Explore/library source-filter journey, a Recorded badge assertion, four Spotify cases, and point dragging in stops.spec.ts. Those surfaces were left outside this wave. The offline-basemap screenshot hit a detached-element race in the broad run; its isolated rerun passed, as did its baseline run. The known first-route vendored-renderer and stops-reorder cases passed in this run.

Screenshots are uncommitted in w1b-shots/: 320x568, 375x812 and 390x844, Day and Night, each with home-idle, chip-results, place-card, route-options and options-full (30 PNGs). The route-options captures show the route in the exposed map. This remains Chromium/empty-basemap fixture evidence; live geocoding/routing, WebKit and physical glove/iPhone acceptance were not verified.

Files changed across Wave 1B:

- `docs/superpowers/plans/2026-10-26-w1b-options.md`
- `docs/vnext/research/w1b-options-report.md`
- `src/app/layout.tsx`
- `src/application/geocoding/place-glyph.ts`
- `src/application/places/place-scene.ts`
- `src/application/planner/rider-route-options.ts`
- `src/infrastructure/map/maplibre/geojson.ts`
- `src/infrastructure/map/maplibre/host.ts`
- `src/infrastructure/map/maplibre/scene-diff.ts`
- `src/infrastructure/map/maplibre/search-pin-images.ts`
- `src/infrastructure/map/maplibre/style.ts`
- `src/ui/place/PlaceSheet.tsx`
- `src/ui/place/search-home.css`
- `src/ui/place/usePlaceFlow.tsx`
- `src/ui/planner/PlannerResultPanel.tsx`
- `src/ui/planner/PlannerWorkspace.tsx`
- `src/ui/planner/PlannerWorkspaceDock.tsx`
- `src/ui/planner/RideStyleControls.tsx`
- `src/ui/planner/RouteOptions.tsx`
- `src/ui/planner/hooks/usePlannerCamera.ts`
- `src/ui/planner/hooks/usePlannerSheetActions.ts`
- `src/ui/planner/usePhonePlanner.ts`
- `src/ui/sheet/Sheet.tsx`
- `src/ui/sheet/sheet.css`
- `tests/e2e/critical/avoid-area.spec.ts`
- `tests/e2e/critical/compact-sheet.spec.ts`
- `tests/e2e/critical/connected-route-fixture.ts`
- `tests/e2e/critical/mobile-planner-ux.spec.ts`
- `tests/e2e/critical/routing-method-comparison.spec.ts`
- `tests/e2e/critical/search-card.spec.ts`
- `tests/e2e/visual/w1b-options.screenshots.spec.ts`
- `tests/integration/maplibre-host.test.ts`
- `tests/unit/infrastructure/maplibre/search-pin-images.test.ts`
- `tests/unit/infrastructure/maplibre/style-places.test.ts`
- `tests/unit/planner/rider-route-options.test.ts`
- `tests/unit/ui/avoid-area-workflow.test.tsx`
- `tests/unit/ui/focus-behavior.test.tsx`
- `tests/unit/ui/route-options.test.tsx`
- `tests/unit/ui/search-card.test.tsx`
- `tests/unit/ui/sheet.test.tsx`
