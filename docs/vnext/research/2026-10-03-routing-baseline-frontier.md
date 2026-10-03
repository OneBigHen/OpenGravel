# Routing baseline — production Classic and Frontier, 2026-10-03

Machine-readable: [2026-10-03-routing-baseline-frontier.json](2026-10-03-routing-baseline-frontier.json)
(schema 1; per-candidate metrics, coherence flags, ordered-evidence coverage,
and the full scorecard per case).

## How it was produced

- Corpus: the 8 PA/NJ cases in `tests/real-router/routing-quality-corpus.ts` (#39).
- Router: live GraphHopper 11.0 on this host (graph imported 2026-09-12),
  sequential, one production plan per case.
- Intent: default ride intent with Roads = **Curvy** (`motorcycle_twisty`
  primary lane), corpus case `avoidHighways` / surface options honoured,
  alternatives on (the planner's default). Road authority and Jev off.
- Planner: the real `planRide()` — same lanes, pipeline, RouteScore and roles as
  production. Every case spent **4 provider calls**.
- Scorecard: `scoreExperimentCase()` with control = **Classic** (the automatic
  production winner) and treatment = **Frontier** (the opt-in comparison pick)
  over the same candidate set, so the budget is equal by construction.

## Frontier pick per case

| Case | Calls | Choices | Frontier = Classic | Frontier pick: min | mi | score | bend share | longest bend run m | maneuvers/10 mi | backtrack | self-overlap | flags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Allentown → Stroudsburg | 4 | 2 | yes | 71.2 | 38.14 | 27.9 | 0.107 | 247 | 4.98 | 0.019 | 0.005 | alternating-short-turns |
| Hawk Mountain → Jim Thorpe | 4 | 2 | yes | 59 | 28.69 | 33.2 | 0.104 | 384 | 2.44 | 0.031 | 0.010 | geometry-reversal |
| Doylestown → New Hope | 4 | 2 | yes | 29.1 | 13.05 | 27.5 | 0.070 | 146 | 7.66 | 0 | 0.007 | none |
| Harrisburg → Lancaster | 4 | 3 | no | 50.2 | 38.89 | 12.4 | 0.019 | 109 | 3.09 | 0.001 | 0.002 | alternating-short-turns |
| Reading → Jim Thorpe | 4 | 3 | yes | 122.3 | 58.12 | 39.8 | 0.157 | 509 | 4.65 | 0.060 | 0.006 | alternating-short-turns |
| West Chester → Lancaster | 4 | 2 | yes | 81.8 | 42.03 | 27.4 | 0.077 | 270 | 5.23 | 0.020 | 0 | alternating-short-turns |
| Bethlehem → Delaware Water Gap | 4 | 2 | yes | 63.1 | 34.47 | 28 | 0.091 | 256 | 6.09 | 0.046 | 0.008 | alternating-short-turns |
| Cherry Hill → Batsto Village | 4 | 3 | yes | 72.6 | 39.3 | 22.1 | 0.031 | 130 | 4.07 | 0.030 | 0.002 | alternating-short-turns |

Score is canonical RouteScore.total (0–100). Bend share = metres in multi-vertex
bend runs / route metres. Backtrack and self-overlap are shares (0..1).

## Frontier vs Classic (scorecard aggregate)

- 8/8 trials valid, 8/8 equal budget, 0 rider-rated.
- Frontier picked the same route as Classic in **7 of 8** cases. The exception is
  Harrisburg → Lancaster: Frontier chose a 50 min route (score 12.4, bend share
  0.019) over Classic's 77 min route (score 22.0, bend share 0.047).
- Mean deltas (Frontier − Classic, all from that one case spread over 8):
  −203 s duration, −1.2 score, −0.003 bend share, −0.29 maneuvers/10 mi.
- Classic also equals the Sustained-curves pick in 5 of 8.

## What a generator has to beat

At 4 provider calls, Curvy intent, means over the 8 cases:

| Pick | Score | Bend share | Longest bend run m | Maneuvers/10 mi | Backtrack | Self-overlap |
|---|---|---|---|---|---|---|
| Classic (automatic production winner) | 28.49 | 0.0855 | 267 | 5.07 | 0.0262 | 0.0051 |
| Frontier (opt-in method) | 27.29 | 0.0820 | 256 | 4.78 | 0.0261 | 0.0051 |

Compare per case at the same call budget, not against the mean.

## Caveats (read before comparing)

- `worthwhileMinuteRatio` is **null everywhere**: ordered evidence with edge
  time is present on every route (timed share 1.0, 47–145 runs), but there is no
  canonical per-run worthwhile policy yet, so the Ride Arc stays
  `no-worthwhile-policy` rather than guessed.
- The shadow flag `alternating-short-turns` (≥2 left/right pairs ≤400 m) fires
  on 7 of 8 production winners. It is shadow-only and looks too sensitive to
  mean "pathology" on 13–58 mi rides; calibrate before using it as a gate.
- The Hawk Mountain → Jim Thorpe production winner carries a
  `geometry-reversal` flag (one ≥150° turn on simplified geometry). Worth a
  look on the map; not yet confirmed as a real rider-visible U-turn.
- Latency includes a cold start on the first case (1.35 s); later cases were
  0.29–0.66 s, Cherry Hill 1.16 s.
- One run, one day, one intent. Live routing is deterministic for a fixed graph,
  but re-run with the CLI in [routing-experiment-scorecard.md](../../routing-experiment-scorecard.md)
  after any graph or profile change.
