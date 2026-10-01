# Jev frontier shadow experiment

Status: **draft / shadow only**

This experiment evaluates whether TypeSafe Jev adds useful semantic judgment after
OpenGravel's deterministic routing stack has already established what routes are
valid and measured.

It does **not** make Jev a routing engine.

## Decision

Use the two September 2026 TypeSafe/OpenRouter products for different jobs:

- `typesafe/jev-1.13`: optional structured decision model over a final,
  already-valid route shortlist.
- `typesafe/jev-router`: possible later experiment at the AI Advisor model
  transport boundary, where the job is choosing a generative model and effort.

Do not use `typesafe/jev-router` to choose motorcycle routes. It routes prompts
to language models; it is not a pathfinder and does not own OpenGravel evidence.

For the first routing experiment pin `typesafe/jev-1.13`, not the moving
`jev-latest` alias, so replay results remain comparable.

## Why this fits the current architecture

OpenGravel now has four distinct pieces that should stay distinct.

### 1. Frontier routing

The frontier layer works on normalized measured route qualities and keeps
unknown evidence unknown. It removes conservatively dominated candidates and
keeps a small representative set with low regret.

Jev belongs **after** this reduction. It should never be asked to compensate for
weak route-space exploration or to rank a large raw GraphHopper candidate list.

### 2. Rider preference

The rider-preference model is local, interpretable and persistent. It learns a
Bayesian/Bradley-Terry posterior over:

- curvature
- backroad character
- unpaved share
- elevation
- traffic calm
- junction flow
- novelty
- time efficiency

That posterior describes the rider. Jev does not.

Jev may receive a compact posterior summary and an already-computed preference
utility for each candidate. It must never receive raw ride history simply to
perform this judgment, and its answer never updates the posterior.

### 3. Free Ride

Free Ride has a higher interruption cost than desk planning. The directed
network opportunity work restores a strong SwitchBack idea: search for a real,
forward, rejoinable road-network decision, then verify it through the ordinary
provider/evidence pipeline.

Jev is not the first Free Ride experiment. Once the frontier shadow experiment
is calibrated, the same pattern may later answer a narrower question:

> Is this already-verified opportunity sufficiently worthwhile to interrupt the
> rider now?

It still must not establish access, closure, surface, traversal, return-home
feasibility or route validity.

### 4. AI Advisor

Advisor converts natural language into a strict partial `RideIntent`, while
OpenGravel validates the proposal and the geocoder owns coordinates.

`typesafe/jev-1.13` cannot replace that job because it does not generate
arbitrary place names or structured prose-like payloads.

A separate future experiment can place `typesafe/jev-router` behind the
Advisor transport and measure whether model/effort selection lowers cost or
latency without reducing schema compliance or intent accuracy.

That experiment must not be conflated with route selection.

## Hard ownership boundary

The invariant is:

> Jev may interpret supplied truth. Jev may not create routing truth.

Jev must never determine or override:

- legal access
- closures
- gates or seasonal authority
- one-way restrictions
- whether a surface exists
- bike/terrain compatibility
- hard constraint satisfaction
- time arithmetic
- return-home feasibility
- whether missing evidence should be treated as known
- GraphHopper path generation
- route geometry
- navigation maneuvers
- reroute correctness
- geocoder coordinates
- route eligibility
- canonical `RouteScore`
- deterministic route evidence
- explicit current-ride intent

An ineligible candidate is never sent to Jev. A Jev answer can never resurrect
one.

## P0 experiment: Frontier Jev Shadow Judge

### Position in the pipeline

```
RideIntent
  -> bounded search probes / provider candidates
  -> hard eligibility
  -> road authority / closure / access
  -> canonical evidence
  -> canonical RouteScore
  -> Pareto frontier
  -> low-regret representative set
  -> geometry diversity
  -> optional rider-preference projection
  -> [Jev shadow judgment]
  -> existing deterministic roles / selectedRouteId
```

The bracketed step writes diagnostics/experiment telemetry only.

The existing deterministic bundle is constructed exactly as if Jev did not
exist.

### Baseline identity must not leak into Choice

`deterministicBaselineId` is an internal experiment fact used for comparison
and Noul construction. It must never be copied into the shared Jev state.

