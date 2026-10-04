# Dirt sweep, dirt kilometres, dirt loops, honest ETAs (2026-10-04)

Follow-up to `dirt-search-cap-2026-10-04.md`. Three changes the Codex review queued, plus two bugs found on the way.

## What changed

1. **Parallel dirt sweep.** Live, the rider search ran on 2 router calls (its budget was shared with the fun
   generators). Dirt modes now fire 7 strengths at once (`OGV_DIRT_SWEEP_CALLS`, max 10), with the router's
   alternatives at each, and pool every line. Router calls are 20-250 ms each. The router's dirt response is a
   step (Lock Haven -> Slate Run: 0% below strength 1.25, 28% from there), which bisection often skipped.
   Dirt strength may reach 5 (pavement x0.118); busy-road penalties stop at 4.
2. **Cap baseline bug.** The pipeline's candidates include a `motorcycle_fastest` line, so the "own ETA"
   baseline was still the fastest ETA. Gettysburg -> Pine Grove gravel: the 66-min 28%-dirt route sat 30 s over
   the cap. The baseline now uses only the rider's own profile.
3. **Dirt valued in km, not percentage points.** A slower route must buy 1 km of dirt value per 4 extra minutes
   (min 1.5 km). Scraps under 500 m count half; the longest unbroken stretch counts +50%.
4. **Dirt loops.** Loops skipped the rider search entirely. Among loops inside target +/- tolerance, the one
   with the most dirt value now leads if it beats the pipeline's pick by 1.5 km. No router calls.
5. **Honest ETAs (router).** Adventure limited speed to 0.82x car speed and twisty/scenic to 0.9x to express
   taste. The factor moved to priority; speed is now the real car speed. 32/32 probe routes kept identical
   roads; adventure Lock Haven -> Slate Run went 91 -> 75 min. Graph + LM re-imported on the Windows PC (3 min).

## Benchmark (live router before; rebuilt honest router after)

Production treatment, dirt km of the pick (Curvy: Franco/km):

| Trip | Mode | Before | After |
|---|---|---:|---:|
| Pine Grove Furnace loop, 2 h | gravel | 26.4 | 26.4 |
| Pine Grove Furnace loop, 2 h | dual-sport | 22.5 | 14.0 |
| State College to Rothrock loop, 2 h | gravel | 19.6 | 19.6 |
| State College to Rothrock loop, 2 h | dual-sport | 28.3 | 35.1 |
| Jim Thorpe to Hickory Run | gravel | 0.0 | 0.0 |
| Jim Thorpe to Hickory Run | dual-sport | 0.0 | 0.0 |
| Lock Haven to Slate Run | gravel | 18.2 | 18.2 |
| Lock Haven to Slate Run | dual-sport | 18.2 | 18.2 |
| Gettysburg to Pine Grove Furnace | gravel | 0.0 | 9.6 |
| Gettysburg to Pine Grove Furnace | dual-sport | 9.6 | 9.6 |
| Williamsport to Waterville (Pine Creek) | gravel | 0.0 | 0.0 |
| Williamsport to Waterville (Pine Creek) | dual-sport | 0.0 | 0.0 |
| Allentown → Stroudsburg | curvy | 63 | 44 |
| Allentown → Stroudsburg | gravel | 0.0 | 0.0 |
| Hawk Mountain → Jim Thorpe | curvy | 23 | 23 |
| Hawk Mountain → Jim Thorpe | gravel | 0.9 | 1.8 |
| Doylestown → New Hope | curvy | 37 | 37 |
| Doylestown → New Hope | gravel | 1.4 | 1.1 |
| Harrisburg → Lancaster | curvy | 35 | 51 |
| Harrisburg → Lancaster | gravel | 0.0 | 0.0 |
| Reading → Jim Thorpe | curvy | 58 | 58 |
| Reading → Jim Thorpe | gravel | 5.0 | 7.0 |
| West Chester → Lancaster | curvy | 43 | 43 |
| West Chester → Lancaster | gravel | 0.0 | 0.0 |
| Bethlehem → Delaware Water Gap | curvy | 58 | 58 |
| Bethlehem → Delaware Water Gap | gravel | 0.1 | 0.1 |
| Cherry Hill → Batsto Village | curvy | 13 | 13 |
| Cherry Hill → Batsto Village | gravel | 0.5 | 6.0 |

Set summary, production -> formula:

| Set | Plans | Dirt % | Longest dirt km | Franco /km | Busy % | Minutes | Formula value |
|---|---:|---|---|---|---|---|---|
Before:
| Dirt-focused trips | 12 | 17 -> 22 | 9.1 -> 11.8 | 52 -> 59 | 13 -> 6 | 85 -> 88 | 28.9 -> 32.6 |
| PA/NJ corpus | 16 | 1 -> 1 | 0.6 -> 0.5 | 36 -> 48 | 20 -> 13 | 70 -> 72 | 26.0 -> 27.5 |
| All | 28 | 8 -> 10 | 4.2 -> 5.3 | 43 -> 53 | 17 -> 10 | 77 -> 79 | 27.3 -> 29.7 |

After:
| Dirt-focused trips | 12 | 18 -> 22 | 9.9 -> 10.2 | 50 -> 63 | 13 -> 9 | 84 -> 85 | 30.8 -> 33.2 |
| PA/NJ corpus | 16 | 2 -> 2 | 0.9 -> 0.9 | 45 -> 53 | 19 -> 6 | 67 -> 70 | 27.8 -> 29.1 |
| All | 28 | 9 -> 10 | 4.8 -> 4.9 | 47 -> 57 | 17 -> 7 | 74 -> 76 | 29.1 -> 30.9 |

Minutes after are honest (shorter) ETAs, so they are not comparable one to one.

## Open

- Pine Grove dual-sport loop 22.5 -> 14 km; Allentown Curvy 63 -> 44 Franco/km (Harrisburg 35 -> 51 offsets).
- Curvy production regret is high (24.8 Franco/km): the oracle pool has much curvier lines the bisection never
  picks. A Curvy sweep like the dirt one is the next lever.
