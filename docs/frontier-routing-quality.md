# Frontier routing quality slice

Status: **implemented comparison slice; release verification in progress**

The baseline for this note is the public release at `9e970f8`. The
intent-centered profile slice described below is the follow-up implementation
being reviewed against that baseline; it is not part of the baseline release.

The live opt-in Frontier comparison already does several things correctly: it
starts from eligible canonical candidates, treats missing quality as `null`,
filters conservatively on Pareto dominance, and chooses a small representative
set with deterministic exact enumeration while the frontier is bounded. Those
properties should remain intact. The follow-up slice makes the utility profiles
reflect the rider's authored road-character intent and makes "curvy"
distinguish continuous riding sections from a route that merely accumulates
many isolated bends.

This is a selection and measurement slice over existing route candidates. It
does not add a provider, a second ride-state authority, a Jev ranking role, or
new road/access facts.

## What the current code proves

`frontier-routing.ts` defines a normalized quality vector, evidence-conservative
dominance, coverage-weighted utility, and stable candidate-ID tie breaks
([source](../src/application/planner/frontier-routing.ts#L21-L60),
[dominance and utility](../src/application/planner/frontier-routing.ts#L85-L180),
[deterministic representative selection](../src/application/planner/frontier-routing.ts#L240-L431)).
The test suite covers sparse evidence, unknowns, candidate-order invariance,
and an exact bounded subset case
([tests](../tests/unit/application/frontier-routing.test.ts#L43-L356)).

In the public baseline, the live comparison used one fixed
`efficient`/`curvy`/`backroads` profile set for every ride. It computed a
continuity value but did not include the vector's `flow` axis in those fixed
profiles, so continuity could not affect Frontier selection
([baseline comparison](https://github.com/OneBigHen/OpenGravel/blob/9e970f8769de9e6f4aaeaed4cb0c308e17b22e2b/src/application/planner/routing-method-comparison.ts#L49-L54)).
The baseline's stored continuity ratio was `longestRunMeters / curvyMeters`;
when a route has a small amount of curved geometry, that ratio can be one even
though the run is too short to represent a sustained ride section
([geometry evidence](../src/application/roads/engine-road-evidence.ts#L107-L119)).

The follow-up implementation adds the pure
`frontierComparisonProfiles` policy and recomputes the continuity proxy from
validated lengths in the comparison seam
([profile policy](../src/application/planner/frontier-comparison-policy.ts),
[current comparison](../src/application/planner/routing-method-comparison.ts#L48-L123)).
It does not alter canonical route policy or automatic selection.

The existing domain already has the right intent boundary. `roadCharacter` is
one of `efficient`, `balanced`, `curvy`, or `backroads`, while surface, traffic,
and bike constraints remain authored intent with their own eligibility and
policy semantics ([ride types](../src/domain/ride/types.ts#L109-L160),
[route policy](../src/domain/route/policy.ts#L105-L210)). The Frontier layer
should consume these values; it should not redefine them.

## Implemented slice and current profile neighborhoods

The follow-up adds a pure application function that builds a small, ordered
profile neighborhood from the current `roadCharacter`, then feeds it into the
existing `selectLowRegretRepresentatives` call. The actual neighborhoods are:

| Intent / evidence | Current profiles |
| --- | --- |
| `balanced` | `efficient`, `curvy`, `backroads` using the baseline weights |
| `efficient` | `efficient`, `efficient-flexible`, `efficient-direct` with time-efficiency weights `0.85`, `0.75`, and `0.90` |
| `curvy`, continuity unavailable | `curvy`, `curvy-flexible`, `curvy-focused` with curvature weights `0.75`, `0.65`, and `0.80` |
| `curvy`, common continuity measured | the same three IDs, with `flow` weights `0.25`, `0.20`, and `0.25` and lower curvature weights `0.50`, `0.45`, and `0.55` |
| `backroads` | `backroads`, `backroads-flexible`, `backroads-focused` with backroad weights `0.70`, `0.60`, and `0.80` |

All weights are positive comparison heuristics. They are not calibrated rider
preferences and do not replace the versioned canonical route policy. Surface, novelty, and
traffic are not newly weighted by this slice; their existing eligibility,
warning, and evidence semantics remain authoritative.

For `curvy`, `flow` is enabled only when every comparable core-measured
candidate has a validated run length. Otherwise the profile keeps `flow` out of
its weights and the comparison vector omits that axis for every candidate;
the underlying measured evidence and missing values remain unchanged. This is a
common-support gate, not an imputation rule.

The `curvy` profiles use both total curve density and a separate continuity
axis. A route's total curve value remains the existing normalized curvature
measurement. For a measured bend run, the follow-up computes:

```text
runShare = clamp(longestRunMeters / totalMeters, 0, 1)
sustainedCurve = sqrt(continuityShare * runShare)
```

`continuityShare` is the measured longest run divided by all bend metres.
`runShare` supplies the missing scale: a single 40 metre bend on a long route
cannot receive the same continuity value as a long connected bend section. The
geometric mean keeps either weak signal from being hidden by the other. The
implementation recomputes both ratios from validated lengths and does not trust
a stored `continuityShare` value. This is an uncalibrated deterministic geometry
proxy, not a safety, pavement, traffic, or rider-enjoyment claim. Keep it
separate from total curvature so a route with many short bends can remain
visible as a different tradeoff.

Only use `sustainedCurve` when `longestRunMeters`, `curvyMeters`, and
`totalMeters` are finite and mutually valid. When the continuity measurement is
absent, leave the axis `null`. Do not replace it with zero, an average, or a
provider default. A profile may be evaluated only when its weighted evidence
coverage reaches the existing threshold. If too few candidates have common
continuity evidence, the implementation falls back to the curvature-only curvy
neighborhood while leaving missing continuity as `null`; it does not let a
different evidence footprint create a false winner.

This slice should retain the current two fairness rules:

1. Pareto dominance compares only mutually known dimensions, and a sparse
   candidate cannot dominate a candidate with additional known evidence.
2. Utility coverage is weighted by the profile's positive weights and reduces
   utility when an axis is missing. Unknown evidence is epistemic uncertainty,
   not a low-quality measurement. A future robust-routing experiment may model
   bounded uncertainty, but it must be a separately versioned policy rather than
   silently mapping `unknown` to zero.

The recommendation output remains a manual comparison. It must not mutate
`PlanningSession` automatic selection, route roles, candidate scores, or
geometry. Candidate IDs should continue to use the stable fingerprint and the
exact selector should continue sorting by ID before evaluating subsets. This is
the source of order invariance and makes a profile change reviewable as a policy
change rather than an iteration-order accident.

## Why this is the right algorithmic step

Multi-criteria route planning has a natural Pareto-set formulation, but the set
can grow too large for a rider-facing choice surface. Truschel and Storandt's
primary ATMOS 2025 paper formalizes regret-minimizing representative subsets
for constrained and personalized route queries and gives quality guarantees for
the reduced set. The current bounded exact selector is consistent with that
idea; intent-centered positive profiles make its user model reflect the ride
request instead of treating every request as the same three hypothetical users
([paper and full text](https://drops.dagstuhl.de/entities/document/10.4230/OASIcs.ATMOS.2025.13)).

That paper motivates the representative-set approach; it does not validate
OpenGravel's finite profile neighborhoods or the `sustainedCurve` formula.
Those weights and the formula remain comparison heuristics until measured
against a route corpus and rider/on-road evidence.

Research on robust shortest paths treats uncertain costs as a distinct modeling
problem with explicit uncertainty criteria. It does not supply an imputation
rule for OpenGravel's missing evidence. Our null and common-support rules are
project choices, not guarantees derived from that paper
([primary robust-shortest-path paper](https://doi.org/10.1016/S0305-0548(97)00085-3)).

The distinction between accumulated curvature and a run-length signal is an
OpenGravel measurement choice over the provider's ordered geometry. Literature
on C2 path-curvature continuity concerns vehicle trajectory smoothness, which is
a different problem. It should not be used as evidence that this route-shape
heuristic measures safety or rider enjoyment.

Candidate generation remains a follow-up. GraphHopper custom models are useful
for bounded provider probes, but the current slice should not claim that a new
LM penalty, encoded value, or corridor search is live. Any generator experiment
must still return through canonical eligibility, evidence, and the same
provider-neutral selector ([GraphHopper custom-model documentation](https://github.com/graphhopper/graphhopper/blob/11.0/docs/core/custom-models.md)).

## Tests and small real-router benchmark

Application tests around the pure profile builder and comparison seam should
cover:

- the same eligible three-route bundle chooses the fast route for `efficient`
  and the high-curve route for `curvy`, while `selectedRouteId` and the bundle
  remain unchanged;
- `curvy` prefers the route with higher `sustainedCurve` when two routes have
  similar total curvature, and does not let one isolated short bend beat a
  genuinely long run;
- candidate input permutations produce the same route and profile output;
- removing continuity evidence makes the continuity profile unavailable or
  lowers its weighted coverage; it never turns the missing axis into zero or a
  neutral value;
- a sparse candidate cannot win solely by omitting an inconvenient axis;
- loop and destination detour envelopes remain unchanged.

The release work should run a private before/after real-router corpus of roughly
8–12 named PA/NJ area pairs covering a direct corridor, a rural corridor, a
bend-rich corridor, a mostly straight corridor, and a loop budget. The harness
should generate routes and discard geometry after computing aggregate records.
The final gate report belongs in the release handoff; this note records only the
benchmark shape. Track only:

- eligible-candidate and profile-coverage rates;
- selected profile ID and route fingerprint, with fingerprints salted or
  omitted from tracked artifacts;
- exact-subset regret and candidate-order invariance;
- paired total-curvature versus sustained-continuity outcomes;
- detour/timebox violations (target: zero);
- how often an unknown axis changes a recommendation (target: never by itself).

Keep coordinates, raw geometry, provider payloads, and route fingerprints out of
tracked documentation. A profile change should be promoted only after the
aggregate report shows stable deterministic behavior and no regression in the
existing real-router eligibility, timebox, or detour checks. The shape heuristic
is not calibrated until rider or on-road evidence exists, so the public copy
must continue to call it a mapped bend estimate.

### Paired live-router observations, 2026-10-01

An eight-case private corpus used six destination corridors and one-hour and
two-hour loops. Both implementations compared each *same* canonical bundle
under all four Roads choices: 32 paired comparisons. Eight recommendations
changed. Balanced retained all eight baseline recommendations.

| Roads choice | Changed cases / 8 | Mean added-time change | Mean normalized curvature change | Mean backroad-share change |
| --- | --- | --- | --- | --- |
| Fast | 4 | -3.68 min | -0.0040 | -0.1942 |
| Balanced | 0 | 0 min | 0 | 0 |
| Curvy | 3 | +0.54 min | +0.0340 | -0.0307 |
| Backroads | 1 | +1.37 min | +0.0189 | +0.0099 |

These are corpus averages, including unchanged cases, not expected gains for
every ride. Curvy's mountain case increased normalized curvature from 0.280 to
0.431 and the longest mapped bend run from 228 m to 312 m, with about 11 extra
minutes inside the existing detour envelope. Other choices have different
tradeoffs; the model does not promise that all measured dimensions improve.

All 64 candidate-order permutation checks held. The sample had zero eligibility
or time-envelope violations and zero automatic-selection mutations. Jev was
disabled in this benchmark. No provider generation or call budgets changed.
The router's graph version was reported as `unknown`; these paired observations
use identical measured bundles, but are not a versioned graph-replay corpus.
Rider preference and physical/on-road quality remain unverified. The private
report stores aggregate measurements and candidate indices, without coordinates,
geometry, credentials or route fingerprints. Final checks and release identity
are recorded separately in the release handoff.

## Explicit non-goals

This slice does not generate new roads, turn a GPX occurrence into access proof,
use Jev to rank or select, infer traffic or junction quality, alter canonical
roles, or introduce a fourth state authority. Corridor/arc-orienteering search,
GraphHopper encoded values, and LM-specific probe penalties remain separate
research tracks gated by a corpus benchmark.
