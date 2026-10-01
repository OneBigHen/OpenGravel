# Curvy frontier routing: probe allocation, sustained bends, and Jev availability

Date: 2026-10-01
Status: research only; no production routing, Jev ranking, deployment, or live inference
Base inspected: `public/main` at `1a04c4661575fded6cde019731a64e75f128f139`
Related heads: library corridors `5f301b3`, ordered road runs `740c1aa`, curvature continuity `472f9de`, routing scorecard `83e8b96`, Jev shadow `acac4f1`

This note continues the existing frontier, library-corridor, and Jev-shadow work. It focuses on the gaps that still affect route quality: deciding which bounded probe deserves the next router call, distinguishing sustained flowing curves from junction and U-turn noise, making signed rider utility safe, and keeping Jev model IDs correct per transport.

The product boundary remains unchanged: GraphHopper or another provider proposes paths; OpenGravel establishes eligibility and evidence; deterministic application code owns selection and roles; Jev can only make an optional semantic judgment over a small, already-valid shortlist.

## Findings and decisions

### 1. Use an adaptive probe allocator, not another permanent profile

The current lane coordinator spends one call per static profile in `src/application/planner/candidate-lanes.ts`. The frontier selector in `src/application/planner/frontier-routing.ts` can now enumerate the exact representative subset for the current small pool, but it cannot recover a route that no lane asked the provider to produce. The library-corridor branch already exposes the right alternative: an ordered corridor is a call-budgeted search question, not a new source of route truth (`src/application/planner/library-corridor-probes.ts` on `5f301b3`).

The next research slice should be a pure, provider-neutral allocator. Give it caller-supplied measured history and a fixed attempt budget. It returns an ordered list of probe intents; it does not route, score, select, or change the canonical plan.

Recommended policy for a three-attempt point-to-point plan:

1. Reserve one attempt for the efficient baseline.
2. Reserve one attempt for an explicit hard or rider-authored objective when one exists (for example, the surface lane or a must-follow corridor).
3. Spend the remaining attempt on the probe with the highest expected marginal contribution to the unresolved frontier. Candidate probes include `flow`, `twisty`, `backroad`, library-corridor, departure/rejoin, and a missing-link connector.
4. After every completed attempt, update the provisional set and recompute the next marginal contribution. A timeout, provider rejection, retry, or connector request consumes the number of actual HTTP attempts reserved for it, even when it produces no candidate.
5. Use a deterministic seed and stable tie-break. A cold-start allocator falls back to the existing lane order; it must not invent a historical prior.

The contribution signal should be a forecast of *what the probe discovers*, not a second route scorer. A useful first version is leave-one-corridor-out replay history bucketed only by non-sensitive request shape: route-length band, timebox band, surface envelope, and explicit character. For each probe, estimate:

```text
expected marginal gain =
  probability of a valid eligible candidate
  × probability of entering an as-yet-uncovered frontier cell
  × expected reduction in exact k-set regret
  - latency/failure cost
```

