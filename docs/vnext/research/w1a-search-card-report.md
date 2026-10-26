Wave 1A: search-first home, place cards and Directions

A rider opens Plan to a top search bar and one scrolling category row on phones and iPads. The idle phone sheet has Loop, Record and Free Ride. Desktop keeps its rail search. Search picks, category pins and rows, overlay places, and What's here open the same place sheet without changing the ride. Directions asks once for My location, sets both endpoints in one undoable edit, and opens route choices with Start ride. A failed location request leaves the start empty, shows the existing location message and focuses the start search. Named start searches have an explicit Use as start action; dropped pins have Start here. Route edits from the card and point menu offer a four-second Undo toast.

The card uses straight-line miles labelled away. A read-only preview through the existing routing bridge supplies drive time when available. It never enters the ride's planning session. Unknown location, drive time and opening state remain unknown. Search uses the rider's fix, falling back to the map center; categories use the server's existing category mapping. Category pins reuse the existing places scene and are framed above the half sheet. The gesture engine is unchanged.

Decisions made during implementation:

- Twisty roads enables the existing great-roads layer; Gravel enables gravel. Each shows a one-line toast. Neither invents place search results.
- Lodging reuses the existing hotel category 7314. Moto shop reuses motorcycle shop text search. [TomTom documents the motorcycle dealer category](https://developer.tomtom.com/assets/downloads/tomtom-sdks/android/api-reference/1.0.0/location/model/com.tomtom.sdk.location.poi/-standard-category-id/-companion/-motorcycle-dealer.html); no unverified numeric Search API ID was added.
- Route rows reuse RouteDecisionCard in compact form. Measured fastest/twistiest choices receive those names. Other rows keep the planner's actual role; an Alternative is not relabelled Most gravel without evidence. No new routing algorithm or synthetic alternative was added.
- Directions starts a new destination trip and clears earlier stops, shaping points and a sketch, while keeping the rider's bike, preferences and constraints. Add stop and the point menu’s Finish here preserve the current trip’s intermediate stops.
- Share uses the native share sheet when available and otherwise copies a coordinate link. Save uses existing device place memory.
- Existing weather and fuel UI specs now supply explicit synthetic provider windows/results, so they do not depend on an expired forecast or an unavailable optional live provider. Four existing invalid Testing Library exact options were removed to restore the baseline typecheck.

Verification:

- TypeScript: npx tsc --noEmit -p . passed.
- ESLint on all changed TypeScript/TSX files passed with no errors or warnings.
- Focused Vitest, --maxWorkers=4: 439 passed across 24 files. This includes 22 new tests for the place sheet, chips, toast, flow, atomic commands and read-only drive time.
- Architecture Vitest: 173 passed across 14 files.
- Production build: npm run build passed.
- Chromium browser journeys: 35 passed across 10 selected critical specs, including both requested paths, denied location, 320px/200% text, iPad/desktop cards and real touch gesture fuzz.

These are fixture-based UI checks, with an empty basemap. Live geocoding/routing quality, WebKit and physical iPhone/glove acceptance were not verified. Numeric motorcycle category IDs remain unverified; the existing text path is retained. Exact Fastest / Twistiest / Most gravel alternatives depend on the routing authority supplying distinct supported candidates.

Files changed (including this report):

- `docs/vnext/research/w1a-search-card-report.md`
- `src/app/PlannerClient.tsx`
- `src/app/layout.tsx`
- `src/application/geocoding/place-search.ts`
- `src/application/map/types.ts`
- `src/domain/ride/commands.ts`
- `src/domain/ride/reducer.ts`
- `src/infrastructure/geocoding/place-drive-time.ts`
- `src/server/geocoding/fixture-places.ts`
- `src/ui/layers/useMapLayers.ts`
- `src/ui/map/PlannerMap.tsx`
- `src/ui/place/PlaceSheet.tsx`
- `src/ui/place/RiderToast.tsx`
- `src/ui/place/TopSearch.tsx`
- `src/ui/place/search-home.css`
- `src/ui/place/usePlaceFlow.tsx`
- `src/ui/places/PlannerPlacesMap.tsx`
- `src/ui/planner/IntentComposer.tsx`
- `src/ui/planner/PhoneRideSummary.tsx`
- `src/ui/planner/PlaceSearchField.tsx`
- `src/ui/planner/PlannerResultPanel.tsx`
- `src/ui/planner/PlannerWorkspace.tsx`
- `src/ui/planner/PlannerWorkspaceDock.tsx`
- `src/ui/planner/PlannerWorkspaceFrame.tsx`
- `src/ui/planner/RouteDecisionCard.tsx`
- `src/ui/planner/controllers.ts`
- `src/ui/planner/hooks/usePlanCommand.ts`
- `src/ui/planner/hooks/usePlannerStops.ts`
- `src/ui/planner/usePlannerAnswerLifecycle.ts`
- `src/ui/planner/usePlannerPlaces.ts`
- `src/ui/stores/ride-document-store.ts`
- `tests/e2e/critical/map-gestures.spec.ts`
- `tests/e2e/critical/map-helpers.ts`
- `tests/e2e/critical/mobile-planner-ux.spec.ts`
- `tests/e2e/critical/offline.spec.ts`
- `tests/e2e/critical/place-search.spec.ts`
- `tests/e2e/critical/prepare.spec.ts`
- `tests/e2e/critical/ride-style.spec.ts`
- `tests/e2e/critical/routing-method-comparison.spec.ts`
- `tests/e2e/critical/search-card.spec.ts`
- `tests/e2e/critical/search-helpers.ts`
- `tests/e2e/critical/settings.spec.ts`
- `tests/e2e/critical/telemetry.spec.ts`
- `tests/e2e/visual/plan-shell.screenshots.spec.ts`
- `tests/unit/domain/ride-commands.test.ts`
- `tests/unit/infrastructure/geocoding/place-drive-time.test.ts`
- `tests/unit/ui/avoid-area-workflow.test.tsx`
- `tests/unit/ui/directions-command.test.ts`
- `tests/unit/ui/planner-map.test.tsx`
- `tests/unit/ui/planner-workspace.test.tsx`
- `tests/unit/ui/search-card.test.tsx`
- `tests/unit/ui/stops-workflow.test.tsx`
- `tests/unit/ui/update-recovery-workflow.test.tsx`

Screenshots (untracked, not committed):

- `w1a-shots/320x568-day-route-options-extra.png`
- `w1a-shots/375x812-day-home-idle.png`
- `w1a-shots/375x812-day-chip-results.png`
- `w1a-shots/375x812-day-place-card.png`
- `w1a-shots/375x812-day-route-options.png`
- `w1a-shots/375x812-night-home-idle.png`
- `w1a-shots/375x812-night-chip-results.png`
- `w1a-shots/375x812-night-place-card.png`
- `w1a-shots/375x812-night-route-options.png`
- `w1a-shots/390x844-day-home-idle.png`
- `w1a-shots/390x844-day-chip-results.png`
- `w1a-shots/390x844-day-place-card.png`
- `w1a-shots/390x844-day-route-options.png`
- `w1a-shots/390x844-night-home-idle.png`
- `w1a-shots/390x844-night-chip-results.png`
- `w1a-shots/390x844-night-place-card.png`
- `w1a-shots/390x844-night-route-options.png`

Each requested viewport/theme has home idle, chip results, place card and route options. One extra 320x568 route-options capture is also kept for layout inspection.
