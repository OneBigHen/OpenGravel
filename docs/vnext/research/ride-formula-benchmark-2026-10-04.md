# Ride Formula benchmark (live GraphHopper, PA/NJ)

Run: 2026-10-04T04:17:15.087Z. Router: http://127.0.0.1:8989 (profiles_lm landmarks, PA+NJ). Strictly sequential.

Three plans per trip and mode: **fastest** (plain fastest profile, the Google-like baseline), **production** (today's Best Ride: rider modes and knee search; Gravel Atlas probes and Ride Formula off), **formula** (Gravel Atlas probes on, `OGV_RIDE_FORMULA=on`, request-time penalty rules on).
Dirt % is distance-weighted unpaved surface (gravel, fine_gravel, compacted, dirt, ground, unpaved; sand excluded and never routed). Franco bend % and Franco /km are the roadcurvature.com style measure (franco-v1) of the returned line. Busy % is primary/trunk/motorway, links and CITY density. Formula is ride-formula-v1 (0-100) for the trip's mode, the same scorer for every row. Loops have no fastest baseline (`vs fastest` is n/a).

## Summary (production -> formula, means)

| Set | Plans | Dirt % | Longest dirt km | Franco /km | Busy % | Minutes | Formula value |
|---|---:|---|---|---|---|---|---|
| Dirt-focused trips | 12 | 13 -> 9 | 4.5 -> 5.0 | 47 -> 45 | 24 -> 13 | 71 -> 72 | 28.7 -> 27.8 |
| PA/NJ corpus | 16 | 1 -> 1 | 0.6 -> 0.4 | 35 -> 43 | 22 -> 23 | 72 -> 67 | 26.2 -> 27.3 |
| All | 28 | 6 -> 4 | 2.3 -> 2.4 | 40 -> 44 | 23 -> 19 | 72 -> 69 | 27.3 -> 27.5 |

Verdicts over 28 plans: 5 win, 7 loss, 16 tie or same route. A win means the formula route has at least +3 pp dirt (dirt modes) or +10% Franco curvature per km (Curvy), with busy-road share not worse by more than 10 pp.

## Dirt-focused trips

| Trip | Mode | Route | Min | vs fastest | vs prod | Dirt % | Longest dirt km | Franco bend % | Franco /km | Busy % | Formula | Verdict |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Pine Grove Furnace loop, 2 h | gravel | fastest | n/a | | | | | | | | |  |
| Pine Grove Furnace loop, 2 h | gravel | production | 107 | n/a |  | 38 | 13.0 | 5 | 80 | 0 | 36.4 |  |
| Pine Grove Furnace loop, 2 h | gravel | formula | 106 | n/a | -1 min | 19 | 13.6 | 3 | 41 | 4 | 31.1 | LOSS (-19 pp dirt) |
| Pine Grove Furnace loop, 2 h | dual-sport | fastest | n/a | | | | | | | | |  |
| Pine Grove Furnace loop, 2 h | dual-sport | production | 118 | n/a |  | 42 | 10.9 | 4 | 61 | 2 | 37.3 |  |
| Pine Grove Furnace loop, 2 h | dual-sport | formula | 106 | n/a | -12 min | 16 | 9.6 | 5 | 65 | 0 | 30.2 | LOSS (-26 pp dirt) |
| State College to Rothrock loop, 2 h | gravel | fastest | n/a | | | | | | | | |  |
| State College to Rothrock loop, 2 h | gravel | production | 118 | n/a |  | 36 | 7.3 | 5 | 67 | 19 | 39.2 |  |
| State College to Rothrock loop, 2 h | gravel | formula | 119 | n/a | 1 min | 42 | 9.9 | 6 | 87 | 16 | 40.4 | WIN (+5 pp dirt, +1 min) |
| State College to Rothrock loop, 2 h | dual-sport | fastest | n/a | | | | | | | | |  |
| State College to Rothrock loop, 2 h | dual-sport | production | 121 | n/a |  | 41 | 23.0 | 5 | 72 | 26 | 39.8 |  |
| State College to Rothrock loop, 2 h | dual-sport | formula | 133 | n/a | 12 min | 28 | 26.4 | 4 | 55 | 7 | 36.9 | LOSS (-13 pp dirt) |
| Jim Thorpe to Hickory Run | gravel | fastest | 44 | - |  | 0 | 0.0 | 5 | 70 | 3 | 21.6 |  |
| Jim Thorpe to Hickory Run | gravel | production | 44 | 0% |  | 0 | 0.0 | 5 | 70 | 3 | 21.6 |  |
| Jim Thorpe to Hickory Run | gravel | formula | 44 | 0% | 0 min | 0 | 0.0 | 5 | 70 | 3 | 21.6 | same route |
| Jim Thorpe to Hickory Run | dual-sport | fastest | 44 | - |  | 0 | 0.0 | 5 | 70 | 3 | 21.3 |  |
| Jim Thorpe to Hickory Run | dual-sport | production | 44 | 0% |  | 0 | 0.0 | 5 | 70 | 3 | 21.3 |  |
| Jim Thorpe to Hickory Run | dual-sport | formula | 44 | 0% | 0 min | 0 | 0.0 | 5 | 70 | 3 | 21.3 | same route |
| Lock Haven to Slate Run | gravel | fastest | 75 | - |  | 0 | 0.0 | 3 | 36 | 1 | 39.1 |  |
| Lock Haven to Slate Run | gravel | production | 75 | 0% |  | 0 | 0.0 | 3 | 36 | 1 | 39.1 |  |
| Lock Haven to Slate Run | gravel | formula | 75 | -0% | -0 min | 0 | 0.0 | 3 | 36 | 1 | 39.1 | tie |
| Lock Haven to Slate Run | dual-sport | fastest | 75 | - |  | 0 | 0.0 | 3 | 36 | 1 | 38.8 |  |
| Lock Haven to Slate Run | dual-sport | production | 75 | 0% |  | 0 | 0.0 | 3 | 36 | 1 | 38.8 |  |
| Lock Haven to Slate Run | dual-sport | formula | 75 | -0% | -0 min | 0 | 0.0 | 3 | 36 | 1 | 38.8 | tie |
| Gettysburg to Pine Grove Furnace | gravel | fastest | 38 | - |  | 0 | 0.0 | 2 | 31 | 59 | 18.6 |  |
| Gettysburg to Pine Grove Furnace | gravel | production | 38 | 0% |  | 0 | 0.0 | 2 | 31 | 59 | 18.6 |  |
| Gettysburg to Pine Grove Furnace | gravel | formula | 43 | 13% | 5 min | 0 | 0.0 | 3 | 39 | 0 | 20.6 | tie |
| Gettysburg to Pine Grove Furnace | dual-sport | fastest | 38 | - |  | 0 | 0.0 | 2 | 31 | 59 | 18.7 |  |
| Gettysburg to Pine Grove Furnace | dual-sport | production | 38 | 0% |  | 0 | 0.0 | 2 | 31 | 59 | 18.7 |  |
| Gettysburg to Pine Grove Furnace | dual-sport | formula | 43 | 13% | 5 min | 0 | 0.0 | 3 | 39 | 0 | 20.2 | tie |
| Williamsport to Waterville (Pine Creek) | gravel | fastest | 40 | - |  | 0 | 0.0 | 0 | 4 | 60 | 16.8 |  |
| Williamsport to Waterville (Pine Creek) | gravel | production | 40 | 0% |  | 0 | 0.0 | 0 | 4 | 60 | 16.8 |  |
| Williamsport to Waterville (Pine Creek) | gravel | formula | 40 | 0% | 0 min | 0 | 0.0 | 0 | 4 | 60 | 16.8 | same route |
| Williamsport to Waterville (Pine Creek) | dual-sport | fastest | 40 | - |  | 0 | 0.0 | 0 | 4 | 60 | 17.0 |  |
| Williamsport to Waterville (Pine Creek) | dual-sport | production | 40 | 0% |  | 0 | 0.0 | 0 | 4 | 60 | 17.0 |  |
| Williamsport to Waterville (Pine Creek) | dual-sport | formula | 40 | 0% | 0 min | 0 | 0.0 | 0 | 4 | 60 | 17.0 | same route |

## PA/NJ corpus

| Trip | Mode | Route | Min | vs fastest | vs prod | Dirt % | Longest dirt km | Franco bend % | Franco /km | Busy % | Formula | Verdict |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Allentown → Stroudsburg | curvy | fastest | 58 | - |  | 0 | 0.0 | 2 | 38 | 70 | 30.6 |  |
| Allentown → Stroudsburg | curvy | production | 71 | 22% |  | 0 | 0.0 | 2 | 33 | 27 | 32.2 |  |
| Allentown → Stroudsburg | curvy | formula | 70 | 21% | -0 min | 0 | 0.0 | 3 | 47 | 25 | 33.1 | WIN (+44% curvature, -0 min) |
| Allentown → Stroudsburg | gravel | fastest | 58 | - |  | 0 | 0.0 | 2 | 38 | 70 | 18.5 |  |
| Allentown → Stroudsburg | gravel | production | 58 | 0% |  | 0 | 0.0 | 2 | 38 | 70 | 18.5 |  |
| Allentown → Stroudsburg | gravel | formula | 54 | -7% | -4 min | 0 | 0.0 | 2 | 28 | 100 | 18.5 | tie |
| Hawk Mountain → Jim Thorpe | curvy | fastest | 59 | - |  | 2 | 0.9 | 1 | 19 | 0 | 31.4 |  |
| Hawk Mountain → Jim Thorpe | curvy | production | 59 | -0% |  | 0 | 0.0 | 2 | 23 | 0 | 35.5 |  |
| Hawk Mountain → Jim Thorpe | curvy | formula | 59 | -0% | 0 min | 0 | 0.0 | 2 | 23 | 0 | 35.5 | same route |
| Hawk Mountain → Jim Thorpe | gravel | fastest | 59 | - |  | 2 | 0.9 | 1 | 19 | 0 | 21.9 |  |
| Hawk Mountain → Jim Thorpe | gravel | production | 72 | 23% |  | 2 | 0.9 | 2 | 29 | 0 | 23.8 |  |
| Hawk Mountain → Jim Thorpe | gravel | formula | 59 | 1% | -13 min | 0 | 0.2 | 2 | 33 | 0 | 22.5 | tie |
| Doylestown → New Hope | curvy | fastest | 29 | - |  | 0 | 0.0 | 2 | 38 | 9 | 28.7 |  |
| Doylestown → New Hope | curvy | production | 30 | 2% |  | 0 | 0.0 | 2 | 37 | 1 | 31.9 |  |
| Doylestown → New Hope | curvy | formula | 31 | 8% | 2 min | 0 | 0.0 | 7 | 105 | 1 | 35.8 | WIN (+181% curvature, +2 min) |
| Doylestown → New Hope | gravel | fastest | 29 | - |  | 0 | 0.0 | 2 | 38 | 9 | 17.6 |  |
| Doylestown → New Hope | gravel | production | 38 | 31% |  | 6 | 1.4 | 2 | 29 | 1 | 21.5 |  |
| Doylestown → New Hope | gravel | formula | 29 | -1% | -9 min | 0 | 0.0 | 4 | 61 | 1 | 19.3 | LOSS (-6 pp dirt) |
| Harrisburg → Lancaster | curvy | fastest | 50 | - |  | 0 | 0.0 | 1 | 20 | 90 | 24.2 |  |
| Harrisburg → Lancaster | curvy | production | 55 | 9% |  | 0 | 0.0 | 2 | 26 | 77 | 25.8 |  |
| Harrisburg → Lancaster | curvy | formula | 55 | 10% | 1 min | 0 | 0.0 | 1 | 22 | 75 | 27.4 | LOSS (-14% curvature) |
| Harrisburg → Lancaster | gravel | fastest | 50 | - |  | 0 | 0.0 | 1 | 20 | 90 | 14.8 |  |
| Harrisburg → Lancaster | gravel | production | 50 | 0% |  | 0 | 0.0 | 1 | 20 | 90 | 14.8 |  |
| Harrisburg → Lancaster | gravel | formula | 49 | -2% | -1 min | 0 | 0.0 | 2 | 25 | 97 | 16.7 | tie |
| Reading → Jim Thorpe | curvy | fastest | 107 | - |  | 1 | 1.0 | 3 | 41 | 18 | 35.4 |  |
| Reading → Jim Thorpe | curvy | production | 123 | 15% |  | 1 | 1.0 | 4 | 58 | 4 | 34.3 |  |
| Reading → Jim Thorpe | curvy | formula | 107 | 0% | -16 min | 1 | 1.0 | 3 | 41 | 18 | 35.4 | LOSS (-29% curvature) |
| Reading → Jim Thorpe | gravel | fastest | 107 | - |  | 1 | 1.0 | 3 | 41 | 18 | 23.9 |  |
| Reading → Jim Thorpe | gravel | production | 143 | 33% |  | 6 | 5.0 | 5 | 72 | 2 | 29.8 |  |
| Reading → Jim Thorpe | gravel | formula | 112 | 4% | -31 min | 5 | 5.0 | 4 | 52 | 4 | 31.1 | tie |
| West Chester → Lancaster | curvy | fastest | 66 | - |  | 0 | 0.0 | 1 | 21 | 48 | 26.4 |  |
| West Chester → Lancaster | curvy | production | 82 | 25% |  | 0 | 0.0 | 3 | 43 | 3 | 34.1 |  |
| West Chester → Lancaster | curvy | formula | 76 | 15% | -6 min | 0 | 0.0 | 2 | 34 | 4 | 34.8 | LOSS (-21% curvature) |
| West Chester → Lancaster | gravel | fastest | 66 | - |  | 0 | 0.0 | 1 | 21 | 48 | 16.5 |  |
| West Chester → Lancaster | gravel | production | 66 | 0% |  | 0 | 0.0 | 1 | 21 | 48 | 16.5 |  |
| West Chester → Lancaster | gravel | formula | 76 | 15% | 10 min | 0 | 0.0 | 2 | 34 | 4 | 20.8 | tie |
| Bethlehem → Delaware Water Gap | curvy | fastest | 55 | - |  | 0 | 0.1 | 3 | 48 | 63 | 30.4 |  |
| Bethlehem → Delaware Water Gap | curvy | production | 66 | 20% |  | 0 | 0.1 | 3 | 41 | 17 | 33.5 |  |
| Bethlehem → Delaware Water Gap | curvy | formula | 62 | 13% | -4 min | 0 | 0.1 | 4 | 61 | 18 | 32.8 | WIN (+47% curvature, -4 min) |
| Bethlehem → Delaware Water Gap | gravel | fastest | 55 | - |  | 0 | 0.1 | 3 | 48 | 63 | 18.7 |  |
| Bethlehem → Delaware Water Gap | gravel | production | 74 | 33% |  | 0 | 0.1 | 4 | 61 | 18 | 19.2 |  |
| Bethlehem → Delaware Water Gap | gravel | formula | 62 | 13% | -11 min | 0 | 0.1 | 4 | 61 | 18 | 20.1 | tie |
| Cherry Hill → Batsto Village | curvy | fastest | 79 | - |  | 0 | 0.0 | 2 | 29 | 30 | 27.9 |  |
| Cherry Hill → Batsto Village | curvy | production | 75 | -5% |  | 0 | 0.0 | 1 | 13 | 1 | 28.0 |  |
| Cherry Hill → Batsto Village | curvy | formula | 98 | 24% | 22 min | 0 | 0.0 | 2 | 33 | 0 | 31.1 | WIN (+152% curvature, +22 min) |
| Cherry Hill → Batsto Village | gravel | fastest | 79 | - |  | 0 | 0.0 | 2 | 29 | 30 | 17.0 |  |
| Cherry Hill → Batsto Village | gravel | production | 92 | 16% |  | 1 | 0.6 | 1 | 21 | 0 | 19.7 |  |
| Cherry Hill → Batsto Village | gravel | formula | 77 | -3% | -15 min | 1 | 0.5 | 1 | 23 | 1 | 21.4 | tie |

## Cost

| Trip | Mode | Production calls | Production s | Formula calls | Formula s | Notes |
|---|---|---:|---:|---:|---:|---|
| Pine Grove Furnace loop, 2 h | gravel | 4 | 3.7 | 7 | 5.4 | pool 107/108/105;  | pool 106/133/122; atlas 111 corridors, 2 calls, probes: no-route:time-cap / skipped-budget:budget |
| Pine Grove Furnace loop, 2 h | dual-sport | 4 | 2.3 | 7 | 3.1 | pool 118/132/126;  | pool 106/126/120; atlas 111 corridors, 2 calls, probes: no-route:time-cap / skipped-budget:budget |
| State College to Rothrock loop, 2 h | gravel | 4 | 1.6 | 7 | 3.8 | pool 118/98/154;  | pool 119/112/135; atlas 173 corridors, 2 calls, probes: no-route:time-cap / skipped-budget:budget |
| State College to Rothrock loop, 2 h | dual-sport | 4 | 2.5 | 7 | 5.8 | pool 121/111/118;  | pool 133/109/123; atlas 173 corridors, 2 calls, probes: no-route:time-cap / skipped-budget:budget |
| Jim Thorpe to Hickory Run | gravel | 7 | 0.3 | 8 | 0.7 | pool 44;  | pool 44/84; atlas 21 corridors, 0 calls, probes: none |
| Jim Thorpe to Hickory Run | dual-sport | 7 | 0.3 | 8 | 0.4 | pool 44;  | pool 44/84; atlas 21 corridors, 0 calls, probes: none |
| Lock Haven to Slate Run | gravel | 7 | 0.4 | 8 | 1.5 | pool 115/75;  | pool 75/115; atlas 207 corridors, 0 calls, probes: none |
| Lock Haven to Slate Run | dual-sport | 7 | 0.3 | 8 | 1.3 | pool 115/75;  | pool 75/115; atlas 207 corridors, 0 calls, probes: none |
| Gettysburg to Pine Grove Furnace | gravel | 7 | 0.2 | 10 | 0.9 | pool 36/38;  | pool 43/38/36; atlas 32 corridors, 2 calls, probes: no-route:time-cap / skipped-budget:budget |
| Gettysburg to Pine Grove Furnace | dual-sport | 7 | 0.5 | 10 | 1.0 | pool 66/38/36;  | pool 43/38/36; atlas 32 corridors, 2 calls, probes: no-route:time-cap / skipped-budget:budget |
| Williamsport to Waterville (Pine Creek) | gravel | 7 | 0.5 | 10 | 1.6 | pool 68/40/55;  | pool 40/75/55; atlas 37 corridors, 2 calls, probes: no-route:time-cap / no-route:time-cap |
| Williamsport to Waterville (Pine Creek) | dual-sport | 7 | 0.4 | 10 | 1.4 | pool 68/40/55;  | pool 40/75/55; atlas 37 corridors, 2 calls, probes: no-route:time-cap / no-route:time-cap |
| Allentown → Stroudsburg | curvy | 7 | 1.5 | 10 | 7.3 | pool 80/71/58;  | pool 70/58/83; atlas 197 corridors, 2 calls, probes: no-route:time-cap / no-route:time-cap |
| Allentown → Stroudsburg | gravel | 7 | 3.6 | 10 | 7.8 | pool 92/74/58;  | pool 54/73/58; atlas 58 corridors, 2 calls, probes: no-route:time-cap |
| Hawk Mountain → Jim Thorpe | curvy | 7 | 0.7 | 10 | 1.9 | pool 59/59;  | pool 59/59; atlas 156 corridors, 2 calls, probes: no-route:time-cap / no-route:time-cap |
| Hawk Mountain → Jim Thorpe | gravel | 7 | 0.3 | 11 | 1.4 | pool 72;  | pool 59/72; atlas 48 corridors, 3 calls, probes: duplicate:ok 73min / no-route:time-cap |
| Doylestown → New Hope | curvy | 7 | 0.3 | 9 | 0.9 | pool 30/29/29;  | pool 31/26/29; atlas 18 corridors, 1 calls, probes: ineligible:ok |
| Doylestown → New Hope | gravel | 7 | 0.4 | 9 | 1.2 | pool 30/26/38;  | pool 29/30/29; atlas 10 corridors, 1 calls, probes: duplicate:ok 33min |
| Harrisburg → Lancaster | curvy | 7 | 1.8 | 10 | 7.0 | pool 79/55/83;  | pool 55/50/83; atlas 175 corridors, 2 calls, probes: no-route:time-cap / skipped-budget:budget |
| Harrisburg → Lancaster | gravel | 7 | 3.2 | 9 | 7.4 | pool 85/50/77;  | pool 49/90/76; atlas 29 corridors, 1 calls, probes: no-route:low-adherence |
| Reading → Jim Thorpe | curvy | 7 | 1.3 | 10 | 7.3 | pool 123;  | pool 107/130/124; atlas 393 corridors, 2 calls, probes: no-route:time-cap / no-route:time-cap |
| Reading → Jim Thorpe | gravel | 7 | 3.9 | 10 | 7.3 | pool 132/116/143;  | pool 112/130/136; atlas 119 corridors, 2 calls, probes: duplicate:ok 147min / skipped-budget:budget |
| West Chester → Lancaster | curvy | 7 | 1.3 | 10 | 5.4 | pool 82;  | pool 76/66; atlas 180 corridors, 2 calls, probes: no-route:time-cap / no-route:time-cap |
| West Chester → Lancaster | gravel | 7 | 3.9 | 10 | 6.9 | pool 76/66;  | pool 76/66/87; atlas 49 corridors, 2 calls, probes: no-route:time-cap / no-route:time-cap |
| Bethlehem → Delaware Water Gap | curvy | 7 | 0.9 | 10 | 4.8 | pool 66/61/66;  | pool 62/55/77; atlas 169 corridors, 2 calls, probes: no-route:time-cap / no-route:time-cap |
| Bethlehem → Delaware Water Gap | gravel | 7 | 2.1 | 10 | 3.7 | pool 74;  | pool 62/55/76; atlas 45 corridors, 2 calls, probes: no-route:time-cap / skipped-budget:budget |
| Cherry Hill → Batsto Village | curvy | 7 | 2.0 | 11 | 8.3 | pool 80/74/75;  | pool 98/79/76; atlas 36 corridors, 3 calls, probes: new:ok 98min dirt0% / duplicate:ok 90min |
| Cherry Hill → Batsto Village | gravel | 7 | 3.2 | 8 | 3.3 | pool 81/77/92;  | pool 77/79/81; atlas 75 corridors, 0 calls, probes: none |

## Outcome and switch settings (2026-10-04)

- **The formula does not beat production yet.** Over 28 plans it scored 5 wins, 7 losses and 16 ties or identical routes. The losses are mostly dirt-mode loops (Pine Grove: 38% → 19% dirt), where the formula treatment ends up with a different, less dirty candidate pool than production.
- **The request-time penalty rules are not the cause.** A dirt-trip rerun with them off (`BENCH_REQUEST_RULES=off`) gave the same verdicts: Pine Grove gravel was still a loss (−24 pp) and Rothrock gravel still a win (+5 pp).
- **Point-to-point dirt is the real gap.** Lock Haven → Slate Run, Williamsport → Waterville, Gettysburg → Pine Grove and Jim Thorpe → Hickory Run come out at 0% dirt in production and in the formula. Every Gravel Atlas probe either hits the time cap (the router's path to the corridor costs far more than the estimate) or finds no corridor that fits. Widening the dirt detour cap from 1.35× to 1.75× did not change that, so the change was not kept.
- **Shipped settings:** `OGV_RIDE_FORMULA=shadow` (it scores every plan in diagnostics, riders see no change) and `OGV_ATLAS_GENERATORS=off`. The formula diagnostics read the atlas via `OGV_GRAVEL_ATLAS_PATH=/var/lib/opengravel/gravel-atlas-v3.sqlite`.
- **Next:** make the atlas probes route via corridor entry/exit points the router actually reaches cheaply (measure connector cost with one router call before committing to a sequence), then rerun this benchmark. Promote to `on` only after the dirt-focused set wins.