The allocator must re-evaluate against the actual returned candidate. A probe that historically finds curves may be skipped after the current set already contains a sustained-curves candidate; a probe that historically produces a new flow/backroad region should win the next slot. This is a search-allocation prior, not rider preference and not evidence. The ATMOS 2025 regret work supports filtering a large Pareto set to a requested representative size and gives the right evaluation target: regret of the returned set against possible constrained or personalized users, rather than a single opaque score ([Truschel and Storandt, *Multi-Criteria Route Planning with Little Regret*](https://doi.org/10.4230/OASIcs.ATMOS.2025.13)).

The allocator experiment is fair only when control and treatment reserve the same maximum provider attempts, including retry and connector attempts. Report, per trial:

- reserved attempts, actual HTTP attempts, and completed provider calls;
- valid, eligible, Pareto-surviving, and exact-representative candidates;
- newly covered frontier cells and exact worst/mean regret;
- sustained-bend share, flow-run share, junction and reversal noise;
- duration, timebox error, latency p50/p95, and route overlap;
- blinded rider preference when available.

The routing experiment scorecard at `83e8b96` is the correct common reporting contract. Promotion requires equal-budget held-out improvement; a treatment that wins only because it was allowed another call is not evidence of a better algorithm.

### 2. Make “curvy” mean sustained flowing road character

The current line-derived `bendMeters()` and `smoothedRouteMetrics()` are valuable protections against provider curvature lies, but they still reduce a route to a whole-line bend share. `bendMeters()` already rejects a single sharp junction corner and requires two consecutive bend vertices; `smoothedRouteMetrics()` simplifies at 25 m and ignores turns outside 15–120 degrees. Those rules are good baselines, not a complete definition of a fun road.

GraphHopper's `curvature` encoded value is an edge-local beeline-distance/edge-distance ratio. Its stock motorcycle model explicitly composes `curvature.json`, whose request rule penalizes edges with `curvature >= 0.98`; this is useful route-generation evidence, but it cannot establish continuity across many short edges ([GraphHopper motorcycle model, 11.0](https://github.com/graphhopper/graphhopper/blob/11.0/core/src/main/resources/com/graphhopper/custom_models/motorcycle.json), [GraphHopper curvature model, 11.0](https://github.com/graphhopper/graphhopper/blob/11.0/core/src/main/resources/com/graphhopper/custom_models/curvature.json)). GraphHopper also exposes `change_angle` for turn penalties when turn-cost routing is enabled ([custom-model documentation](https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md)).

Add an experimental route-shape vector beside the existing canonical curvature value:

```text
sustainedBendShare       metres inside qualified flowing bend runs / route metres
flowRunCount             maximal qualified runs
medianFlowRunMeters      median run length
junctionTurnShare        bend metres close to a maneuver or junction boundary
reversalShare            immediate direction reversal / self-overlap evidence
curveEvidenceCoverage    share of route with usable ordered geometry/context
```

The first detector should be geometry-first and context-aware:

1. Resample or simplify to a bounded distance scale before calculating heading changes, so a provider's point density cannot manufacture bends.
2. Smooth heading change over a short window and mark a bend sample only when the radius/turn signal clears the experiment threshold.
3. Form a run only after a minimum ridden length and multiple bend samples. A lone sharp vertex is a maneuver, not a flowing road.
4. Exclude or separately label intervals around provider maneuver instructions, roundabouts, obvious U-turns, and immediate backtracking. Do not throw them away from the route; report them as interruption cost.
5. Join the ordered provider road runs from `740c1aa` when available. Road class, road environment, urban density, surface, and curvature remain raw evidence; they can mask a junction-heavy interval or explain a run, but they cannot turn unknown into paved or fun.

This yields two different answers: “how twisty is the line?” and “how much of the ride is a sustained, coherent curvy section?” The latter is what the `flow` frontier dimension and Jev semantic-fit shadow should see. Keep the new vector shadow-only until a small synthetic corpus (straight, S-curve, long sweepers, hairpins, roundabouts, urban zig-zags, and U-turn detours) plus blinded PA/NJ route labels show that it rejects fake twisties without rejecting genuine mountain bends.

The exact thresholds belong in an experiment policy and should be tuned against labels, not hidden in `RouteScore`. Preserve the current `bendMeters` fallback when ordered context is unavailable; unknown coverage stays unknown.

### 3. Use a generation ladder for better route space

The existing research already identifies the right order. The practical ladder is:

1. Static profile lanes plus one adaptive exploration probe.
2. One library corridor via ordered shaping anchors, holding the provider call budget constant.
3. Departure/rejoin replacement of a dull interval on a baseline route; this is easier to measure than whole-route mosaics because most of the baseline is preserved.
4. Missing-link discovery between two attractive but nearly connected corridors; the connector must earn its own eligibility and quality evidence.
5. Bounded beam search over two to four corridor prizes for loops, with GraphHopper routing only the surviving anchor sequences. Retain seeded `round_trip` as a control and fallback.
6. Forward network-opportunity search for Free Ride, with one or two bounded branches at a stable decision window and a hard return/continuation check.

This is an application-level approximation to arc-orienteering: value is attached to traversable road sections and the route must fit a time budget. The large-network *Scenic Routes Now* paper formalizes the time-dependent Arc Orienteering Problem and reports an approximate dynamic-programming method because optimal solutions are infeasible at scale ([Jossé et al., 2016](https://arxiv.org/abs/1609.08484)). OpenGravel should borrow the bounded beam/prize-collection shape, not implement an exact continental solver.

GraphHopper 11 remains the best first substrate. Its custom models compose request rules with the server profile, but LM/hybrid constraints require query `multiply_by` values in `[0, 1]` and prevent lowering `distance_influence` below the prepared profile. Use penalty-only probes until the deployed mode is verified ([profiles documentation](https://github.com/graphhopper/graphhopper/blob/master/docs/core/profiles.md), [custom models documentation](https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md)). A live differential corpus must first prove that the deployed `motorcycle_twisty` profile actually composes curvature against `motorcycle_fastest`; a profile name or valid response is not proof.

Valhalla is useful as a route-shape benchmark because its routing service uses dynamic run-time costing and its beta `motorcycle` costing exposes road-touring/trail-oriented knobs ([Valhalla API reference](https://github.com/valhalla/valhalla-docs/blob/master/turn-by-turn/api-reference.md)). It is not a reason to migrate the primary stack: the experiment would lose the current GraphHopper details, custom-model constraints, and navigation alignment. Compare providers only after normalizing eligibility, evidence coverage, and equal time/call budgets.

### 4. Make signed preference utility mathematically safe

`FrontierPreferenceProfile.weights` and `frontierUtility()` currently assume positive weights over quality axes whose larger value is better. That is safe for fixed archetypes, but it cannot represent a rider who explicitly dislikes a dimension or a learned posterior whose mean is signed. Clamping negative terms to zero silently turns “avoid this” into “ignore this,” which can select a route that violates the rider's meaningful tradeoff.

If signed utility is added, keep it behind a shadow policy and make the translation explicit:

- retain normalized measured qualities and `null` unknowns;
- represent each preference as a signed term plus an explicit target/direction, rather than overloading raw evidence;
- calculate coverage with the sum of absolute participating weights, so a positive and negative term cannot cancel and make sparse evidence look complete;
- skip unknown dimensions from both numerator and coverage; never substitute 0, 0.5, or the profile mean;
- apply explicit current-ride hard constraints before utility;
- normalize signed utilities per profile before regret, for example by the observed `[max(U), min(U)]` range with an epsilon guard, so regret stays non-negative and comparable;
- keep provider facts, eligibility, and route roles independent of the signed profile.

The test oracle is exhaustive feasible-subset selection on small pools. Include a negative gravel preference, a negative junction preference, a positive sustained-curve preference, and missing surface evidence. Assert that unknown surface does not become a favorable value and that no signed profile can resurrect an ineligible candidate. Compare greedy/allocator output with the exact subset oracle, not only with a weighted total.

### 5. Fix Jev model identity per transport before judging quality

The current direct pilot on `acac4f1` requested `jev-1.13` and received HTTP 400/“Unknown model,” while the authenticated catalog exposed `jev-latest` and `jev-preview`. The freshest official TypeSafe model page explains the mismatch:

| Transport | Pinned model documented by that transport | Moving alias | Current documented availability |
| --- | --- | --- | --- |
| Direct TypeSafe SDK/API | `jev-1.13.0` | `jev-latest`; `jev-preview` | Both aliases currently point to `jev-1.13.0`; `GET /v1/models` lists aliases, while versioned IDs are accepted by the request field ([TypeSafe Models](https://docs.typesafe.ai/models)). |
| OpenRouter Decisions API | `typesafe/jev-1.13` | `~typesafe/jev-latest` | OpenRouter currently lists the pinned model and reports TypeSafe as a provider ([OpenRouter Jev 1.13](https://openrouter.ai/typesafe/jev-1.13/api), [How to Use Jev](https://openrouter.ai/blog/tutorials/how-to-use-jev/)). |

The direct TypeSafe result therefore does not prove that the canonical pinned model is unreachable; it proves that the direct adapter tried the wrong provider-specific spelling. The Jev-shadow adapter at `acac4f1` currently uses `jev-1.13` in the request builder while the application constant is `typesafe/jev-1.13`. The next credentialed probe, when separately authorized, should test exactly two independent combinations:

```text
direct TypeSafe:  model = jev-1.13.0
OpenRouter:       model = typesafe/jev-1.13
```

Record the provider, requested ID, response `model`, release/catalog snapshot, HTTP status, latency, and usage. Never silently fall back from a pinned failure to an alias. The direct SDK documentation also says browser use is disabled by default because it would expose the API key ([TypeSafeClientConfig](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig)); keep this server-only.

Jev is suitable for a bounded semantic question over two or three *already-eligible* candidates. It is not suitable for arithmetic, counting, dates, or geometry generation; the official jaggedness guide says to keep those operations in code and send only the relevant compact state ([Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)). The transport must remain an application port and the existing deterministic plan must remain unchanged when Jev is disabled, unavailable, low-confidence, or malformed.

### 6. Three cyclic permutations are a useful smoke check, not a full order audit

For three candidate slots, the current Jev shadow generates three cyclic orders. Each candidate appears once in each slot, which controls simple position frequency, but it omits the three reverse-cycle orders. A model can still be sensitive to candidate adjacency or the handedness of the sequence.

The full audit is all six permutations. It doubles Jev requests for three candidates, so use it for prompt/model calibration and a representative evaluation subset. A cost-bounded shadow can run the three cycles first and schedule the reverse three only when the first set is close, inconsistent, or otherwise promotion-relevant. Any disagreement remains an abstention; do not average conflicting winners into a synthetic route choice.

This recommendation follows measured position-bias concerns in LLM judges ([Shi et al., IJCNLP-AACL 2025](https://aclanthology.org/2025.ijcnlp-long.18/)) and research showing that balanced answer permutations can expose and reduce order effects ([Xu et al., 2026](https://arxiv.org/abs/2602.02219)). If implemented, the pure audit contract must accept six outcomes for a three-candidate set; current `auditJevFrontierOrder()` assumes outcome count equals candidate count.

## Evaluation plan

Keep the routing scorecard and Jev shadow replay separate:

1. Freeze the same eligible candidate pool and exact low-regret shortlist for all allocator arms.
2. Compare static lanes, adaptive allocation, and one library/departure-rejoin treatment at the same actual provider-attempt budget.
3. Score the route-shape vector, canonical evidence, time/call cost, frontier regret, and geometry diversity.
4. Add blinded rider labels by corridor/session split. A route a rider would take again is the quality target; canonical score or Jev agreement alone is diagnostic.
5. For Jev, report pinned transport/model identity, order-flip rate, repeated-request stability, calibration, abstention, incremental value over deterministic frontier plus local rider preference, and p50/p95 latency. The seven current live corpus cases have no held-out rider labels, so they cannot establish Jev value.

The first useful implementation artifact is therefore a replayable allocator report, not a new production lane or a new Jev route authority.

## Licensing, privacy, and data boundaries

- GraphHopper is Apache-2.0; its default OpenStreetMap road data is ODbL. Preserve attribution and the applicable database/share-alike obligations when importing or publishing OSM-derived data ([GraphHopper NOTICE](https://github.com/graphhopper/graphhopper/blob/master/NOTICE.md)).
- Valhalla is MIT-licensed ([COPYING](https://github.com/valhalla/valhalla/blob/master/COPYING)); using it as a benchmark still requires its notices and the data licenses of the tiles supplied to it.
- The TypeSafe JavaScript SDK is MIT-licensed ([repository](https://github.com/typesafe-ai/typesafe-sdk-js)), but the hosted Jev service is a separate provider boundary. Use its current terms and data-handling documentation before sending proprietary state.
- Send Jev only compact, derived route measurements, explicit intent, and a bounded rider-preference summary. Do not send raw GPX, coordinates, route geometry, complete ride history, account identifiers, API keys, or private catalog artifacts. Do not log provider bodies or credentials.
- Treat a GPX occurrence as a search prior. It does not prove present access, surface, closure state, legality, passability, or rider enjoyment. Retain provenance and source boundaries; do not flatten malformed/disjoint lines into route truth.
- OpenGravel remains AGPL-3.0. Do not copy private QA evidence, unlicensed route catalogs, or raw GPS into a public release or this research note.

## Prioritized next steps

1. **P0: provider ID correction and availability gate.** Split direct TypeSafe and OpenRouter model configuration; accept only their provider-specific pinned IDs; require a catalog check plus one tiny authenticated request before calling a model reachable; preserve a fail-closed unavailable result. This is prerequisite to any Jev quality claim.
2. **P0: adaptive allocator replay.** Implement a pure allocator over caller-supplied measured history, reserve baseline/explicit lanes, debit actual HTTP attempts, and compare against static allocation with the same budget. Use exact low-regret selection as the retrospective oracle.
3. **P0: sustained-curve shadow vector.** Add geometry-resampled flow runs and interruption metrics beside `bendMeters`; join ordered road runs when available; validate on synthetic shapes and a small held-out PA/NJ corpus.
4. **P1: full Jev order audit.** Run all six candidate permutations in calibration; use three-plus-reverse escalation for cost-bounded shadow runs; change the audit schema before accepting any counterfactual.
5. **P1: signed-utility shadow.** Add absolute-weight coverage and normalized signed regret tests, including negative preferences and unknown dimensions. Keep current deterministic positive-profile behavior as the fallback.
6. **P2: route-generation ladder.** Evaluate departure/rejoin, missing-link, corridor-prize beam search, and Free Ride forward opportunity search in that order. Benchmark Valhalla only after GraphHopper’s curvature composition and equal-budget allocator are measured.

No item above promotes Jev to production route ranking. Promotion requires equal-budget route experiments, held-out rider labels, stable model identity, calibrated abstention, and all existing eligibility/latency/fallback gates.

## Existing repo seams used

- `src/application/planner/candidate-lanes.ts` — static one-call lane budget and the natural allocator boundary.
- `src/application/planner/frontier-routing.ts` — Pareto filtering, exact bounded representative selection, and current positive-weight utility assumptions.
- `src/domain/geometry/bends.ts` and `src/domain/geometry/analysis.ts` — current line-derived bend protections.
- `src/infrastructure/routing/graphhopper/request-builder.ts` — GraphHopper custom-model/turn-penalty vocabulary and request boundary.
- `src/infrastructure/routing/graphhopper/road-details.ts` and `src/application/planner/route-provider.ts` — raw ordered road evidence and provider-neutral summary.
- `src/domain/route/fun.ts` — shadow fun assessment; a natural consumer of a sustained-flow override after validation.
- `docs/library-corridor-routing.md` at `5f301b3` — corridor probes, departure/rejoin, missing links, and corridor-prize loop ladder.
- `docs/ordered-road-evidence-runs.md` at `740c1aa` — ordered raw evidence semantics.
- `docs/routing-experiment-scorecard.md` at `83e8b96` — equal-budget evaluation contract.
- `docs/jev-frontier-shadow.md` and `docs/vnext/evidence/2026-10-01-jev-frontier/` at `acac4f1` — server-only Jev projection, replay, and the current direct-provider availability observation.
