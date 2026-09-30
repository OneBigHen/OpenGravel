# Frontier Routing — research and implementation spec

Status: **draft / implementation-started**

This document defines the proposed next routing architecture for OpenGravel. It is intentionally broader than "add Jev to routing": the primary problem is candidate generation. A semantic model cannot recommend a great route that the pathfinder never produced.

## Decision summary

OpenGravel should keep GraphHopper 11 as the primary path solver and add a provider-neutral **frontier routing** layer above it.

The target flow is:

```text
RideIntent
  -> hard constraints / authored truth
  -> objective target
  -> bounded search probes
  -> provider candidates
  -> eligibility / closures / access
  -> evidence + normalized quality vectors
  -> Pareto filter
  -> low-regret representative set
  -> geometry diversity
  -> optional rider-personalization modifier
  -> optional Jev semantic tie-break / recommendation
  -> roles + rider presentation
```

Key decisions:

1. **GraphHopper remains the pathfinder.** Do not replace it with an LLM/Jev or a custom shortest-path engine.
2. **OpenGravel owns exploration of route-space.** Generate several deliberately different routing probes instead of trusting one fixed profile and its alternatives.
3. **Unknown evidence is never neutral.** Frontier selection must preserve existing evidence semantics.
4. **Jev is a bounded decision layer, not route authority.** It may judge semantic fit among legal, already-generated candidates. It may never decide access, closure, safety, or geometry validity.
5. **PR #29's preference learner is complementary.** Its posterior can become one input to the objective target / representative-set utility profiles after that work lands. This PR must not duplicate rider memory.
6. **Free Ride gets a separate candidate-generation strategy.** Replace the single projected-ahead destination over time with a bounded forward-sector opportunity search.
7. **Loop discovery should evolve toward approximate arc-orienteering.** GraphHopper's seeded round-trip remains a fallback, while OpenGravel learns to route through high-value road corridors under a time budget.
8. **Do not fork GraphHopper yet.** First prove that stock encoded values + request custom models + better candidate search leave material route quality on the table.

## Why the current architecture hits a ceiling

OpenGravel's current pipeline is strong after candidates exist:

- multiple bounded candidate lanes;
- hard eligibility before ranking;
- route intelligence and evidence;
- deterministic scoring;
- geometry diversity;
- role assignment;
- experimental deterministic "fun" assessment;
- optional Jev character classification.

The weak point is upstream. Current generation is dominated by a small set of persistent profiles:

- `motorcycle_fastest`
- `motorcycle_twisty`
- `motorcycle_scenic`
- `motorcycle_adventure`

For ordinary two-point routing, a lane can also ask GraphHopper's `alternative_route` algorithm for several alternatives.

This means sophisticated OpenGravel scoring can only choose among paths produced by a few fixed cost functions. A road that never appears in those searches cannot win later, no matter how good our scoring, Jev judgment, or rider model becomes.

## Research findings

### GraphHopper 11 is a good substrate

GraphHopper's custom weighting is effectively:

```text
edge_weight =
  edge_distance / (speed * priority)
  + edge_distance * distance_influence
  + turn_penalty
```

The stock graph can expose useful motorcycle-routing inputs including:

- `curvature`
- `road_class`
- `surface`
- `track_type`
- `urban_density`
- `max_speed`
- `average_slope` / `max_slope`
- turn `change_angle` when turn penalties are enabled

OpenGravel already requests several of these as path details.

GraphHopper 11 also supports request-time turn penalties and a POST `/navigate` endpoint that accepts custom models, with explicit examples for Ferrostar. This is strategically useful because route generation and native navigation do not need incompatible routing models.

Sources:

- https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md
- https://github.com/graphhopper/graphhopper/blob/master/docs/core/profiles.md
- https://www.graphhopper.com/blog/2025/10/14/graphhopper-routing-engine-11-0-released/

### Hybrid/LM imposes an important design constraint

GraphHopper merges request custom models onto the server-side profile. With Landmark/hybrid preparation, query-time changes must preserve the preparation's lower-bound assumptions.

In particular:

- query `multiply_by` values must remain in `[0, 1]`;
- query `distance_influence` cannot be lower than the prepared model's value;
- some dynamic parameter/turn-penalty uses require flexible mode or explicit server configuration.

Therefore OpenGravel's dynamic probe system should be designed primarily as **penalties against a permissive base**, not as arbitrary rewards above 1.0.

