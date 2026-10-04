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
