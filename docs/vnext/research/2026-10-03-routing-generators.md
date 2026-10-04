# Routing lane: candidate generators (2026-10-03)

Branch `routing/generators` (worktree `wt/og-rt-generators`), based on current `main`.
Gates: `ALL GATES: GREEN for 11273c4 (wsl)` (lint, typecheck, vitest, build).
Live evidence: `2026-10-03-routing-generators-evidence.json` (same folder).

## What was consolidated

| PR | What it was | Where it lives now |
|---|---|---|
| #33 | library corridor probes (parent primitive) | `library-corridor-probes.ts`, unchanged; used by the `corridor-probe` strategy |
| #36 | equal-budget "replace the balanced lane" runner | **removed** (`library-corridor-treatment.ts`); its protocol is now the live harness `tests/real-router/fun-generators-live.test.ts` |
| #41 | departure-and-rejoin | `departure-rejoin.ts` + `departure-rejoin` strategy; fix: never sends coincident anchors |
| #44 | missing-link discovery | `missing-link.ts` + `missing-link` strategy; **left out of the production family** (see below) |
| #42 | corridor-prize loop beam | `corridor-prize-loop.ts` + `prize-loop` strategy; fix: the connector-waste cap judges finished loops only, so a first leg out to the good roads can still close into an efficient two-corridor loop |
| #53 | adaptive (marginal-regret) probe allocation | `frontier-probe-allocation.ts`, used as the family's `adaptive` allocation option (default stays `fixed`) |

All six PR branches were merged in (no conflicts; all purely additive), then built on.

## The design