The transport projection exposes candidates only as A/B/C slots. For the
independent Noul question, the adapter may identify the baseline slot inside
that Noul question's own instructions. OpenRouter documents that Jev evaluates
questions independently against the same state, so this keeps the Choice/Score
state blind to which candidate OpenGravel selected.

### Candidate budget

Send **2 or 3 candidates only**.

Do not call Jev when:

- fewer than two valid candidates survive;
- the stable candidate set has not been finalized;
- the request was cancelled;
- required compact state cannot be formed without inventing values.

The shortlist should be the same small set being evaluated for rider-visible
presentation, not a second hidden candidate universe.

### State sent to Jev

Build the internal versioned `JevFrontierState`, then project it with `projectJevFrontierTransportState()` for the specific A/B/C ablation and candidate permutation. Never serialize the internal state wholesale.

#### Explicit intent

Send only authored/current intent:

- road character
- surface preference
- terrain level
- novelty preference
- avoid-highways
- toll policy
- **precomputed** timebox feasibility

Do not ask Jev to calculate a return time or compare dates.

#### Rider summary

When available, send:

- posterior mean on known rider-preference axes;
- posterior precision on those axes, so equal means with different uncertainty
  do not look equivalent;
- evidence amount on those axes;
- explicit/implicit comparison counts;
- already-computed candidate rider-preference utility.

Do not send:

- raw GPS history;
- raw saved rides;
- complete imported GPX files;
- account/profile metadata unrelated to the decision.

#### Candidate summary

For each final candidate:

- stable ephemeral candidate id;
- frontier quality vector;
- canonical score and deterministic rank;
- duration and distance;
- evidence coverage;
- rider-preference utility, if available;
- deterministic coherence measurements:
  - explicit U-turn count;
  - geometry reversal count;
  - maneuver density;
  - immediate backtracking share;
  - self-overlap share.

Prefer intrinsic measurements to prose descriptions.

Do not send geometry when the judgment can be made from measurements.

## Questions

One Decisions API request may contain all questions because they evaluate the
same state.

### Choice: route fit

Options inside each Jev call are presentation slots, not route identities:

- `A`;
- `B`;
- `C` when three candidates are present;
- `NONE`.

The adapter owns the slot -> stable candidate-id mapping. Telemetry and
evaluation must use stable candidate ids, never letters.

Instruction concept:

> Choose the already-eligible route that best matches the rider's explicit
> current ride intent and supplied rider-preference summary, using only the
> supplied measurements. Choose NONE when the supplied evidence does not support
> a meaningful preference. Do not infer legality, access, closure, missing road
> facts, safety, or unsupplied route characteristics.

Each option criterion should describe the candidate from the supplied state.
The question id itself must not carry semantic meaning.

Capture:

- selected slot;
- slot -> stable candidate-id mapping;
- probability for every slot + NONE;
- choice confidence;
- remapped stable candidate-id verdict.

The runtime validator requires the named Choice to be the unique probability
argmax. Exact ties are not broken arbitrarily; they are invalid/abstaining
measurements.


## Candidate-order bias audit

Position bias is a first-class P0 failure mode, not a later cleanup.

The shortlisted candidates are intentionally close: they have already survived
eligibility, Pareto filtering and regret reduction. That is exactly where a
semantic judge is most likely to be sensitive to option ordering.

For every stable candidate set:

1. derive a reproducible seeded starting assignment;
2. with two candidates, run both `AB` and `BA`;
3. with three candidates, run three cyclic assignments so each stable candidate
   appears once in A, once in B and once in C;
4. keep `NONE` fixed;
5. remap every returned slot back to the stable candidate id before logging;
6. compute the pairwise verdict flip rate across permutations.

The application contract exposes
`buildBalancedJevFrontierPermutations()` and
`auditJevFrontierOrder()` for this.

Any non-zero Choice flip rate means the verdict is order-dependent. P0 must
treat that candidate-set decision as an abstention for promotion/counterfactual
purposes, while still retaining the raw runs for bias analysis.

Do not average conflicting winners into a synthetic winner.

Log:

- experiment/corpus seed;
- permutation id;
- A/B/C -> stable id mapping;
- per-run stable winner or NONE;
- per-run probability distribution;
- aggregate mean probabilities;
- flip rate;
- whether the verdict was order-dependent.