This is a feature, not a drawback: "the preferred road remains 1.0; less desirable roads are penalized" is easier to reason about and reduces pathological weighting.

### GraphHopper 12 is strategically interesting, but not a current dependency

GraphHopper's current `master` / unreleased 12.0 changelog introduces a server-side custom-model `parameters` section. A profile can define bounded named numbers/booleans, and a request can override their values without repeating the model statements or recompiling the custom model class.

That is very close to the long-term OpenGravel probe shape: one prepared motorcycle frontier model with bounded knobs such as curve penalty, urban penalty, highway penalty, or surface tolerance.

However:

- OpenGravel is currently on GraphHopper 11;
- the 11.0 custom-model documentation does not include `parameters`;
- 12.0 is explicitly not released yet;
- LM/hybrid monotonic-weight restrictions still matter even with parameters.

Therefore R1 must work on GraphHopper 11 using existing request custom models. When GraphHopper 12 is released and stable, benchmark an upgrade before inventing an OpenGravel-specific dynamic-profile protocol.

References:

- https://github.com/graphhopper/graphhopper/blob/master/CHANGELOG.md
- https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md

### Alternative-route alone is not frontier routing

GraphHopper's alternative-route parameters control:

- maximum path count;
- maximum weight factor relative to the best path;
- maximum shared geometry.

The documentation warns that increasing these limits can produce worse alternatives. We should use alternative-route as a bounded provider tool, not as the product's definition of route diversity.

Source:

- https://github.com/graphhopper/graphhopper/blob/master/docs/web/api-doc.md

### Multi-criteria routing supports a small representative frontier

Multi-objective route planning naturally creates Pareto sets: a path may be slower but twistier, calmer, less urban, or more compatible with the requested surface. Pareto sets can become very large.

Truschel and Storandt (ATMOS 2025) show a useful product-oriented idea: use **regret minimization** to retain only a specified number of representative paths while providing guarantees for constrained and personalized query styles.

OpenGravel does not need to port their exact algorithm initially. A small deterministic approximation can:

1. remove clearly dominated candidates;
2. score the remaining candidates against several bounded utility profiles;
3. greedily choose the small set that minimizes worst remaining regret;
4. apply the existing geometry-diversity gate.

Source:

- https://doi.org/10.4230/OASIcs.ATMOS.2025.13

### Time-budget loops map naturally to arc-orienteering

The classic shortest-path objective is the wrong abstraction for "I have 90 minutes; give me the best ride and return me here."

Arc Orienteering asks for a route under a cost/time budget that maximizes collected edge value. "Scenic Routes Now" demonstrates approximate arc-orienteering on large road networks and notes that exact solutions are impractical at scale.

OpenGravel should use the concept without implementing an exact NP-hard solver:

- precompute / derive road-corridor value dimensions;
- find high-value reachable areas under the time budget;
- choose a few anchor combinations with beam search;
- let GraphHopper solve paths between anchors;
- evaluate the returned full route with canonical OpenGravel evidence.

Source:

- https://arxiv.org/abs/1609.08484

### BRouter is useful research, not a migration target

BRouter is attractive because its profiles are highly configurable and there are open motorcycle experiments. Existing motorcycle-oriented BRouter projects tend to use explicit penalties for urban/service roads and tune turn costs to avoid fake "curvy" routes created by zig-zagging through towns.

That is a useful design lesson, but replacing GraphHopper would discard current work around:

- the existing provider port;
- GraphHopper road details;
- custom model constraints;
- round-trip calibration;
- native navigation alignment;
- the deployed PA/NJ graph and future US graph.

BRouter's own stock `moped` profile still labels itself experimental and warns about missing turn restrictions. Use BRouter as an offline benchmark lane in the routing lab, not the production foundation.

Sources:

- https://github.com/abrensch/brouter
- https://github.com/abrensch/brouter/blob/master/misc/profiles2/moped.brf
- https://github.com/mzluzifer/motorrad-routenplaner

## Target architecture

### 1. Separate authored constraints from search preference

Hard facts remain where they are today:

- access;
- closures;
- avoid areas / road spans;
- bike/surface hard envelope;
- timebox;
- destination/stops;
- legal constraints.

A new provider-neutral search objective only expresses **how to explore valid route-space**.

Suggested semantic target:

