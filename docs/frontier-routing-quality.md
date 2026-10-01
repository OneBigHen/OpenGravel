# Frontier routing quality slice

Status: **research recommendation for the next implementation slice**

The live opt-in Frontier comparison already does several things correctly: it
starts from eligible canonical candidates, treats missing quality as `null`,
filters conservatively on Pareto dominance, and chooses a small representative
set with deterministic exact enumeration while the frontier is bounded. Those
properties should remain intact. The next improvement should make the utility
profiles reflect the rider's authored intent and make "curvy" distinguish
continuous riding sections from a route that merely accumulates many isolated
bends.

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

The live comparison then uses one fixed `efficient`/`curvy`/`backroads` profile
set for every ride ([source](../src/application/planner/routing-method-comparison.ts#L49-L54)).
It computes a continuity value, but the fixed profiles do not include the
vector's `flow` axis, so continuity cannot affect Frontier selection. The
`flow` value is currently `longestRunMeters / curvyMeters`; when a route has a
small amount of curved geometry, that ratio can be one even though the run is
too short to represent a sustained ride section
([comparison projection](../src/application/planner/routing-method-comparison.ts#L61-L83),
[geometry evidence](../src/application/roads/engine-road-evidence.ts#L107-L119)).

The existing domain already has the right intent boundary. `roadCharacter` is
one of `efficient`, `balanced`, `curvy`, or `backroads`, while surface, traffic,
and bike constraints remain authored intent with their own eligibility and
policy semantics ([ride types](../src/domain/ride/types.ts#L109-L160),
[route policy](../src/domain/route/policy.ts#L105-L210)). The Frontier layer
should consume these values; it should not redefine them.

## One coherent implementation slice

Add a pure application function that builds a small, ordered profile
neighborhood from the current `RideIntent`. Feed that neighborhood into the
existing `selectLowRegretRepresentatives` call. Keep the profile IDs and order
versioned and stable, for example:

| Intent | Primary profile | Supporting profiles |
| --- | --- | --- |
| `efficient` | time efficiency with modest curve/backroad terms | balanced and continuity |
| `balanced` | current policy's balanced mix | efficient and continuity |
| `curvy` | total curvature plus sustained-curve continuity | efficient and backroad |
| `backroads` | backroad character with surface fit and modest continuity | efficient and curvy |

The primary profile should be a positive-weight projection of the existing
route policy. It must not be a second ranking policy: the canonical policy still
owns eligibility, roles, and the automatic selection. The two supporting
profiles preserve a small amount of choice around the explicit request and
prevent a single profile from hiding a useful tradeoff. Surface preference and
traffic preference may adjust the projection only within their existing
eligibility and warning rules. Novelty remains a post-route evidence axis until
the graph contains honest per-edge history.

The `curvy` primary profile should use both total curve density and a separate
continuity axis. A route's total curve value remains the existing normalized
curvature measurement. For a measured bend run, define the continuity proxy as:

```text
runShare = clamp(longestRunMeters / totalMeters, 0, 1)
sustainedCurve = sqrt(continuityShare * runShare)
```

`continuityShare` remains the measured longest run divided by all bend metres.
`runShare` supplies the missing scale: a single 40 metre bend on a long route
cannot receive the same continuity value as a long connected bend section. The
geometric mean keeps either weak signal from being hidden by the other. This is
a deterministic geometry proxy, not a safety, pavement, traffic, or rider
enjoyment claim. Keep it separate from total curvature so a route with many
short bends can remain visible as a different tradeoff.

Only use `sustainedCurve` when `longestRunMeters`, `curvyMeters`, and
`totalMeters` are finite and mutually valid. When the continuity measurement is
absent, leave the axis `null`. Do not replace it with zero, an average, or a
provider default. A profile may be evaluated only when its weighted evidence
coverage reaches the existing threshold. If too few candidates have common
continuity evidence for the primary profile, omit that profile from the
comparison or return the existing honest unavailable caveat; do not let a
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

Research on robust shortest paths treats uncertain costs as a distinct modeling
problem with explicit uncertainty criteria. It supports keeping missing route
evidence visible as uncertainty rather than silently treating it as either a
good or bad value; it does not justify choosing a pessimistic value for OpenGravel
without a versioned policy and corpus evidence
([primary robust-shortest-path paper](https://doi.org/10.1016/S0305-0548(97)00085-3)).

The continuity split also follows a useful route-shape distinction: accumulated
curvature and a continuous curvature/run signal answer different questions. Path
planning literature treats continuity of curvature as a separate path-quality
property, while road-geometry studies show that curve radius and sequence affect
driver demand; neither establishes a rider-safety claim for this product
([continuous-curvature path planning](https://doi.org/10.1155/2017/2521638),
[road-geometry driver-demand study](https://doi.org/10.3141/1737-09)).

Candidate generation remains a follow-up. GraphHopper custom models are useful
for bounded provider probes, but the current slice should not claim that a new
LM penalty, encoded value, or corridor search is live. Any generator experiment
must still return through canonical eligibility, evidence, and the same
provider-neutral selector ([GraphHopper custom-model documentation](https://github.com/graphhopper/graphhopper/blob/11.0/docs/core/custom-models.md)).

## Tests and small real-router benchmark

The implementation should first add application tests around the pure profile
builder and comparison seam:

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

Then run a private real-router corpus of roughly 8–12 named PA/NJ area pairs
covering a direct corridor, a rural corridor, a bend-rich corridor, a mostly
straight corridor, and a loop budget. The harness should generate routes and
discard geometry after computing aggregate records. Track only:

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

## Explicit non-goals

This slice does not generate new roads, turn a GPX occurrence into access proof,
use Jev to rank or select, infer traffic or junction quality, alter canonical
roles, or introduce a fourth state authority. Corridor/arc-orienteering search,
GraphHopper encoded values, and LM-specific probe penalties remain separate
research tracks gated by a corpus benchmark.