This makes order sensitivity measurable rather than hidden noise.

### Score: semantic rider fit

Ask one score question per candidate with a fixed ordered rubric.

Recommended initial legend:

0. **Poor fit** — conflicts materially with supplied current intent or rider
   preference.
1. **Acceptable** — usable but little evidence it is especially well matched.
2. **Strong** — clearly matches several supplied priorities without a material
   supplied tradeoff.
3. **Exceptional** — unusually strong match across the priorities supported by
   supplied evidence.

This score is named **semantic fit**, never `RouteScore`.

Store the score distribution and confidence. Do not add it into canonical route
scoring during P0.

The top-level score is redundant provider output. OpenGravel validates that it
matches the expected value of the returned 0-3 probability distribution within
a small rounding tolerance; otherwise the entire judgment is invalid.

### Noul: meaningful improvement

Proposition:

> At least one supplied non-baseline candidate is meaningfully better matched
> than the deterministic baseline to this rider's explicit current intent and
> supplied rider-preference summary.

This question is intentionally independent of the Choice answer because Jev
evaluates the typed questions against the same state rather than chaining one
answer into the next.

Capture `noul` directly as the probability the proposition is true. The
counterfactual helper combines it with the Choice distribution afterward.

If the selected candidate is the deterministic baseline or NONE, the answer is
still useful telemetry but cannot imply a route change.

## Typed output semantics

Do not conflate three different probability/confidence systems:

1. **Rider preference probability** comes from OpenGravel's learned posterior
   about one rider.
2. **Jev option probabilities** describe Jev's distribution over the supplied
   semantic choices.
3. **Jev confidence** summarizes concentration of that choice/score
   distribution; it is not the winning option's probability.

A Jev score is a semantic judgment, not measured route quality.

## Thresholds

There are intentionally no production constants in P0.

The application helper accepts experiment thresholds from its caller only to
produce a telemetry-only counterfactual:

- minimum choice confidence;
- minimum winning-option probability;
- minimum probability margin over runner-up;
- minimum meaningful-improvement probability.

These are **not** rider-visible policy.

Calibrate them from OpenGravel's own labeled/blinded corpus. OpenRouter's Jev
documentation explicitly recommends choosing thresholds from domain data and
the cost of being wrong.

## Failure handling

P0 must be strictly optional.

Required behavior:

- no configured Jev/OpenRouter key -> no call;
- state invalid -> no call;
- request cancelled -> no call or result ignored;
- transport timeout -> deterministic answer;
- transport rejection -> deterministic answer;
- malformed response -> deterministic answer;
- model returns unknown candidate id -> deterministic answer;
- probabilities malformed -> deterministic answer;
- missing fit question -> deterministic answer;
- low confidence -> telemetry may record it; deterministic answer remains;
- cache failure -> deterministic answer.

No Jev failure may turn a successful route plan into an error.

### Latency budget

Follow the precedent in `jev-fun-character.ts`:

- no retries in the request path;
- short provider timeout;
- shorter foreground wait;
- cache by compact deterministic state where useful;
- late completion may populate cache/telemetry but must not delay the plan.

For the initial corpus runner, latency can be measured without imposing the
interactive foreground budget. Production-like shadow wiring should use a
strict budget comparable to the existing character classifier.

## API/model pinning

P0 target:

- endpoint: OpenRouter Decisions API;
- model: `typesafe/jev-1.13`;
- no moving alias in recorded experiment runs.

Record the exact returned model snapshot in telemetry.

The existing `@typesafe-ai/sdk` path can be evaluated first, but the adapter
must implement an OpenGravel-owned port so switching to OpenRouter's direct
Decisions API or SDK does not change application/domain code.

The existing route-character classifier is also pinned to `jev-1.13` in this
PR. Changing either judge model requires an explicit replay/calibration event;
do not silently collect longitudinal data through `jev-latest`.

## Experiment telemetry

One stable record per candidate set should contain:

- experiment schema version;
- request/corpus case id;
- candidate fingerprints/ids;
- deterministic baseline candidate;
- candidate canonical ranks;
- rider-preference predicted utilities/probabilities when available;
- Jev exact model snapshot;
- per-permutation A/B/C -> stable candidate mapping;
- per-permutation choice;
- per-option probabilities;
- choice confidence;
- Choice flip rate and order-dependence flag;
- aggregate mean candidate/NONE probabilities;
- per-candidate fit score/distribution/confidence;
- meaningful-improvement probability;
- latency;
- input token count and reported cost where available;
- validation/failure reason when no usable judgment;
- telemetry-only counterfactual status:
  - same-as-baseline
  - abstain
  - below-threshold
  - alternative
- later: blinded rider selection/outcome.

Never log API keys or raw GPS traces.

## Evaluation

Run against the permanent PA/NJ routing quality corpus and replayable candidate
sets before physical riding conclusions.

Agreement with the deterministic winner is a diagnostic only. It is not a
success metric: a judge that merely reconstructs canonical rank can achieve
high agreement while adding zero rider value.

Primary evaluation should use held-out blinded rider labels:

1. top-choice accuracy against held-out rider preference;
2. multiclass log loss;
3. Brier score;
4. reliability/calibration curves for chosen probability and Noul probability;
5. expected calibration error;
6. abstention coverage and selective accuracy;
7. Choice order flip rate;
8. repeated-identical-request stability;
9. incremental performance beyond deterministic frontier + local rider model;
10. latency p50/p95;
11. failure/invalid-output rate;
12. cost per stable candidate set.

Split by corridor and ride session, not individual candidate set, so
near-duplicate routes do not leak across calibration/test partitions.

Collect pre-ride map preference separately from post-ride preference. Pairwise
blinded labels are preferred to asking a rider to globally rank three map
screens. Structured reason tags should include at least boring egress,
sustained-flow quality, stressful junctions, surface mismatch, manufactured
"fake twisties", and timebox failure.

Do not make rider-visible claims from one rider or eight corridors alone.
The current corpus is measurement infrastructure; it is not a labeled
ground-truth dataset.

The key question is not "Does Jev produce plausible choices?"

It is:

> Does Jev add predictive information after canonical route evidence, frontier
> selection and the local rider-preference model have already done their jobs?

If it only restates those inputs, remove it from route selection and retain it
for classification/Advisor routing where it provides clearer value.


## Leakage / ablation design

The full state intentionally contains several correlated deterministic summaries:
frontier axes, canonical score/rank, coherence and rider utility. Sending all of
them in every run makes it easy for Jev to reconstruct OpenGravel's baseline
rather than demonstrate incremental semantic value.

Replay the same frozen candidate sets through four blinded input variants:

| Variant | Jev input | Purpose |
| --- | --- | --- |
| A | explicit intent + intrinsic normalized measurements | Tests semantic composition from facts |
| B | A + rider posterior mean/precision/evidence + candidate rider utility | Tests incremental personalization |
| C | B + canonical score/rank | Measures deterministic-baseline leakage/reconstruction |
| D | no Jev; deterministic frontier + rider model | Required control |

Where the same signal exists both as an intrinsic measurement and a derived
aggregate, prefer the intrinsic measurement in A/B. Do not send a raw
coherence measurement and a second aggregate coherence score in the same
variant.

If C mainly raises agreement with the deterministic winner but does not improve
held-out Brier/log-loss/top-choice metrics over B or D, treat it as leakage, not
a Jev win.

## P0 acceptance gate

The first implementation is complete when:

- the pure application state/output contract is covered by unit tests;
- a server-only provider adapter is feature-gated;
- the model is pinned;
- each stable final candidate set uses the fixed balanced order audit: two Jev
  requests for two candidates or three Jev requests for three candidates, with
  all Choice/Score/Noul questions batched inside each permutation request;
- the existing plan bundle is byte-for-byte equivalent with Jev enabled,
  disabled, failed and timed out;
- telemetry captures valid and invalid judgments;
- no route authority or canonical score code imports the Jev adapter;
- no browser bundle contains an API key;
- corpus replay can emit comparable JSON records;
- CI passes lint, typecheck, unit, architecture and build.


## Routing-method implications outside PR #51

### Exact regret before Jev evaluation