```ts
interface RouteObjectiveTarget {
  efficiency: number;       // 0..1
  curvature: number;        // 0..1
  flow: number;             // 0..1
  backroads: number;        // 0..1
  gravel: number;           // 0..1
  elevation: number;        // 0..1
  trafficCalm: number;      // 0..1
  novelty: number;          // 0..1, post-route unless graph support exists
}
```

The rider never sees this representation. It is derived from explicit ride intent plus, later, a bounded personalization prior.

### 2. Generate bounded search probes

Instead of equating rider-facing character with one persistent GraphHopper profile, OpenGravel generates a small probe set around the target.

Initial probe basis:

| Probe | Purpose |
| --- | --- |
| Direct | reference / time-efficient baseline |
| Flow | continuous backroads, fewer urban/junction artifacts |
| Twisty | maximize meaningful curvature within detour bounds |
| Backroad | rural/smaller-road character without forcing maximum curvature |
| Adventure | surface-seeking only when current ride intent permits it |

Rules:

- baseline/direct always exists;
- max 3–4 probes per planning request initially;
- a probe is one search question, not a rider-facing label;
- do not generate a probe that duplicates the resolved objective;
- novelty remains post-route until the graph has honest per-edge personal-history data;
- current traffic can rerank candidates before it becomes a routing edge cost;
- engine-specific GraphHopper expressions stay in infrastructure.

### 3. Prefer one best path per probe initially

Today an ordinary lane can ask `alternative_route` for up to three paths. Combining many dynamic probes with three alternatives each creates a candidate explosion and spends budget on near-duplicates.

First frontier implementation should test:

```text
3–4 probes
x
1 primary path each
=
3–4 deliberately different raw candidates
```

Then selectively enable one alternative-route expansion only when:

- the probe's primary route is promising;
- candidate count is below the global cap;
- diversity is still poor.

This is a better budget than "four profiles times three alternatives."

### 4. Normalize each surviving route into a quality vector

The first scaffold in this PR uses:

- time efficiency;
- curvature;
- flow;
- backroad character;
- surface fit;
- gravel affinity;
- traffic flow;
- junction flow;
- novelty.

All are normalized to `[0, 1]` where larger means "better" for the relevant dimension.

Important: an unavailable dimension stays `null`. The selector never turns missing evidence into 0.5.

### 5. Pareto filter before a single weighted total

Candidate A dominates B only if:

- enough dimensions are known for both;
- A is no worse on every comparable dimension;
- A is strictly better on at least one.

Dominated candidates are not useful rider choice and should not survive merely because they came from a distinct provider profile.

### 6. Choose a low-regret representative set

From the Pareto survivors, choose at most three candidates that cover a bounded utility-profile set such as:

- efficient;
- flowing;
- twisty;
- backroad;
- adventure;
- explore/new-to-me.

The implementation scaffold uses a deterministic greedy k-regret approximation. It is intentionally application-layer code and provider-neutral.

After PR #29 lands, a sufficiently confident rider posterior can be added as one more utility profile. Explicit current-ride intent remains stronger than learned history.

### 7. Keep geometry diversity after value diversity

Regret/Pareto selection answers "are these meaningfully different in ride quality?"

The existing MMR/geometry diversity answers "are these actually different roads?"

We need both.

Initial ordering:

```text
eligible candidates
  -> value vector
  -> Pareto filter
  -> representative low-regret shortlist
  -> geometry diversity
  -> max 3 rider-visible routes
```

We should benchmark the reverse order as well, but value-first avoids preserving geometrically different yet uniformly worse routes.

## Jev's role

Jev should not generate edge weights or road geometry.

Its best routing role is bounded semantic judgment after deterministic truth exists.

A route-selection Jev request can receive:

- rider request / current semantic intent;
- three legal candidate IDs;
- normalized aggregate evidence;
- detour/time facts;
- optional small rider preference posterior projection.

Questions should be typed:

```text
best_match: Choice(A, B, C, NONE)
fit_A: Score(poor, marginal, good, excellent)
fit_B: Score(...)
fit_C: Score(...)
meaningful_upgrade_A: Noul
...
```

Jev output is advisory policy input. Low confidence, timeout, or invalid output falls back to deterministic frontier selection.

Rollout:

1. shadow;
2. compare;
3. bounded tie-break only when deterministic candidates are close;
4. broader recommendation role only after route-corpus evaluation.

Do not call Jev per GPS sample.

Official TypeSafe SDK references:

- https://github.com/typesafe-ai/typesafe-sdk-js
- https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts

## Free Ride redesign

Current Free Ride constructs a short destination roughly straight ahead and asks the canonical route provider for alternatives. This is cheap and safe, but it searches for alternate ways to reach an arbitrary projected point rather than asking which upcoming branch opens a better riding opportunity.

Target: **forward-sector opportunity search**.

### Phase A — bounded sector probes

At a qualified opportunity event:

1. require existing GPS quality, movement, workload and cooldown gates;
2. generate a bounded forward fan around current heading;
3. select at most 2–3 endpoint probes;
4. route short candidates through the canonical provider;
5. extract each candidate's first meaningful decision;
6. dedupe by decision intersection + outgoing road/direction;
7. assess canonical evidence;
8. optional Jev interrupt-value judgment;
9. show/speak at most one opportunity.

Do not query on every GPS update. Re-evaluate only when:

- candidate fingerprint set changes materially;
- rider intent changes;
- the prior opportunity expires;
- cooldown permits another decision.

### Phase B — road-value-aware sector anchors

Once OpenGravel has a road-value spatial index, choose forward anchors from promising nearby road corridors instead of geometric fan points.

That makes the search "what interesting ride is ahead?" rather than "what paths reach three arbitrary points?"

## Loop / Quick Ride redesign

GraphHopper `round_trip.seed` should remain a robust fallback, not the final discovery algorithm.

Target loop generation:

```text
origin + time budget
  -> reachable coarse cells/corridors
  -> road-value candidates
  -> bounded anchor combinations
  -> beam search
  -> GraphHopper through anchors
  -> canonical eligibility/evidence
  -> time-fit calibration
  -> Pareto/regret/diversity
  -> visible loop options
```

Road/corridor value should be multidimensional, not one opaque ML score:

- bend density / curvature quality;
- flowing-curve quality;
- road-class character;
- junction density;
- signal density;
- urban density;
- elevation variation;
- surface character;
- verified gravel affinity;
- baseline traffic quality where available;
- novelty/personal history as a rider-local overlay.

Use reward saturation so riding five adjacent segments of the same valued corridor does not unrealistically count as five independent discoveries.

## GraphHopper custom encoded values: later, only if proven necessary

Stock GraphHopper custom models cannot consume arbitrary new OSM-derived attributes unless those attributes are imported as encoded values. GraphHopper maintainers describe adding a TagParser/encoded value in Java as the standard path for custom tags.

Possible future OpenGravel values:

- `og_curve_flow`
- `og_road_value`
- `og_gravel_confidence`
- `og_motorcycle_affinity`

But a fork has real costs:

- graph format/import changes;
- build and upgrade burden;
- US import time;
- larger graph;
- new correctness surface.

Gate a fork on evidence from the routing lab: stock attributes + better search must demonstrably fail on a repeatable route corpus first.

Reference:

- https://discuss.graphhopper.com/t/how-to-add-custom-osm-tags-as-encoded-values-without-modifying-the-graphhopper-source/9256

## GraphHopper adapter work required

The current TypeScript `GraphHopperCustomModel` type models `priority`, `speed`, and `areas`, but GraphHopper 11 also supports `distance_influence` and `turn_penalty`.

This PR begins by extending the adapter's type vocabulary without changing current routing behavior.

Follow-up wiring needs:

1. provider-neutral probe/search-bias contract in `src/application/planner`;
2. server/wire validation for bounded probe parameters;
3. GraphHopper translation from probe -> penalty-only custom model;
4. deployment verification for:
   - `turn_costs`;
   - `allow_turn_penalty_in_request: true`;
   - encoded values used by every rule;
   - LM preparation constraints;
5. real-router tests against the live PA graph.

## Interaction with PR #29 rider preference learning

PR #29 learns a local posterior from explicit pairwise feedback and weak behavioral signals.

This routing work should consume it at two optional points:

### Candidate-generation target

A confident preference vector can nudge which probes are selected.

Example: a rider who reliably prefers curvature and calm backroads can cause `Flow` and `Twisty` probes to run instead of a generic `Backroad` probe.

This nudge must be bounded and cannot override an explicit current request.

### Representative-set utility profile

Add the current rider posterior as one low-regret profile alongside the fixed archetypes.

This lets personalized preference choose among facts we already measured without feeding learned preference back into evidence itself.

Anti-feedback-loop rule:

> learned preference may affect search and utility; it may never rewrite measured route evidence.

