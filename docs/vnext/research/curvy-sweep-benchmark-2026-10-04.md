# Ride Formula benchmark (live GraphHopper, PA/NJ)

Run: 2026-10-04T14:02:37.082Z. Router: http://127.0.0.1:8989 (profiles_lm landmarks, PA+NJ). Strictly sequential.

Three plans per trip and mode: **fastest** (plain fastest profile, the Google-like baseline), **production** (today's Best Ride: rider modes and knee search; Gravel Atlas probes and Ride Formula off), **formula** (Gravel Atlas probes on, `OGV_RIDE_FORMULA=on`, request-time penalty rules on).
Dirt % is distance-weighted unpaved surface (gravel, fine_gravel, compacted, dirt, ground, unpaved; sand excluded and never routed). Franco bend % and Franco /km are the roadcurvature.com style measure (franco-v1) of the returned line. Busy % is primary/trunk/motorway, links and CITY density. Formula is ride-formula-v1 (0-100) for the trip's mode, the same scorer for every row. Loops have no fastest baseline (`vs fastest` is n/a).

## Summary (production -> formula, means)

| Set | Plans | Dirt % | Longest dirt km | Franco /km | Busy % | Minutes | Formula value |
|---|---:|---|---|---|---|---|---|
| Dirt-focused trips | 0 | n/a -> n/a | n/a -> n/a | n/a -> n/a | n/a -> n/a | n/a -> n/a | n/a -> n/a |
| PA/NJ corpus | 16 | 2 -> 2 | 1.0 -> 1.1 | 58 -> 51 | 19 -> 7 | 69 -> 72 | 27.5 -> 29.4 |
| All | 16 | 2 -> 2 | 1.0 -> 1.1 | 58 -> 51 | 19 -> 7 | 69 -> 72 | 27.5 -> 29.4 |

Verdicts over 16 plans: 4 win, 7 loss, 5 tie or same route. A win means the formula route has at least +3 pp dirt (dirt modes) or +10% Franco curvature per km (Curvy), with busy-road share not worse by more than 10 pp.

## Generator oracle and selection regret

Oracle = the best in-budget route anywhere in either treatment's candidate pool (dirt modes: most dirt km; Curvy: highest Franco /km). Budget: A-to-B within 1.75x fastest (dirt) or 1.35x (Curvy); loops within 15 min of the target. Regret = oracle minus the pick. A low oracle means generation is the problem; a high oracle with high regret means selection is.

| Trip | Mode | Pool | Unit | Oracle | Oracle min | Production | Formula | Prod regret | Formula regret |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| Allentown → Stroudsburg | curvy | 19 | Franco/km | 114 | 84 | 114 | 39 | 0 | 76 |
| Allentown → Stroudsburg | gravel | 22 | dirt km | 5.3 | 94 | 0.0 | 1.4 | 5.3 | 3.9 |
| Hawk Mountain → Jim Thorpe | curvy | 8 | Franco/km | 52 | 68 | 29 | 23 | 23 | 29 |
| Hawk Mountain → Jim Thorpe | gravel | 16 | dirt km | 5.9 | 72 | 1.8 | 0.2 | 4.1 | 5.7 |
| Doylestown → New Hope | curvy | 15 | Franco/km | 105 | 28 | 61 | 105 | 44 | 0 |
| Doylestown → New Hope | gravel | 20 | dirt km | 1.4 | 31 | 1.1 | 1.1 | 0.4 | 0.4 |
| Harrisburg → Lancaster | curvy | 5 | Franco/km | 91 | 87 | 91 | 51 | 0 | 40 |
| Harrisburg → Lancaster | gravel | 29 | dirt km | 0.2 | 87 | 0.0 | 0.0 | 0.2 | 0.2 |
| Reading → Jim Thorpe | curvy | 29 | Franco/km | 78 | 117 | 76 | 41 | 2 | 38 |
| Reading → Jim Thorpe | gravel | 42 | dirt km | 17.6 | 157 | 7.0 | 15.5 | 10.6 | 2.2 |
| West Chester → Lancaster | curvy | 28 | Franco/km | 59 | 85 | 53 | 32 | 6 | 27 |
| West Chester → Lancaster | gravel | 35 | dirt km | 3.5 | 93 | 0.0 | 2.8 | 3.5 | 0.7 |
| Bethlehem → Delaware Water Gap | curvy | 25 | Franco/km | 89 | 71 | 88 | 58 | 1 | 30 |
| Bethlehem → Delaware Water Gap | gravel | 29 | dirt km | 7.0 | 77 | 0.1 | 0.1 | 7.0 | 7.0 |
| Cherry Hill → Batsto Village | curvy | 20 | Franco/km | 35 | 61 | 15 | 33 | 20 | 2 |
| Cherry Hill → Batsto Village | gravel | 26 | dirt km | 6.5 | 88 | 6.0 | 6.5 | 0.5 | 0.0 |

Mean regret: dirt modes production 3.9 km, formula 2.5 km; Curvy production 11.9 Franco/km, formula 30.2 Franco/km.

## Dirt-focused trips

| Trip | Mode | Route | Min | vs fastest | vs prod | Dirt % | Longest dirt km | Franco bend % | Franco /km | Busy % | Formula | Verdict |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|

## PA/NJ corpus

| Trip | Mode | Route | Min | vs fastest | vs prod | Dirt % | Longest dirt km | Franco bend % | Franco /km | Busy % | Formula | Verdict |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Allentown → Stroudsburg | curvy | fastest | 58 | - |  | 0 | 0.0 | 2 | 38 | 70 | 30.6 |  |
| Allentown → Stroudsburg | curvy | production | 84 | 45% |  | 0 | 0.0 | 8 | 114 | 3 | 31.7 |  |
| Allentown → Stroudsburg | curvy | formula | 65 | 12% | -19 min | 0 | 0.0 | 3 | 39 | 24 | 33.7 | LOSS (-66% curvature) |
| Allentown → Stroudsburg | gravel | fastest | 58 | - |  | 0 | 0.0 | 2 | 38 | 70 | 18.5 |  |
| Allentown → Stroudsburg | gravel | production | 58 | 0% |  | 0 | 0.0 | 2 | 38 | 70 | 18.5 |  |
| Allentown → Stroudsburg | gravel | formula | 75 | 29% | 17 min | 2 | 1.4 | 4 | 63 | 18 | 23.1 | tie |
| Hawk Mountain → Jim Thorpe | curvy | fastest | 59 | - |  | 2 | 0.9 | 1 | 19 | 0 | 31.4 |  |
| Hawk Mountain → Jim Thorpe | curvy | production | 59 | 0% |  | 2 | 0.9 | 2 | 29 | 0 | 35.3 |  |
| Hawk Mountain → Jim Thorpe | curvy | formula | 53 | -10% | -6 min | 0 | 0.0 | 2 | 23 | 0 | 35.5 | LOSS (-22% curvature) |
| Hawk Mountain → Jim Thorpe | gravel | fastest | 59 | - |  | 2 | 0.9 | 1 | 19 | 0 | 21.9 |  |
| Hawk Mountain → Jim Thorpe | gravel | production | 61 | 4% |  | 4 | 0.9 | 3 | 54 | 0 | 25.4 |  |
| Hawk Mountain → Jim Thorpe | gravel | formula | 53 | -9% | -8 min | 0 | 0.2 | 2 | 33 | 0 | 22.6 | LOSS (-3 pp dirt) |
| Doylestown → New Hope | curvy | fastest | 29 | - |  | 0 | 0.0 | 2 | 38 | 9 | 28.7 |  |
| Doylestown → New Hope | curvy | production | 26 | -11% |  | 0 | 0.0 | 4 | 61 | 1 | 31.7 |  |
| Doylestown → New Hope | curvy | formula | 28 | -3% | 2 min | 0 | 0.0 | 7 | 105 | 1 | 36.2 | WIN (+73% curvature, +2 min) |
| Doylestown → New Hope | gravel | fastest | 29 | - |  | 0 | 0.0 | 2 | 38 | 9 | 17.6 |  |
| Doylestown → New Hope | gravel | production | 30 | 4% |  | 5 | 1.1 | 8 | 116 | 1 | 25.4 |  |
| Doylestown → New Hope | gravel | formula | 31 | 5% | 0 min | 5 | 1.1 | 7 | 110 | 1 | 25.4 | tie |
| Harrisburg → Lancaster | curvy | fastest | 50 | - |  | 0 | 0.0 | 1 | 20 | 90 | 24.2 |  |
| Harrisburg → Lancaster | curvy | production | 87 | 73% |  | 0 | 0.0 | 6 | 91 | 2 | 30.7 |  |
| Harrisburg → Lancaster | curvy | formula | 74 | 48% | -13 min | 0 | 0.0 | 3 | 51 | 7 | 30.5 | LOSS (-44% curvature) |
| Harrisburg → Lancaster | gravel | fastest | 50 | - |  | 0 | 0.0 | 1 | 20 | 90 | 14.8 |  |
| Harrisburg → Lancaster | gravel | production | 50 | 0% |  | 0 | 0.0 | 1 | 20 | 90 | 14.8 |  |
| Harrisburg → Lancaster | gravel | formula | 76 | 52% | 26 min | 0 | 0.0 | 4 | 61 | 5 | 19.1 | tie |
| Reading → Jim Thorpe | curvy | fastest | 107 | - |  | 1 | 1.0 | 3 | 41 | 18 | 35.4 |  |
| Reading → Jim Thorpe | curvy | production | 116 | 8% |  | 1 | 1.0 | 5 | 76 | 2 | 34.6 |  |
| Reading → Jim Thorpe | curvy | formula | 107 | 0% | -9 min | 1 | 1.0 | 3 | 41 | 18 | 35.4 | LOSS (-47% curvature) |
| Reading → Jim Thorpe | gravel | fastest | 107 | - |  | 1 | 1.0 | 3 | 41 | 18 | 23.9 |  |
| Reading → Jim Thorpe | gravel | production | 114 | 6% |  | 7 | 6.2 | 4 | 59 | 8 | 31.7 |  |
| Reading → Jim Thorpe | gravel | formula | 132 | 23% | 19 min | 16 | 6.2 | 3 | 43 | 2 | 32.8 | WIN (+8 pp dirt, +19 min) |
| West Chester → Lancaster | curvy | fastest | 66 | - |  | 0 | 0.0 | 1 | 21 | 48 | 26.4 |  |
| West Chester → Lancaster | curvy | production | 78 | 18% |  | 0 | 0.0 | 4 | 53 | 3 | 33.2 |  |
| West Chester → Lancaster | curvy | formula | 73 | 11% | -5 min | 0 | 0.0 | 2 | 32 | 3 | 35.2 | LOSS (-40% curvature) |
| West Chester → Lancaster | gravel | fastest | 66 | - |  | 0 | 0.0 | 1 | 21 | 48 | 16.5 |  |
| West Chester → Lancaster | gravel | production | 66 | 0% |  | 0 | 0.0 | 1 | 21 | 48 | 16.5 |  |
| West Chester → Lancaster | gravel | formula | 80 | 22% | 14 min | 4 | 2.8 | 2 | 24 | 4 | 24.1 | WIN (+4 pp dirt, +14 min) |
| Bethlehem → Delaware Water Gap | curvy | fastest | 55 | - |  | 0 | 0.1 | 3 | 48 | 63 | 30.4 |  |
| Bethlehem → Delaware Water Gap | curvy | production | 72 | 31% |  | 0 | 0.1 | 6 | 88 | 2 | 32.9 |  |
| Bethlehem → Delaware Water Gap | curvy | formula | 69 | 24% | -4 min | 0 | 0.1 | 4 | 58 | 3 | 33.3 | LOSS (-33% curvature) |
| Bethlehem → Delaware Water Gap | gravel | fastest | 55 | - |  | 0 | 0.1 | 3 | 48 | 63 | 18.7 |  |
| Bethlehem → Delaware Water Gap | gravel | production | 55 | 0% |  | 0 | 0.1 | 3 | 48 | 63 | 18.7 |  |
| Bethlehem → Delaware Water Gap | gravel | formula | 60 | 9% | 5 min | 0 | 0.1 | 4 | 59 | 19 | 20.3 | tie |
| Cherry Hill → Batsto Village | curvy | fastest | 79 | - |  | 0 | 0.0 | 2 | 29 | 30 | 27.9 |  |
| Cherry Hill → Batsto Village | curvy | production | 66 | -17% |  | 0 | 0.0 | 1 | 15 | 4 | 27.9 |  |
| Cherry Hill → Batsto Village | curvy | formula | 88 | 11% | 22 min | 0 | 0.0 | 2 | 33 | 0 | 31.7 | WIN (+122% curvature, +22 min) |
| Cherry Hill → Batsto Village | gravel | fastest | 79 | - |  | 0 | 0.0 | 2 | 29 | 30 | 17.0 |  |
| Cherry Hill → Batsto Village | gravel | production | 80 | 1% |  | 10 | 5.4 | 3 | 41 | 5 | 30.7 |  |
| Cherry Hill → Batsto Village | gravel | formula | 88 | 11% | 8 min | 10 | 5.4 | 3 | 48 | 2 | 31.9 | tie |

## Cost

| Trip | Mode | Production calls | Production s | Formula calls | Formula s | Notes |
|---|---|---:|---:|---:|---:|---|
| Allentown → Stroudsburg | curvy | 9 | 8.7 | 12 | 11.7 | pool 84/72/64;  | pool 65/75/58; atlas 197 corridors, 2 calls, probes: no-route:time-cap / no-route:time-cap |
| Allentown → Stroudsburg | gravel | 11 | 8.6 | 14 | 12.7 | pool 83/67/58;  | pool 75/75/54; atlas 58 corridors, 2 calls, probes: new:ok 75min dirt10% |
| Hawk Mountain → Jim Thorpe | curvy | 9 | 0.7 | 12 | 3.2 | pool 59/53;  | pool 53/68/59; atlas 136 corridors, 2 calls, probes: no-route:time-cap / no-route:time-cap |
| Hawk Mountain → Jim Thorpe | gravel | 11 | 1.1 | 15 | 3.3 | pool 61/53;  | pool 53/61; atlas 44 corridors, 3 calls, probes: no-route:time-cap / no-route:time-cap |
| Doylestown → New Hope | curvy | 9 | 1.4 | 11 | 2.1 | pool 29/26/26;  | pool 28/26/29; atlas 17 corridors, 1 calls, probes: ineligible:ok |
| Doylestown → New Hope | gravel | 11 | 1.2 | 13 | 1.5 | pool 30/26/27;  | pool 31/26/29; atlas 9 corridors, 1 calls, probes: duplicate:ok 27min |
| Harrisburg → Lancaster | curvy | 9 | 4.1 | 12 | 8.3 | pool 87/55/68;  | pool 74/50/90; atlas 175 corridors, 2 calls, probes: no-route:low-adherence / skipped-budget:budget |
| Harrisburg → Lancaster | gravel | 11 | 5.9 | 13 | 6.8 | pool 76/50/77;  | pool 76/49; atlas 29 corridors, 1 calls, probes: no-route:low-adherence |
| Reading → Jim Thorpe | curvy | 9 | 2.0 | 12 | 7.2 | pool 116/107/109;  | pool 107/117/111; atlas 393 corridors, 2 calls, probes: no-route:time-cap / no-route:time-cap |
| Reading → Jim Thorpe | gravel | 11 | 5.3 | 14 | 8.6 | pool 119/114/116;  | pool 132/146/112; atlas 118 corridors, 2 calls, probes: new:ok 132min dirt37% / new:ok 146min dirt29% |
| West Chester → Lancaster | curvy | 9 | 1.9 | 12 | 5.4 | pool 78;  | pool 73/66; atlas 180 corridors, 2 calls, probes: no-route:time-cap / no-route:time-cap |
| West Chester → Lancaster | gravel | 11 | 4.7 | 14 | 7.9 | pool 74/66;  | pool 80/73/66; atlas 49 corridors, 2 calls, probes: duplicate:ok 77min / new:ok 80min dirt7% |
| Bethlehem → Delaware Water Gap | curvy | 9 | 1.5 | 12 | 4.0 | pool 72/60/60;  | pool 69/79/55; atlas 169 corridors, 2 calls, probes: no-route:time-cap / skipped-budget:budget |
| Bethlehem → Delaware Water Gap | gravel | 11 | 2.4 | 14 | 4.4 | pool 69/61/55;  | pool 60/69/55; atlas 45 corridors, 2 calls, probes: no-route:time-cap / skipped-budget:budget |
| Cherry Hill → Batsto Village | curvy | 9 | 2.4 | 11 | 3.5 | pool 66/80/61;  | pool 88/79/66; atlas 27 corridors, 1 calls, probes: new:ok 88min dirt0% |
| Cherry Hill → Batsto Village | gravel | 11 | 3.2 | 12 | 4.4 | pool 80/81/69;  | pool 88/79/69; atlas 68 corridors, 0 calls, probes: none |