- `src/application/planner/fun-generators.ts`: the contract and the runner.
  - A `FunCandidateGenerator` only *proposes* probes (pure, no calls). Each probe states how many provider calls it may spend, its source corridors, and an allocation-only forecast.
  - `runFunGenerators` owns everything shared: a hard provider-call budget (counted per HTTP request, reserved up front, so a two-call probe never starts with one call left), one wall-clock deadline, fixed round-robin or adaptive (#53) allocation, the caller's **canonical eligibility gate** for every answer, dedup against production and earlier generated routes (the diversity policy's 0.85 overlap), and provenance (generator, probe, source ids, corridor adherence) on every pooled route.
  - `FunPoolJudge` is the seam for the Jev judge lane: it orders an already-eligible pool and can never make a route eligible.
- `fun-generator-strategies.ts`: `corridor-probe`, `departure-rejoin`, `missing-link`, `prize-loop`, plus `funRouteMeasurement` (bend share, curvature unit, backroad share, longest bend run, read from engine evidence; unknown stays null).
- `fun-generator-sources.ts`: corridor sources are ~12 km windows of the curated route library (scaled down for short trips), kept only when they fit the trip's detour or the loop's reach. Priority is the window's own measured bend share.
- `src/server/planning/fun-generators.ts` and `plan-service.ts`: `OGV_FUN_GENERATORS=off|shadow|on` (default **off**), with `_CALLS` (default 2, max 8), `_DEADLINE_MS` (default 12000) and `_ALLOCATION` (`fixed`/`adaptive`).
  - `shadow` runs detached *after* the plan answered. It writes one `[ogv-fun-generators]` log line (counts and measurements, never geometry) and cannot change the bundle. A unit test proves the bundle is identical.
  - `on` merges eligible generated routes into the canonical ranking. This is research only.
  - Generated routes pass the same gate as lane routes: road-authority closures and access for their own corridor, avoid areas, road spans, and every hard eligibility rule.

## Live measurement (production GraphHopper, sequential; 53 calls in the recorded run, about 200 across four iterations)

**Protocol (generalizes #36):** the control is the real production plan, which made 3 calls in every case (fastest, scenic, twisty). Each treatment replays the control's own lane answers except the generic `balanced` lane, and gives that one freed call to the generator, so both sides spend the same number of calls. A strategy that proposes nothing hands the call back to the balanced lane, which leaves the treatment identical to the control. `@3-extra` rows spend 3 *additional* calls; they are informational, not equal-budget claims.

| Case | Control Best Ride | corridor-probe (equal budget) | departure-rejoin (equal budget) | Other |
|---|---|---|---|---|
| Jim Thorpe → Hawk Mtn | 62 min, bends 9.4%, backroad 99.6% | **new, becomes Best Ride**: 76 min, bends 13.2%, backroad 99.6%, adherence 100% | new, Best Ride: 80 min, 13.1% | adaptive picked departure-rejoin (+4 min, same bends) |
| Doylestown → Frenchtown | 33 min, bends 3.7%, backroad 95.8% | **new, Best Ride**: 55 min, bends 10.6%, backroad 97.1%, adherence only 48% | new, Best Ride: 61 min, 10.6% | missing-link @3-extra: 62 min, 11.0% |
| Water Gap → Stroudsburg | 10 min, 10.3% | no library corridor fits a 6 km trip, so the call goes back to balanced | same | — |
| King of Prussia → Phoenixville | 19 min, 11.6% | duplicate of a production route | duplicate | @3-extra: only duplicates |
| Hatboro loop 90 min | 96 min, 8.3% | n/a (loop) | n/a | prize-loop: no proposal; the nearest library corridors are ~17 km out |
| Green Lane loop 120 min | 119 min, 12.6%, backroad 96.5% | n/a | n/a | prize-loop: new loop with bends **16.9%**, but 87 min (outside the 105–135 window), so it was correctly not shown |

**Latency:** the generator phase took 27–350 ms for one call and 60–530 ms for three. Control plans took 0.1–4.5 s (loops are the slow ones). In shadow mode, none of this is on the rider's path.

**Safety:** 1 of 34 generated answers failed canonical eligibility (`duplicate-consecutive-points`, a departure-rejoin route). It was rejected as designed. The exact cause did not reproduce; the one provable cause (coincident anchors) is now guarded.

**A lesson the run itself taught:** before the fall-back rule, blindly giving up the balanced lane made two rides worse when the generator had nothing to offer. Water Gap went from 10.3% to 9.2% bends, and Hatboro from a 96-minute loop with 8.3% bends to 90 minutes with 7.3%. A production swap must decide *after* proposals are known, which is free because proposing makes no calls.

## Verdicts: kept, dropped and why

- **corridor-probe: keep, lead strategy.** At equal budget it found a new eligible route on 2 of 4 point-to-point trips. Both times the canonical scorer made it the Best Ride. Bend share rose 1.4× and 2.9×, for +14 and +22 minutes. It never made anything worse.
- **departure-rejoin: keep, second.** It found the same rides as corridor-probe with equal bends but 4–6 minutes slower. Its value is that it keeps most of the good route, which matters once Ride Arc or coherence can judge that. In this sample it added no unique candidate.
- **missing-link: dropped from the production family; the code is kept for corpus work.** It needs 2 calls before it can show anything, so at the equal budget it never ran. With 3 extra calls it found 1 route in 6 cases, barely curvier (11.0% vs 10.6%) and 7 minutes slower than a one-call corridor probe on the same trip.
- **prize-loop: keep in shadow only.** It produced the curviest route of the whole study (16.9% bends), but it is not yet usable. Library windows are too few and too short to fill a 2-hour box, and suburban origins (Hatboro) have no reachable corridors. The fix is longer or adjacent windows and the time-box calibration (the speed proxy now follows the Best Ride's measured speed).
- **Adaptive allocation (#53): kept as an opt-in, not the default.** In the only case where it chose differently from fixed round-robin, it picked a route with equal bends that was 4 minutes slower. There is no evidence yet that it earns its complexity at a 1–2 call budget.

## Dependencies on sibling lanes (not duplicated here)

- **jev:** implement `FunPoolJudge` over `FunGeneratorReport.pool`. The pool already contains only eligible, deduplicated routes with provenance.
- **foundations:** the #39 corpus should replace the six `CASES` in the live harness. The #48 scorecard should consume `FunGeneratorReport` and `funRouteMeasurement`. When #38 continuity and Ride Arc land, `funRouteMeasurement` should read sustained continuity, and missing-link connectors should be gated on Ride Arc coherence instead of the current stretch ≤ 2.0 and backroad ≥ 50% rule.

## Left for the integrator

1. Turning on `OGV_FUN_GENERATORS=shadow` in production costs at most 2 detached GraphHopper calls per plan. Only the owner decides that and the deploy.
2. A true production equal-budget swap is not implemented. It would run baseline and curvy, then propose, then spend the third call on balanced *or* the generator, which adds one serial round of latency. `on` currently spends extra calls.
3. Rider-blinded or Jev preference is still required. "Became Best Ride" here means the deterministic scorer preferred it, not that riders do. Doylestown's corridor was ridden only 48% (`low-adherence` in the report).
4. The build PC's WSL disk is full (63 GB, 98%) of old `~/ogv-verify/*` staging dirs. I removed only my own.