## What not to build

Do not:

- train an end-to-end neural route generator;
- send graph geometry to Jev and ask it to invent roads;
- make Jev a closure/access authority;
- create dozens of GraphHopper persistent profiles;
- create a new product surface called "Frontier";
- expose routing probe names to riders;
- let unknown evidence become an average score;
- treat "rider used this road" as "rider likes this road";
- fork GraphHopper before the stock engine is benchmarked;
- run exact multi-objective orienteering over the continental road graph.

## Evaluation plan

### Route corpus

Build a checked-in fixture manifest with representative classes, not merely happy-path city pairs:

- suburban escape;
- Delaware River / rolling backroads;
- dense urban avoidance;
- mountain/twist-heavy destination;
- paved backroad route;
- mixed/gravel route;
- sparse surface metadata;
- closure/access conflict;
- short 45–90 minute loop;
- 2–4 hour loop;
- Free Ride upcoming intersection scenarios.

The fixture should identify origin/destination/time budget and invariant expectations, not hard-code one perfect polyline.

### Candidate-generation metrics

Track:

- candidates generated;
- deduped candidates;
- Pareto survivors;
- geometry overlap;
- unique road share;
- best canonical score;
- best deterministic fun score;
- detour;
- timebox error;
- evidence coverage;
- provider visited/latency diagnostics where available.

### Selection metrics

Track:

- regret across fixed utility profiles;
- agreement with explicit rider A/B labels;
- deterministic vs Jev selected route;
- Jev confidence/calibration;
- route changes caused by learned preference;
- false personalization caused by sparse evidence.

### Free Ride metrics

The most important metric is **false interruption rate**, not number of suggestions.

Also track:

- missed high-value branches;
- repeated-road suggestions;
- U-turn/behind rejection;
- opportunity lifetime;
- Take rate as descriptive telemetry only;
- response latency from candidate-set change to decision.

### Non-negotiable correctness gates

- zero route eligibility regressions;
- zero closure/access authority delegated to Jev;
- zero missing-evidence fabrication;
- current baseline remains available when experimental generation fails;
- cancellation propagates exactly as it does today;
- no model key or rider history sent to the client wire unintentionally.

## Rollout plan

### R0 — research/scaffold (this PR)

- add this architecture/spec;
- add provider-neutral Pareto + greedy low-regret selector;
- extend GraphHopper custom-model TypeScript vocabulary for future `distance_influence` / `turn_penalty`;
- no rider-visible behavior change.

### R1 — dynamic probe lab

- define provider-neutral probe/bias types;
- map them to bounded GraphHopper custom models;
- add a feature gate;
- generate probes in shadow alongside current lanes;
- log only aggregate diagnostics needed for evaluation.

### R2 — frontier selection shadow

- project canonical evidence into frontier vectors;
- compare current route roles vs Pareto/regret shortlist;
- build PA/NJ corpus reports.

### R3 — controlled planner experiment

- let frontier generation provide alternatives;
- preserve current deterministic baseline;
- keep Jev shadow-only initially.

### R4 — Jev compare/tie-break

- one bounded Jev call per stable planner candidate set;
- compare against deterministic and rider-labeled corpus;
- promote only if calibration and latency are acceptable.

### R5 — Free Ride sector search

- replace straight-ahead-only candidate discovery behind a gate;
- deterministic eligibility first;
- Jev interrupt-value shadow;
- hard cap route calls and suggestions.

### R6 — value-seeking loops

- road-value coarse index;
- anchor beam search;
- calibrated GraphHopper loop construction;
- seeded round-trip remains fallback.

### R7 — GraphHopper fork decision

Fork only if the corpus shows repeatable missed quality attributable to missing per-edge data that cannot be represented with stock encoded values/custom areas.

## Success criteria

Frontier routing is ready to become the default only when it can demonstrate, on the same corpus:

1. no hard-constraint regressions;
2. materially better rider-labeled route preference than current fixed lanes;
3. meaningful route diversity, not cosmetic geometry differences;
4. no substantial latency regression for the first usable route;
5. bounded CPU/request count suitable for self-hosting;
6. deterministic fallback with Jev disabled;
7. stable results when evidence is sparse;
8. compatibility with native navigation and rerouting.

The product principle is:

> **GraphHopper solves paths. OpenGravel explores route-space and establishes truth. Personalization describes the rider. Jev makes bounded semantic judgments.**
