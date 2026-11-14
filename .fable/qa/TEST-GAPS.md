# Test gaps behind the rider-sweep misses

## Patterns
1. Fixture router: first-route, ride and loop gates run with a canned router answer and an empty basemap, so real routing, real latency, out-of-area behaviour and real error screens are never exercised.
2. One viewport: layouts are checked at a single phone size. 320 px, landscape and desktop-narrow break (QA-01, 02, 08, 09).
3. "Element exists" asserts: tests prove a button or label is present, not that it is readable, not clipped, not covered by another control, and not showing a number that contradicts the line next to it (QA-05, 09, 10, 16).
4. Seams between screens: Explore -> plan, GPX import -> naming, edit sheet -> map. Each screen has tests, the handoff has none (QA-06, 07, 11).
5. Clean-state bias: tests start with no weather alert, no events layer, no location, daytime. Riders have all four (QA-01, 05, 20).
6. Time of day: Auto appearance and "before sunrise" copy depend on the clock; nothing pins or varies it.

## Journey gates to add (all against the real router, never stubs)
1. Narrow-phone chrome gate: at 320x568 and 390x844, with a weather alert active, open Map, Explore, a place sheet and a planned route; assert no element's right edge exceeds the viewport, the top bar controls do not overlap (bounding boxes), and typed search text is visible.
2. Out-of-area gate: plan from Denver and Asheville; assert either a result carrying a visible "outside our area / basic route" label or a clear message within 10 s, and that no two text blocks overlap on the error sheet.
3. Route-summary truthfulness: for A-to-B and loop, assert the headline facts (distance, time, climb) are not truncated, the surface bar has at least as many distinct colours as legend entries, and the place-sheet distance agrees with the route distance within tolerance.
4. Explore handoff: open the first curated ride, record its facts, tap Ride this, assert the plan shows the same distance and surface text and a sensible start/end name.
5. Edit-route visibility: open Edit; assert the route extent intersects the visible map area and the stop count equals the listed stops.
6. Day/Night readability: toggle Day with events on; assert event labels have contrast above 3:1 (sample pixels) and do not sit on the location dot.
7. Landscape and resize: rotate during a plan and during a ride; assert nav, layers button and sheet actions stay reachable and uncovered.
8. Ride lock-on: simulate a start 50 mi away, accept "Head to the start", then walk the line in 15 m steps; assert no off-route banner appears while on the line, and that average speed never exceeds a sane cap.
9. Idle-request budget (keep): 60 s of pan and zoom must send zero route-plan requests; add a variant that starts the pan on the route line and expects no reshape without edit mode.
10. Loop stability: same start, same defaults, three runs; assert length within 15 percent and finish within 10 s; ride-time chips honoured (3 h loop is not 1 h 45).
