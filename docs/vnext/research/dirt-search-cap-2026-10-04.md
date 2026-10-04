# Dirt search: cap against the rider's own ETA (2026-10-04)

Follow-up to `ride-formula-benchmark-2026-10-04.md`, which found point-to-point dirt trips at 0% dirt.

## Cause

The rider-mode search (`searchRiderEnvelope`) capped detours at 1.35x the **motorcycle_fastest** ETA,
but its trials run on `motorcycle_adventure`, which limits speed to 0.82x car speed. The same paved
road therefore already read as ~1.21x, leaving ~11% for a dirt detour. Direct router probes showed
the dirt exists: Lock Haven -> Slate Run 104-115 min with 12-28% dirt, Gettysburg -> Pine Grove
66 min with 28% dirt, both rejected by the cap.

## Change

- The cap baseline is the slower of the fastest-profile ETA and the rider's own-profile ETA.
- Dirt mode may stretch to 1.75x; a slower route must buy >= 1 pp dirt per 3 extra minutes
  (and >= 2 pp), otherwise the faster route stays.
- Candidates the pipeline already produced are never dropped by the trial cap.
- Busy-road (Curvy + Avoid busy roads) search keeps 1.35x, now also against its own ETA.

## Benchmark, production treatment (live GraphHopper, same trips)

| Trip | Mode | Before min / dirt % | After min / dirt % | Notes |
|---|---|---|---|---|
| Pine Grove Furnace loop, 2 h | gravel | 107 / 38 | 107 / 38 | longest dirt 13 km, busy 0% |
| Pine Grove Furnace loop, 2 h | dual-sport | 118 / 42 | 118 / 42 | longest dirt 10.9 km, busy 2% |
| State College to Rothrock loop, 2 h | gravel | 118 / 36 | 118 / 36 | longest dirt 7.3 km, busy 19% |
| State College to Rothrock loop, 2 h | dual-sport | 121 / 41 | 121 / 41 | longest dirt 23 km, busy 26% |
| Jim Thorpe to Hickory Run | gravel | 44 / 0 | 44 / 0 | longest dirt 0 km, busy 3% |
| Jim Thorpe to Hickory Run | dual-sport | 44 / 0 | 44 / 0 | longest dirt 0 km, busy 3% |
| Lock Haven to Slate Run | gravel | 75 / 0 | 115 / 28 | longest dirt 18.2 km, busy 0% |
| Lock Haven to Slate Run | dual-sport | 75 / 0 | 115 / 28 | longest dirt 18.2 km, busy 0% |
| Gettysburg to Pine Grove Furnace | gravel | 38 / 0 | 36 / 0 | longest dirt 0 km, busy 0% |
| Gettysburg to Pine Grove Furnace | dual-sport | 38 / 0 | 66 / 28 | longest dirt 9.6 km, busy 0% |
| Williamsport to Waterville (Pine Creek) | gravel | 40 / 0 | 40 / 0 | longest dirt 0 km, busy 60% |
| Williamsport to Waterville (Pine Creek) | dual-sport | 40 / 0 | 40 / 0 | longest dirt 0 km, busy 60% |
| Allentown → Stroudsburg | curvy | 71 / 0 | 80 / 0 | longest dirt 0 km, busy 22% |
| Allentown → Stroudsburg | gravel | 58 / 0 | 58 / 0 | longest dirt 0 km, busy 70% |
| Hawk Mountain → Jim Thorpe | curvy | 59 / 0 | 59 / 0 | longest dirt 0 km, busy 0% |
| Hawk Mountain → Jim Thorpe | gravel | 72 / 2 | 59 / 2 | longest dirt 0.9 km, busy 0% |
| Doylestown → New Hope | curvy | 30 / 0 | 30 / 0 | longest dirt 0 km, busy 1% |
| Doylestown → New Hope | gravel | 38 / 6 | 38 / 6 | longest dirt 1.4 km, busy 1% |
| Harrisburg → Lancaster | curvy | 55 / 0 | 78 / 0 | longest dirt 0 km, busy 9% |
| Harrisburg → Lancaster | gravel | 50 / 0 | 50 / 0 | longest dirt 0 km, busy 90% |
| Reading → Jim Thorpe | curvy | 123 / 1 | 123 / 1 | longest dirt 1 km, busy 4% |
| Reading → Jim Thorpe | gravel | 143 / 6 | 116 / 6 | longest dirt 5 km, busy 3% |
| West Chester → Lancaster | curvy | 82 / 0 | 82 / 0 | longest dirt 0 km, busy 3% |
| West Chester → Lancaster | gravel | 66 / 0 | 66 / 0 | longest dirt 0 km, busy 48% |
| Bethlehem → Delaware Water Gap | curvy | 66 / 0 | 76 / 0 | longest dirt 0.1 km, busy 3% |
| Bethlehem → Delaware Water Gap | gravel | 74 / 0 | 55 / 0 | longest dirt 0.1 km, busy 63% |
| Cherry Hill → Batsto Village | curvy | 75 / 0 | 75 / 0 | longest dirt 0 km, busy 1% |
| Cherry Hill → Batsto Village | gravel | 92 / 1 | 77 / 1 | longest dirt 0.5 km, busy 1% |

## Formula fixes (same day)

- **Paved roads read as dirt.** `ride-formula.ts` counted any `tracktype=grade1..4` as dirt, even with
  `surface=asphalt`. PA 44 is `asphalt|secondary|grade1` for 15 km, so the all-paved Lock Haven route
  scored 29% dirt, the same as the real dirt route, and its faster ETA won (39.1 vs 35.5). Now an explicit
  surface wins; grade1 is never dirt (OSM: solid, usually paved); grade2-4 count only when the surface is
  untagged. After the fix: paved 22.0, dirt 34.6.
- **Formula cap.** The pipeline's recommendation cap (1.35x the fastest eligible ETA) had the same
  profile-ETA skew; it now measures from the rider's own profile and gives dirt riders 1.75x. The shadow
  diagnostic pick in plan-service uses the same rule.
- **Benchmark seeds.** Loop shapes are seeded by the request id, and the benchmark gave production and
  formula different ids, so loop "losses" compared two different loops. Both treatments now share a seed.
  With the same seed, Pine Grove's formula pick is the 38%-dirt loop (43.3 vs 35.0).

Benchmark after all fixes (production -> formula, both with the search fix):

|---|---:|---|---|---|---|---|---|
| Dirt-focused trips | 12 | 17 -> 22 | 9.1 -> 11.8 | 52 -> 59 | 13 -> 6 | 85 -> 88 | 28.9 -> 32.6 |
| PA/NJ corpus | 16 | 1 -> 1 | 0.6 -> 0.5 | 36 -> 48 | 20 -> 13 | 70 -> 72 | 26.3 -> 27.8 |
| All | 28 | 8 -> 10 | 4.2 -> 5.3 | 43 -> 53 | 17 -> 10 | 77 -> 79 | 27.4 -> 29.9 |

Verdicts over 28 plans: 7 win, 5 loss, 16 tie or same route. A win means the formula route has at least +3 pp dirt (dirt modes) or +10% Franco curvature per km (Curvy), with busy-road share not worse by more than 10 pp.

Open: Pine Grove loops still -5/-6 pp; Curvy formula loses on 3 trips (Allentown, Reading, West Chester).
Next: oracle/regret columns in the benchmark (best route in the pool vs the pick), a multi-strength
dirt sweep feeding one pool, dirt-km/continuity value in place of percentage points, and moving
rider taste out of profile speeds (needs an LM rebuild off-host).