PR #34 fixed a known weakness in the representative selector using exact
bounded enumeration at OpenGravel's current candidate scale and is now merged
into `main`. Jev evaluation must run only after PR #51 is synced/rebased onto
that mainline selector. Otherwise downstream judge measurements are confounded
by the older shortlist algorithm already known to be avoidably suboptimal.

### Regret should eventually influence probe spending

The ATMOS 2025 work explicitly supports regret filtering during or after
multi-criteria search. OpenGravel currently applies the idea after provider
candidate generation, while PR #30 already identifies candidate generation as
the quality ceiling.

A later routing PR should therefore test a budgeted probe scheduler:

- keep one efficient/control probe;
- keep one explicit-intent extreme;
- spend the remaining exploration call on the probe with the highest expected
  marginal frontier/regret contribution from corpus history.

For every probe, log whether it:

- returned a valid route;
- survived eligibility;
- expanded the Pareto frontier;
- entered the exact representative subset;
- improved worst/mean regret;
- won held-out rider preference.

Do not implement this inside PR #51. It changes route-space exploration and
deserves its own equal-provider-call-budget experiment.

### Curvature verification remains mandatory

Current GraphHopper documentation still defines `curvature` as an encoded
0..1 road attribute and ships `curvature.json` as a custom-model component
that can be composed with motorcycle profiles. That supports the existing
OpenGravel concern that merely having a "twisty" profile name is not evidence
that the deployed profile actually uses curvature.

Before treating `motorcycle_twisty` as a control, run the permanent
differential corpus against `motorcycle_fastest` and record material route
differences. Sustained bend continuity remains a separate route-level
measurement because a per-edge curvature attribute does not measure continuity
across a sequence of bends.

## Later, only after P0 evidence

### Rider-visible frontier influence

Requires a new PR and a calibrated policy. Do not silently turn the shadow
counterfactual into `selectedRouteId`.

### Free Ride

Potential later question:

> Is this verified, timely opportunity valuable enough to interrupt the rider
> given the supplied route fit, novelty, current attention state and remaining
> return budget?

Only after network traversal, normal eligibility and deterministic interruption
gates have passed.

### AI Advisor + `typesafe/jev-router`

Separate experiment:

- keep Advisor schema and geocoder boundary unchanged;
- use Jev Router only to select the generative model/effort;
- compare exact-schema success, semantic evals, latency and cost against the
  current fixed model;
- fail back at the Advisor transport layer according to an explicit policy;
- never let a model router bypass Advisor validation.

## Related work

- frontier routing: PR #30
- exact bounded-regret improvement: PR #34
- rider preference learning: PR #29
- directed Free Ride network search: PR #37
- verified Free Ride integration/fallback: PR #40
- in-motion Free Ride quality/latency gate: PR #43
- live routing quality corpus: PR #39
- existing optional Jev route-character classifier:
  `src/infrastructure/routing/jev-fun-character.ts`

The long-term architecture remains:

> GraphHopper proposes paths. OpenGravel establishes truth. Personalization
> describes the rider. Jev may make bounded semantic judgments.


## Research references

- OpenRouter, **What Is Jev? TypeSafe's Decision Model Explained for Developers**
  (Jev 1.13, model pinning, calibrated probabilities, Score expected-value
  semantics):
  https://openrouter.ai/blog/insights/what-is-jev/
- OpenRouter, **How to Use Jev** (Choice/Noul/Score response semantics):
  https://openrouter.ai/blog/tutorials/how-to-use-jev/
- Shi et al., **Judging the Judges: A Systematic Study of Position Bias in
  LLM-as-a-Judge**, IJCNLP-AACL 2025:
  https://aclanthology.org/2025.ijcnlp-long.18/
- Xu et al., **Am I More Pointwise or Pairwise? Revealing Position Bias in
  Rubric-Based LLM-as-a-Judge**, 2026:
  https://arxiv.org/abs/2602.02219
- Truschel & Storandt, **Multi-Criteria Route Planning with Little Regret**,
  ATMOS 2025:
  https://drops.dagstuhl.de/entities/document/10.4230/OASIcs.ATMOS.2025.13
- GraphHopper current profile documentation (custom-model composition and
  `curvature.json`):
  https://github.com/graphhopper/graphhopper/blob/master/docs/core/profiles.md
- GraphHopper current custom-model documentation (`curvature` semantics):
  https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md
