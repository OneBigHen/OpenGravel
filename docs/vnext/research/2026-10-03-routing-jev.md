# Routing lane: Jev (2026-10-03)

Branch `routing/jev` (worktree `/root/Vibe/wt/og-rt-jev`), based on `main`.

Owner goal: "use Jev to find fun routes and create new algos". Before this lane, Jev
only named the character of a route that was already chosen. Now it is a reusable
FUN JUDGE that any candidate generator can ask "which of these eligible routes is the
better ride?". It sits behind a flag that is off by default and stays off in
production.

## What was consolidated

- **PR #51** (shadow Jev frontier judge adapter, held-out replay/evaluation harness,
  corpus freezing, CLI) and **PR #54** (provider pins `jev-1.13.0` /
  `typesafe/jev-1.13`, complete six-order audit for three candidates; stacked on #51)
  merged as one branch onto current main (merge commit `e5e9611`).
- Conflicts resolved:
  - `ports/jev-model-identity.ts`: main's `isFrozenJevModelIdentity` stays strict
    (direct `jev-1.13.0` only), because the rider-facing wire contracts
    (`route-plan-contract`, `routing-method-comparison`) validate with it. #54's
    provider-tolerant check is now `isFrozenJevProviderIdentity`, used only by
    frontier transport/validation.
  - `package.json`: main's audit scripts are kept, and `experiment:jev-frontier` is added (deps `tsx`,
    `server-only` from #51).
  - `jev-fun-character.ts`: #54's version, which reads the pin from `jev-models.ts`.
- **Dropped**: #51's 3-line hook in `tests/real-router/routing-quality-live.test.ts`.
  Both #39 corpus files are now byte-identical to PR #39's head, so the foundations
  lane's corpus merge applies cleanly. No other #51/#54 content was dropped.
- **Fixed on the consolidated tree**: `npm run audit:env` (added on main after #51) was
  failing on the undocumented `OGV_JEV_FRONTIER_SHADOW` / `OGV_JEV_FRONTIER_PROVIDER`.
  Both are now documented in `.env.example`, along with the new `OGV_JEV_FUN_JUDGE`.

Shadow guarantees from #51/#54 still hold. The frontier adapter has no production
importer, and the architecture test enforces this.

## FUN JUDGE (new)

| Layer | File | Role |
| --- | --- | --- |
| Port (provider-neutral) | `src/application/planner/ports/fun-judge.ts` | `FunJudgePort.rank(request)` takes 2–3 already-eligible candidates as rounded aggregate evidence: duration, distance, added time %, curvature, curvature continuity, backroad, surface fit, elevation, traffic/junction flow, novelty, mapped gravel, maneuvers/10 mi, Ride Arc summary and coverage. It returns a probability per candidate plus NONE. It never receives geometry, ids, scores or the deterministic winner. `projectFunJudgeEvidence` is the single projection, and the cache fingerprint uses the same one. |
| Service | `src/application/planner/fun-judge.ts` | `createFunJudge(port).judge(request, fallbackRanking, signal)`. It asks twice, in forward and reversed order, and both answers must agree. Floors: confidence ≥ 0.6, margin ≥ 0.2, NONE ≤ 0.35. 1.2 s deadline, then the deterministic fallback. Process-wide limit of 40 calls/minute. LRU cache of 500 keyed by evidence fingerprint, so the opaque key and presentation order don't matter. A late answer still fills the cache; failures are never cached. Every outcome has a machine reason: `preferred`, `no-preference`, `low-confidence`, `order-disagreement`, `unavailable`, `timeout`, `budget-exhausted`, `invalid-request`, `indistinguishable`. |
| Promotion | `src/application/planner/fun-judge-selection.ts` | `OGV_JEV_FUN_JUDGE=off\|shadow\|on`; unknown values are `off`. The shortlist is the deterministic Best Ride plus kept candidates that are (a) inside Best Ride's detour envelope (35%), (b) inside the discovery timebox when there is one, and (c) carrying no warning/blocking code that the deterministic winner lacks. In `on` mode, a `preferred` verdict re-runs canonical `assignRoles` with Best Ride pinned to Jev's pick, so material roles stay consistent. Every other outcome keeps the deterministic roles. Candidates (eligibility, evidence, score, warnings, geometry) are never touched. |
| Adapter | `src/infrastructure/routing/jev-fun-judge.ts` | Direct TypeSafe with `JEV_API_KEY`, fixed URL, pinned `jev-1.13.0`, 0 retries, 1.5 s per-call deadline, SDK logs off. Strict decode: exact slot/NONE keys, unit PMF summing to 1 ± 0.02, pinned model. An HTTP error keeps only its numeric status. |
| Wiring | `src/server/planning/plan-service.ts` | Process-wide judge singleton. `diagnostics.funJudge` reports: mode, outcome, `applied`, deterministic/Jev/selected route ids, excluded routes with reasons, confidence, margin, order agreement, model, calls, cached, latency, `why` (measured evidence deltas, Jev pick minus deterministic winner) and `addedTimePct`. Any throw keeps the deterministic plan. |

Tests added: `tests/unit/application/fun-judge.test.ts` (12),
`tests/unit/infrastructure/jev-fun-judge.test.ts` (11),
`tests/unit/server/plan-service-fun-judge.test.ts` (7, real pipeline and roles), and
3 new FUN JUDGE rules in `tests/architecture/jev-shadow-boundary.test.ts`. The adapter
may only be imported by plan-service. The port, service and selection must not touch
infrastructure, TypeSafe or `process.env`. Domain, UI, Free Ride and client modules must
never import the judge.

## Live evidence (`docs/vnext/evidence/2026-10-03-jev-fun-judge/`)

There were 75 live Jev requests in total, all sequential with no retries.

**FUN JUDGE, real plan service on local GraphHopper, shadow** (8 corpus OD pairs × curvy/backroads = 16 plans, 32 calls, all ok):

- Confident Jev pick = deterministic Best Ride in **14/14**. With `on`, **0 of 16** Best
  Rides would have changed.
- **2 abstentions** (`order-disagreement`), both Cherry Hill–Batsto, the only
  3-candidate shortlist: twisty 67 min vs scenic 72.6 min. Jev's pick flipped when the
  order was reversed. Order agreement overall was 87.5%.
- Raw Jev pick vs **Frontier** method pick: **56%** agreement (deterministic vs Frontier:
  62.5%). In every disagreement, Frontier chose the fastest route, while Jev and the
  deterministic scorer both chose the backroad route.
- Latency per call: p50 144 ms, p95 240 ms. Wall time per judgement (two calls in
  parallel): p50 151 ms, p95 298 ms.

**PR #51 held-out replay harness, live** (7 frozen cases × A/B/C × 2 orders = 42 calls,
41 ok, 1 `invalid-fit`). Stable verdicts agreed 100% with the exact bounded-regret
baseline. Order-flip rate: A 14%, B 50%, C 0%. C is the leakage ablation: it sees the
rank, so its stability is expected. There are no rider labels, so the harness reports
`promotionReady: false`.

