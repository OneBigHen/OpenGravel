# Routing lane: Free Ride network, teaching budget, attention envelope (2026-10-03)

Branch `routing/freeride` (worktree `/root/Vibe/wt/og-rt-freeride`), based on current main.

## What landed on the branch

| PR | What | Verdict |
|---|---|---|
| #37 → #40 → #43 | Directed Free Ride network opportunities, network-first live query with projected-ahead fallback, quality/deadline controls | Merged as one stack, then hardened (below). Code is production-ready; **off in production** until a vetted corridor catalogue exists |
| #47 | Teach OpenGravel question budget | Merged as-is |
| #45 | Ride Focus attention envelope | Merged as-is (pure presentation policy, no callers yet) |

All three merged cleanly onto main (no drift in the touched files since their base `ddf8aef`).

## Free Ride network: review against the required properties

| Required property | Where it holds | Proven by |
|---|---|---|
| Forward-direction awareness | `matchCurrentSegment` rejects segments more than 100° from the rider's heading; the search follows directed edges only | `rejects a current segment that points behind the rider` |
| Real rejoin | A corridor needs a directed onward segment out of its exit that is not part of the corridor, not recently ridden, and not a U-turn. **Changed:** it now picks the straightest continuation (it used to take the first by id, which could be a 90° side road) | `requires an onward rejoin…`, new `rejoins on the straightest forward continuation, never a U-turn` |
| Traversal verification | The routed probe must recover at least 60% of 120 m corridor samples within 140 m. **Changed:** matching is now ordered. Each sample has to match at or after the previous sample's route position, so a route that rides the corridor backwards or touches it out of order fails. Before, it was proximity only | `measures whether a routed result actually traversed…`, new `rejects a route that rides the corridor backwards or out of order`, `falls back… when the routed network probe misses its corridor` |
| Bounded provider timeout | 2.5 s default (configurable from 0 to 10 s). The probe is aborted and the caller's cancel still wins. **Changed:** the same deadline now also covers loading the catalogue. Before, a hanging loader blocked the fallback with no limit | `abandons a slow optional network probe…`, new `never lets a slow network catalogue load delay…`, new `lets the caller's cancellation win…` |
| Minimum confidence/utility | Utility ≥ 0.60 and catalogue confidence ≥ 0.65 before a provider call is spent | `keeps a low-confidence network hint quiet…` (makes no network call) |
| Projected-ahead fallback always available | Every network failure path (loader error or timeout, weak hint, unresolved geometry, provider error or timeout, failed traversal) drops to the unchanged projected-ahead query | Four fallback tests above |
| Optional opportunity never delays maneuver guidance | Suggestions only run in `free` activity, which has no maneuvers. `ride-focus-store` schedules them as fire-and-forget, and they never block the navigation tick. The worst-case extra latency before the fallback suggestion is one deadline (2.5 s). **Changed:** the on-device Dijkstra horizon now uses a binary heap instead of re-sorting the frontier at every node. A 15.8k-segment grid at 70 mph finishes well under the 1.5 s test bound | new `searches a large regional network quickly enough to run while riding`. #45 also gives Free Ride opportunities the lowest attention priority |
| No catalogue hint treated as legality | The probe runs through `buildNetworkSuggestionIntent`, which keeps the ride's bike, surface, access, avoid, highway and toll constraints. Catalogue utility and confidence only decide whether to probe and are never copied into evidence. **Changed:** the label fallback is now "Suggested road" instead of "Better road" | `routes through the network corridor… retaining ride constraints`, new `keeps catalogue utility and confidence out of the suggestion's road evidence` |

### Why it is off in production

Nothing in the app supplies a corridor network. The `network` dependency was optional in #40, and `RideClient` never passed one. There is no trusted corridor catalogue or adapter in the repo, and making one up would break the no-fabricated-data rule. `createClientFreeRideServices` now takes an optional `freeRideNetwork` loader as the switch. When it is omitted, which is the case today, Free Ride behaves exactly as it does on main. To turn it on, the integrator needs to:

1. build a vetted corridor catalogue (`FreeRideNetworkDocument`, schemaVersion 1) from curated or library data;
2. pass `freeRideNetwork` in `RideClient`;
3. run a ride test and score it with the common scorecard (#48) before calling it an improvement.

## Live evidence (GraphHopper :8989, `motorcycle_twisty`, 16 sequential calls)

The corridor fragment is the 35–60% slice of a real A→B route. Each value is the share of fragment samples the route recovered, scored with the new ordered traversal check.

| Area | Fragment | Route via entry/exit | Reverse route B→A | Via route geometry reversed | `motorcycle_fastest` A→B |
|---|---|---|---|---|---|
| Hawk Mtn area | 4.5 km | 1.00 | 0.10 | 0.10 | 0.59 |
| Ohiopyle | 5.5 km | 1.00 | 0.06 | 0.06 | 1.00 |
| Delaware Water Gap | 5.1 km | 1.00 | 0.07 | 0.07 | 0.00 |
| Lancaster County | 5.8 km | 1.00 | 0.10 | 0.10 | 1.00 |

Forward traversal passes cleanly, and wrong-direction traversal scores no higher than 0.10, against the 0.60 threshold. The old proximity-only check would have accepted the reversed routes, because every sample still lies on them.

## #47 teaching budget

`selectPreferenceTeachingStep()` is a pure gate around the existing `selectPreferenceQuestion()`. It reads `explicitComparisons` and the information value of the chosen pair, then returns ask or stop. It does not change the model, add features, or touch route scoring or ranking. It only spends the question budget. Note: `explicit-like` observations also count toward `explicitComparisons`, as they did before this PR. No app caller exists yet.

## #45 attention envelope

`deriveRideAttentionEnvelope()` is a pure function. It takes numbers in and returns presentation hints: mode, density, and which elements to emphasize. Its priority order is critical warning > recovery > maneuver > Free Ride opportunity. It produces no routing, reroute, maneuver or speech output, so it has no navigation authority. No callers yet. Caveat for whoever wires it: when `moving` is false it returns `calm` and de-emphasizes the decision, even if a maneuver is 30 m ahead (for example, stopped at a sign just before a turn). Check that in the UI before using it to hide the maneuver card.

## Gates

`ogv-verify-wsl.sh … lint typecheck vitest build` → `ALL GATES: GREEN for a2c1eb4` (wsl). Vitest: 3,966+ tests pass. The first run went red only on `contrast-tokens`; that failure is already fixed on main by 3a4ce31, which is now merged into this branch.
