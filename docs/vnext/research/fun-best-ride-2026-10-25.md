# Balanced Best Ride: live diagnosis and repair (2026-10-25)

| Default Balanced ride | Before: min / curvy mi / Franco per km | After: min / curvy mi / Franco per km |
| --- | --- | --- |
| Jim Thorpe → Hawk Mountain | 53.04 / 2.95 / 23.25 | 51.86 / 3.22 / 37.34 |
| Jim Thorpe, 120-minute loop | 122.16 / 7.71 / 49.57 | 114.60 / 9.48 / 80.42 |

Destination: **9% more bend miles, 61% higher tight-curve density, 1.18 minutes faster**.
Loop: **23% more bend miles, 62% higher density, 7.55 minutes faster**. Destination Fastest
remains 47.76 minutes / 28.50 miles / 1.66 bend miles; Balanced adds 8.6% time to it.

These are actual GraphHopper geometries and ETAs, before at `223aff39` (the requested
`origin/feat/routing-flow-clear` base), after with this change. The destination reproduces the
reported 53 min / 33 mi / “Curvy · 3 mi” exactly. Loop seeds depend on request ID: the original
106-minute report's ID was unavailable. Both measurements above use the same fixed ID and
settings; they are a reproducible two-hour loop comparison, not a claim to replay that unknown seed.

## Why

1. **Loop generation was being discarded.** Four lanes return three seeds each: 12 paths.
   The six-candidate cap retained only Fastest and Scenic, dropping *every* Twisty and Adventure
   line. The discarded Twisty pool included 112.17 min / 6.39 bend mi / 93.22 Franco/km;
   Adventure included 117.14 min / 6.68 mi / 102.16. Retaining those also changes the production
   spine available to the existing atlas probes. Their resulting 114.60-minute loop has 9.48
   bend miles and fits the 105–135 minute window. This is the largest measured improvement.
2. **Destination selection overrode a better score.** The initial Twisty line is 51.86 min /
   3.22 bend mi / 37.34 Franco/km, score **31.4**. Scenic is 53.04 / 2.95 / 23.25, score
   **30.3**. Balanced's rider search ignored curves and chose the smallest busy-road share:
   Scenic's **0%** versus Twisty's **0.0348%** (about 18 m). That nominal difference overruled
   the higher-scoring, faster and curvier line. Reweighting time would not fix this override.
3. **A generation ceiling remains for the destination.** An exploratory sweep across Fastest,
   Scenic and Twisty alternatives at busy strengths 1/2/4 found a 5.55-bend-mile, 81.45-Franco/km
   line, but at **62.70 minutes**, **31.3%** over Fastest. It is outside Balanced's 25% cap.
   Additional straight-edge penalties and geographic/partial-detour probes did not establish
   a large in-budget bend-mile gain. These exploratory treatments were not promoted.
4. **The measurement is deliberately strict.** Card bend miles count radii below 300 m with
   junction-corner and isolated-kink filtering. Franco additionally measures weighted tight
   curves below 175 m and filters noise. Neither measures the entire length of a pleasant ridge
   road. No thresholds or displayed miles changed. The coarse graph curvature encoding and
   binary non-arterial share still limit generation; the existing graph-schema-v2 work remains
   the durable fix for that ceiling.

## Change and bounds

- Retain up to **12** lane candidates, enough for every seed of all four character lanes;
  diversity still limits rider-visible choices.
- Balanced evaluates the eligible pool plus at most **two** Twisty alternative calls, bounded
  by the configured provider-call budget and deadline, with a **16-candidate** search ceiling.
  Equivalent strengths are skipped without busy avoidance. Loops can try another deterministic
  seed family; a second call is skipped if only one call's results fit the pool.
- A curve upgrade must gain **400 bend metres and 5 Franco/km**, with a time cost in its utility.
  A substantial busy-road improvement (10 percentage points) can still win while retaining curves;
  an 18 m difference cannot erase them. Busy exposure may grow by at most 10 points and residential/
  service exposure by at most 3 points. Missing exposure evidence cannot stand in for low exposure.
- New destination recommendations fit **1.25× the fastest eligible ETA**; loops use their timebox.
  The explicit cap also survives diversity/dedupe and gates canonical Best Ride assignment if
  optional formula values are absent.
  Authored stops, shaping, spans and sketches bypass the new search. Dirt targets and dual-sport
  modes keep their existing search. `OGV_RIDER_MODES=off` disables the new behavior.
- Every new path goes through canonical eligibility, bike/access restrictions and road-authority
  verification before adoption. Router/private-road zeroes and existing busy/residential penalties
  are unchanged. ETAs come directly from the router; Jev has no new selection role.

## Reproduce and limits

Local router: `http://127.0.0.1:8989`; origin `(-75.7387, 40.8636)`, destination
`(-75.9832, 40.6364)`. Request IDs: `fun-best-destination`, `fun-best-loop-120`.
Defaults: touring bike, maintained gravel allowed, rough tracks avoided, Mixed surface,
protect ride, toll avoidance, highways allowed; loop 120 ± 15 minutes. The improved Mixed loop
contains **24.0% unpaved road** per the router: it is not a paved-only demonstration.

Run the identical measurement test on the base and this branch:

```sh
OGV_FUN_BEST_RIDE_LIVE=1 OGV_FUN_BEST_RIDE_EVIDENCE=/tmp/fun-best.json \
  npm run test:real-router -- tests/real-router/fun-best-ride-live.test.ts
```

The test also measures Fast and Curvy. Destination results for those styles are unchanged at
51.86 min / 3.22 bend mi; their Fastest role stays 47.76 min. Fast's pre-existing Best Ride can
trade a few minutes for score, so “Fast unchanged” does not claim Best Ride equals its Fastest
role. With the retained loop pool, Fast improves from 122.16 to 110.79 min (9.42 bend mi), and
Curvy improves density from 49.57 to **102.16 Franco/km** (117.14 min / 6.68 bend mi), above
Balanced's 80.42. The Curvy search algorithm and Efficient search conditions were not changed.

The harness uses environment defaults and disables optional live road-authority and Jev calls;
these results prove router generation/selection, not current closure clearance or on-road quality.
Focused tests cover generated-route adoption and private/no-access rejection, time/exposure/budget
bounds, cancellation, loop seed retention, canonical/formula cap fallback, and existing Curvy/dirt
behavior. Checks: TypeScript, ESLint on changed files, focused Vitest and the opt-in live test.
No Next build, Playwright, graph rebuild or deployment was performed.

The destination's absolute bend-mile gain remains modest. This patch does **not** establish that
default routing is mostly twisty everywhere or eliminate the graph's missing curve-aware generation.
