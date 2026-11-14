# Lane E report: route-line gestures and pen mode

Stacks on #230 (fix/og-planner-flow). Merge #230 first.

## QA-19: panning with a finger on the route line reshaped the route
- What the rider saw: dragging the map from a spot on the purple line pulled the line into a new shape and replanned (58 mi became 60 mi), no question asked.
- Cause: a mouse press on the selected line grabbed it at once (desktop "drag the line" from the 2026-10 owner review). Any drag that began on the line was a reshape.
- Fix (src/infrastructure/map/maplibre/host.ts): the line is grabbed only after a deliberate hold (0.45 s), for mouse and finger alike, the same rule pins already follow. A press that moves first is a pan. Hold, then drag adds one stop where you let go. Hold and let go without moving shows the road menu and plans nothing (this path also no longer sends a zero-length drag).
- Tests: e2e `route-gestures.spec.ts` ("a mouse drag that starts on the route line pans the map and plans nothing", "a finger pan ...", "holding the route line then dragging adds one stop (Undo names it)", "holding the route line without moving offers the road and plans nothing"). They find the line by looking at the screen pixels, count real /api/route-plan posts, and check the ride summary is unchanged. Unit: two tests in `tests/integration/maplibre-host.test.ts` (mouse and touch).
- Proof: on the old code the mouse-drag test fails (route requests went 2 to 3) and the hold-then-drag test fails; on the fix both pass, and 0 route requests for any pan. A finger pan never reshaped on the old code (touch had no line drag), so that test is a guard.

## Pen mode: panning taken as a stroke
- Finding: two fingers already pan the map while the pen is armed (OG-03, "dragPan touch with two fingers"), but nothing tested it. One finger still draws, by design.
- Cause of the real fault found: a tap or a shaky press with the pen armed counted as a stroke.
- Fix: a pen touch that never leaves its tap radius is cancelled, not drawn or replanned.
- Tests: "tapping the map with the pen armed draws nothing and plans nothing" (fails on old code, passes now); "with the pen armed, two fingers pan the map and draw nothing; one finger still draws" (guard: passes before and after).

## Test results (Windows PC, critical-chromium, 390x844 touch)
- route-gestures.spec.ts: 6/6 pass. map-gestures, draw, road-span specs: all pass.
- Vitest: maplibre-host integration (112) and interaction unit tests pass. tsc and eslint clean.
- Old behaviour for the touch-hold road menu changed slightly: the menu now opens when the finger lifts, not at 0.45 s, so a hold can still become a drag.
