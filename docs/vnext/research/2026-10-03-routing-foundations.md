# Routing lane: foundations — 2026-10-03

Branch `routing/foundations` (worktree `/root/Vibe/wt/og-rt-foundations`), based on
current main (3a4ce31). Measurement and diagnostics only. **Production route
selection is unchanged**: no RouteScore, eligibility, role or selection code was
touched; the only runtime change is that GraphHopper is also asked for its
built-in `time` path detail, plus a bounded `roadRuns` list on the provider road
summary.

## Merged

| PR | What | Notes |
| --- | --- | --- |
| #39 | Permanent PA/NJ live routing quality corpus | Clean merge. Live run: 8/8 pass. |
| #48 | Common routing experiment scorecard | Clean merge. |
| #38 | Sustained curve continuity | **Already on main** (landed via #55, which also has a more careful `analyzeBends`). Merge recorded; kept main's `bends.ts`; no content change. |
| #50 | Ordered road evidence runs + GraphHopper edge time | Merged on top of #38. Fixed a misplaced doc comment (the `ProviderRoadSummary` doc landed on the new `ProviderRoadRun`) and the main-side provider test that pins the requested details list. Live GraphHopper 11.0 returns `time`: every corpus route had 100% timed ordered runs. |
| #49 | Ride Arc analyzer | Kept as the only phase / worthwhile-minute definition. |
| #35 | Route coherence diagnostics + strategy doc | Kept the coherence detector and the strategy doc, with the changes below. |

## Ride Arc / coherence consolidation (#35 + #49)

One canonical contract: `analyzeRideCoherence()` in
`src/application/planner/ride-coherence.ts`, documented in
`docs/ride-arc-analysis.md`. It returns
`{ schemaVersion, path, orderedEvidence, arc, arcUnavailable }`:

- `path` is #35's detector (U-turns, reversals, doglegs, maneuver density,
  backtracking, self-overlap, shadow flags).
- `arc` is #49's analyzer, fed by #50's ordered `roadRuns` via
  `rideArcSegmentsFromRoadRuns()` with a **caller-supplied** worthwhile judge.
- When the arc is missing, `arcUnavailable` gives the reason:
  `no-ordered-evidence`, `no-edge-time`, `no-worthwhile-policy` or `malformed`.

Dropped or changed:

- **Dropped** #35's own Ride Arc metric formulas in
  `docs/rider-first-routing-strategy.md`: `escapeEfficiency` and an
  "*estimated* minutes in high-value core corridors" `worthwhileMinuteRatio`.
  They conflicted with #49's definition, which counts known minutes only. The
  strategy doc now links to the canonical contract.
- **Dropped** #49's "Provider data required" gap section, because #50 now
  supplies the ordered data.
- **Changed** #35's detector so that missing instructions give `null` for
  maneuvers, U-turns, doglegs and road-name changes, not `0`. Zero would claim
  "no turn workload", which we don't know.

## Scorecard entry point (for the generator and Jev lanes)

- `scoreExperimentCase({ caseId, generator, control, treatment })` and
  `measureExperimentCandidate()` live in
  `src/application/planner/routing-experiment-measure.ts`.
- `runProductionBaselineCase(entry, { baseUrl, roadCharacter })` lives in
  `tests/real-router/routing-baseline.ts`. It returns the production control arm:
  the same candidate set, with the Classic, Frontier and Sustained-curves picks
  and the counted provider calls.
- To run it from the CLI: `ROUTING_BASELINE_OUT=<json> ./node_modules/.bin/vitest run --maxWorkers=1 --config vitest.realrouter.config.mts tests/real-router/routing-baseline-live.test.ts`
- The full how-to is in `docs/routing-experiment-scorecard.md` under "How to score a candidate set".

## Baseline (live, 2026-10-03)

`2026-10-03-routing-baseline-frontier.{json,md}`. Setup: 8 corpus cases, Curvy
intent, real `planRide`, 4 provider calls per case (32 total, run one at a time).

- Frontier picked the same route as Classic in 7 of 8 cases. The exception is
  Harrisburg → Lancaster, where Frontier picked a route 27 min shorter with a
  lower score and fewer bends.
- Mean of Classic's picks: score 28.49, bend share 0.0855, longest bend run
  267 m, 5.07 maneuvers per 10 mi, backtracking 0.026, self-overlap 0.005.
- Frontier's picks: 27.29, 0.0820, 256 m, 4.78, 0.026, 0.005.
- `worthwhileMinuteRatio` is null for every route because no canonical
  worthwhile policy exists yet.

## Tests

New tests:

- `tests/unit/application/ride-coherence.test.ts` (6)
- `tests/unit/application/routing-experiment-measure.test.ts` (4)
- `tests/real-router/routing-baseline-live.test.ts` (8 live)

Updated: `route-coherence.test.ts` (unknown instructions) and
`graphhopper/provider.test.ts` (adds the `time` detail).

Gate: `ALL GATES: GREEN for 3ef753bf1ff7fdda12e90b59b7f42fc992e5b6ca (wsl)`
(lint, typecheck, vitest, build).

## Left for the integrator

1. **Canonical worthwhile policy.** Write a per-`ProviderRoadRun` judge using
   RoutePolicy and the ride intent. Until it exists, Ride Arc and
   `worthwhileMinuteRatio` stay null. This is the next foundation item, and it
   needs a review of the policy semantics.
2. **`alternating-short-turns` shadow flag.** It fires on 7 of 8 production
   winners, so it is too sensitive to mean a real problem. Calibrate it before
   any gate uses it.
3. **Hawk Mountain → Jim Thorpe.** The production winner has a
   `geometry-reversal` flag. Check it on a map.
4. **Payload size.** `roadRuns` (up to 512 runs per candidate) travels on
   `ProviderCandidate.roadSummary`. It does not reach the plan wire DTO (that
   maps fields explicitly), but watch any future code that serializes provider
   candidates.
5. **Stale PRs.** Once this branch lands, close #39, #48, #38, #50, #49 and #35
   as superseded by it.
