# Production loop speed report (branch perf/prod-routing, 2026-11-14)

Result: the goal (every timed loop at 15 s or less on production hardware) is NOT met by anything that keeps the scorecard intact. This PR does not say "Fixes #251". It ships a safe guard and the evidence, and names the decision that is left.

## Where the time goes (measured on production's router, localhost:8989)

1. A loop plan makes 25 to 50 router calls (4 road styles x 3 engine seeds, then a distance correction pass, plus a re-seed when a loop rides down a dead end). They already run in parallel (9 at once). Hatboro 2 h: 41 to 54 calls; Crystal Cave 34 to 37; Lansdale 25 to 34; Phoenixville 33; Green Lane 27 to 31; Frenchtown 25 to 34.
2. The calls are cheap on the PC and dear on the box. One call visits 50k to 700k graph nodes (total 2 to 10 M nodes per plan). The PC does about 0.4 M nodes/s per thread; docker-stable does about 0.13 M nodes/s per thread (3x slower per thread).
3. docker-stable cannot use its 8 threads. A 4 s spin test inside it gave 16.9 M loops for 1 process, 15.3 M each for 4 processes, and only 9.5 M each for 8 processes: about 4.4 cores of real capacity. The host (megaplex) shows the Frigate VM (kvm -id 113) using 500 to 725 % CPU of 12 threads, load average 18 to 25, host memory 26 of 32 GB used, host swap 8 of 16 GB. So a burst of 9 requests shares roughly 0.4 M nodes/s in total, and plan time is simply nodes divided by that.
4. Swapping is not the router's problem: java VmSwap is 0 kB, heap 1 to 4 GB, RSS 3.2 GB. (CT swap is full, but it holds other containers' idle pages; the hike router, pid 94, has 0.5 GB swapped.)
5. Request parameters: loops use algorithm=round_trip (no alternatives, no ch, LM profiles active, no max_visited_nodes, no point hints). The engine's own limit on a search was none. Some seeds make the engine wander: a 109 km ask returned a 286 km loop after 12.5 M visited nodes, 30 s on the box ("Connection between locations not found" after the 30 s router budget), 13.5 s on the PC. Abandoned requests keep burning CPU on the router after the app gives up.
6. Hatboro in the app uses a random request id, so its seeds differ every plan; that is why it swings between 17 and 39 s on the same box (see QA-13, og-loopstab).

## What this PR changes

- Round-trip requests now carry `max_visited_nodes: 1500000` (per search leg; env `OGV_LOOP_MAX_VISITED_NODES`, 0 = off). A seed that runs into the cap is asked again at half the distance (once) instead of burning 10 to 30 s or being lost. Normal legs stay far under the cap, so the scorecard is unchanged.
- Tests: new unit tests for the cap and the retry; request-builder expectation updated. 104 graphhopper unit tests pass, tsc clean.

## Before / after on production (docker-stable via tunnel 8989, full plan with alternatives, fresh process per run, A and C interleaved, seconds)

| Loop | Before try 1 / try 2 | After try 1 / try 2 |
|---|---|---|
| Hatboro 2 h (app default) | 16.8 / 39.1 | 32.1 / 38.0 |
| Crystal Cave | 29.7 / 30.7 | 28.3 / 29.5 |
| Lansdale | 17.4 / 20.1 | 20.9 / 17.6 |
| Phoenixville | 14.8 / 13.6 | 15.6 / 14.3 |
| Green Lane | 10.0 / 10.2 | 9.6 / 8.6 |
| Frenchtown 3 h | 26.8 / 23.7 | 24.1 / 23.8 |

Honest reading: the cap makes no visible difference on these runs. Production load (the Frigate VM) moves times more than the change does. It only removes the rare 30 s runaway call. Earlier runs of the same loops on the same box under quieter conditions: Hatboro 29 to 35, Crystal 22.

## Scorecard (tuning set, PC router, same frozen map)

| Run | v3 wins | v2 | v1 | Trust failures | Good miles / extra minutes | Router calls (sum over 20 rides) |
|---|---|---|---|---|---|---|
| A: main, before | 13/20 | 9/20 | 4/20 | 0 | +169.2 / +221.9 | 536 |
| C: this PR | 13/20 | 9/20 | 4/20 | 0 | +169.2 / +221.9 | same rows (all 20 verdicts identical) |

No loss. Files: runs/score-A.out, score-C.out (and .json).

## Things tried that save real work but cost quality (not shipped)

| Idea | Work saved | Scorecard |
|---|---|---|
| Start loops at 0.72 of the distance (first ask runs about 1.4x long: final/first = 0.52 to 0.85 over six loops) | Hatboro 20.4 M to 3.3 M nodes on the PC, Crystal 10.7 to 8.2 M, calls 35 vs 50 | 13/20 down to 11/20: Green Buch Win to Loss, Old Buck Win to Tie, Hawley Tie to Loss. Rejected. |
| 2 engine seeds instead of 3 | router calls 536 to 364 (-32 %) | 13/20 down to 12/20: Green Buch Win to Loss. Rejected. |
| `lm.disable`, `lm.active_landmarks` 6 or 12 | none or worse | routes change (only 7 of 41 identical with LM off); 8 landmarks is already the default. Rejected. |
| ParallelGC instead of G1 (PC, Java 17, 41 real loop calls) | 2 % | not worth a change |

## Router / JVM drop-in

None recommended. The JVM is not the limit (no swap, heap fine, GC change gains 2 %). Config changes that would speed searches (LM settings) change routes.

## What is left (owner / coordinator decision)

The box has about 4 usable cores, each 3x slower than a PC core, and the plan needs 2 to 10 M node visits. To reach 15 s or less for every loop without touching the loop pool, pick one:
1. Give the router more of the host. The Frigate VM (id 113) takes 5 to 7 of the 12 host threads all day. Raising CT109's `cpuunits` (currently 2048) or capping/pinning the Frigate VM would lift the 4.4-core ceiling toward 8. I did not touch the host; this is untested and affects Frigate.
2. Run the router somewhere faster (the PC does Hatboro in 3 to 10 s, all six under 10 s) or a box without Frigate on it.
3. Accept a smaller loop pool (2 seeds, or a 0.72 start) and re-tune it so Green Buch / Old Buck / Hawley still win; that is planner-tuning work, and og-loopstab is in the same files.
Also: show the first answer early in the UI (first answer is 0.9 s p50 on the PC) so the 30 s full plan is not what the rider waits on.

Scripts: .fable/rm7-time.mts (timing with per-call log), .fable/timeall.sh, .fable/ab-prod.sh, .fable/cap-sweep.py, .fable/var-sweep.py, .fable/bench.py, .fable/score1.sh.