**Reading.** On easy pairs (fastest vs scenic/backroad), Jev 1.13 reliably agrees with
our deterministic Best Ride. On the near-tie case it is order-sensitive, which is the
case where a judge would actually add value. The order check catches it, so it cannot
cause harm. There is no evidence yet that Jev beats the deterministic winner. Keep the
flag `off` in production. `shadow` is safe to run on a staging deployment to collect
real disagreements: it adds about 0.15–0.3 s per plan and 2 calls.

## For the integrator

1. **Foundations dependencies.** Code them against `FunJudgeEvidenceExtensions` in
   `fun-judge-selection.ts`. `curvatureContinuity` should come from #38 sustained curve
   continuity / #50 ordered evidence. `rideArc` (escape/core/return shares, core
   quality) should come from the #49/#35 canonical Ride Arc analyzer. plan-service does
   not pass `extensions` yet. When those land, add
   `extensions: (candidate) => ({ curvatureContinuity, rideArc })` to the
   `selectBestRideWithFunJudge` call. Until then both are sent as `null` (unknown).
2. **Scorecard (#48).** `scripts/jev-fun-judge-eval.ts` writes its own summary. Once the
   common scorecard exists, report through it as well. Equal call budget: the FUN JUDGE
   always costs exactly 2 calls per judged plan (0 on a cache hit).
3. **Corpus (#39).** `tests/real-router/routing-quality-{corpus,live.test}.ts` are
   byte-identical to `feat/routing-quality-corpus-20260930`. If foundations changes them,
   take theirs. `tests/real-router/jev-frontier-corpus.ts` (from #51) and the eval script
   import `RoutingQualityCase` / `ROUTING_QUALITY_CORPUS` from it.
4. **Observation, not changed.** The deterministic Best Ride is not itself bounded by
   the 35% Best Ride envelope. Harrisburg–Lancaster's winner is +54%. The FUN JUDGE
   always keeps the deterministic winner as the baseline, but it never moves Best Ride
   *to* a route outside the envelope.
5. **Promotion.** Turning `on` on in production needs a separate PR with held-out
   multi-rider labels and harder (near-tie, 3-candidate) cases, where Jev beats the
   deterministic winner with order stability. The v1 thresholds in
   `FUN_JUDGE_POLICY_V1` are uncalibrated.
6. **Local-only quirk.** This worktree's `node_modules` is a symlink overlay (shared
   install plus `tsx`/`server-only`). It is not committed and has no effect on CI.
