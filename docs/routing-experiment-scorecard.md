# Routing experiment scorecard

Status: common evaluation contract  
Date: 2026-09-30

## Why this exists

OpenGravel now has several plausible route-space generators:

- profile lanes;
- one library-corridor probe;
- equal-budget lane replacement;
- departure-and-rejoin replacement;
- missing-link discovery;
- bounded corridor-prize loop search;
- directed Free Ride network opportunities.

That is enough algorithm breadth for the first serious routing program.

The next failure mode would be worse than lacking algorithms: allowing each experiment to declare success using a different metric.

This scorecard makes every route-generation experiment answer the same questions.

## Three separate questions

### 1. Did the experiment run fairly?

First prove:

- same provider-call budget for control and treatment;
- both arms produced a selected route;
- both selected routes passed hard eligibility.

If not, do not calculate a treatment delta.

A four-call treatment does not beat a three-call control. It bought more search.

### 2. What changed in the route?

Measure independently:

- duration;
- distance;
- canonical deterministic RouteScore;
- worthwhile/core-riding minute ratio;
- sustained bend share;
- maneuvers per 10 miles;
- immediate backtracking share;
- self-overlap share;
- timebox error;
- planning latency.

Generator-specific proof stays visible:

- source-corridor adherence;
- preserved baseline share for departure/rejoin.

Do not collapse these into another OpenGravel "experiment score."

A treatment adding 10 minutes and 20 percentage points of worthwhile riding is a real tradeoff. Review should see both numbers.

### 3. Did the rider actually prefer it?

Record blinded rider choice separately:

- control;
- treatment;
- tie;
- not rated.

This is the quality label the routing experiments ultimately exist to improve.

A canonical score improvement without rider preference is useful diagnostic evidence, not proof that the rider experience improved.

## Machine contract

`routingExperimentScorecard()` produces one trial.

`aggregateRoutingExperimentScorecards()` summarizes repeated trials for one generator without inventing a winner.

Unknown measurements remain `null`.

The aggregate reports:

- trial count;
- valid-trial count;
- equal-budget count;
- rider-rated count;
- rider preference counts;
- mean known metric deltas;
- mean corridor adherence where relevant;
- mean baseline preservation where relevant.

## How to score a candidate set (use this)

Every generator experiment calls ONE function per corpus case:

```ts
import { scoreExperimentCase } from "@/application/planner/routing-experiment-measure";

const { scorecard, control, treatment } = scoreExperimentCase({
  caseId: "hawk-mountain-jim-thorpe",          // ROUTING_QUALITY_CORPUS id
  generator: "library-corridor-v1",
  control:   { providerCalls: 4, planningLatencyMs, candidates, selectedCandidateId },
  treatment: { providerCalls: 4, planningLatencyMs, candidates, selectedCandidateId },
  // riderPreference: "control" | "treatment" | "tie" | "not-rated"
});
```

Each candidate is an `ExperimentCandidateInput`: `id`, `eligible`,
`canonicalScore` (RouteScore.total or null), `distanceMeters`,
`durationSeconds`, `geometry`, optional `instructions`, `roadSummary` (keep the
provider's — its `roadRuns` feed Ride Arc), `timeboxSeconds` for loops,
`worthwhile` (canonical per-run judge; absent → Ride Arc stays null), and the
generator-specific `corridorAdherenceShare` / `preservedBaselineShare`.

`measureExperimentCandidate()` measures one candidate the same way (geometry bend
detector for sustained bends, `analyzeRideCoherence()` for coherence and Ride
Arc). Aggregate trials with `aggregateRoutingExperimentScorecards(generator, scorecards)`.

### Against the production baseline (live)

`tests/real-router/routing-baseline.ts` exports
`runProductionBaselineCase(entry, { baseUrl, roadCharacter })`: it runs one
corpus case through the real production planner (`planRide`), counts provider
calls and returns the candidate set plus the Classic (automatic winner),
Frontier and Sustained-curves picks. Use it as the control arm:

```ts
const baseline = await runProductionBaselineCase(entry, { baseUrl, roadCharacter: "curvy" });
scoreExperimentCase({
  caseId: entry.id, generator: "my-generator",
  control: baseline.arm(baseline.frontierId),        // or baseline.classicId
  treatment: { providerCalls: baseline.providerCalls, candidates: mine, selectedCandidateId },
});
```

Regenerate the committed baseline (sequential, ~4 calls per case, ~7 s):

```sh
ROUTING_BASELINE_OUT=docs/vnext/research/<date>-routing-baseline-frontier.json \
  ./node_modules/.bin/vitest run --maxWorkers=1 --config vitest.realrouter.config.mts \
  tests/real-router/routing-baseline-live.test.ts
```

The 2026-10-03 numbers are in
[docs/vnext/research/2026-10-03-routing-baseline-frontier.md](vnext/research/2026-10-03-routing-baseline-frontier.md).

## Direction of deltas

Every numeric delta is:

    treatment - control

Interpretation therefore depends on the metric.

Usually higher is favorable:

- canonical score;
- worthwhile-minute ratio;
- sustained bend share.

Usually lower is favorable:

- maneuvers per 10 miles;
- backtracking;
- self-overlap;
- timebox error;
- planning latency.

Duration and distance are explicit costs, not automatically good or bad.

## Promotion discipline

Do not promote a routing generator because one route looks impressive.

Recommended development progression:

### Shadow

- run on corpus;
- no rider-visible behavior change;
- prove generator mechanics and adherence.

### Blinded review

- hide engine/profile/generator identity;
- compare route shapes and known tradeoffs;
- record control/treatment/tie.

### Physical ride

Use representative cases:

- suburban escape;
- short local ride;
- flowing paved backroads;
- twisty mountain route;
- mixed/gravel;
- repeat/familiar roads;
- time-boxed loop;
- route with a deliberate off-route/rejoin event.

### Limited default influence

Only after repeated equal-budget trials show useful rider preference without unacceptable regressions.

Do not require every metric to improve. The point is to understand the exchange.

## Suggested generator-specific gates

These are evaluation hypotheses, not canonical production policy.

### Library corridor

Must show:

- high corridor adherence;
- distinct route-space compared with generic lane;
- reasonable added time;
- rider preference often enough to justify replacing one generic provider call.

### Departure/rejoin

Must show:

- high corridor adherence;
- high unaffected-baseline preservation;
- no new backtracking/dogleg pathology;
- the replaced middle is actually worth its added time.

### Missing link

Must first prove the connector independently:

- endpoint fit;
- access/closure eligibility;
- acceptable coherence;
- reasonable stretch.

Only then evaluate the full combined route.

### Corridor-prize loop

Must show:

- timebox remains reliable;
- connector share stays bounded;
- worthwhile-minute ratio improves;
- self-overlap/backtracking does not rise materially;
- rider prefers it to seeded round-trip generation.

### Free Ride network opportunity

Measure a different outcome:

- opportunity was actually ahead;
- route recovered the proposed corridor;
- suggestion arrived before the decision point;
- no U-turn;
- interruption rate stays low;
- Take rate among shown high-confidence suggestions;
- ignored suggestions are not treated as negative preference labels.

## PA/NJ corpus integration

The permanent real-router corpus should eventually emit this scorecard schema for control/treatment experiment runs.

Baseline corpus cases already cover:

- Allentown -> Stroudsburg;
- Hawk Mountain -> Jim Thorpe;
- Doylestown -> New Hope;
- Harrisburg -> Lancaster;
- Reading -> Jim Thorpe;
- West Chester -> Lancaster;
- Bethlehem -> Delaware Water Gap;
- Cherry Hill -> Batsto Village.

Expand only when a failure reveals a missing geography/problem class.

Do not grow a giant benchmark merely to have more rows.

## Human-quality corpus

Machine metrics will never fully encode "that road was annoying."

For ridden comparisons, capture only lightweight labels:

    Which route would you take again?
    [ A ] [ Same ] [ B ]

Optional section-level feedback:

    Best road
    Bad road
    Surface wrong
    Access wrong

That is enough to connect whole-route preference back to corridor learning without asking a rider to rate twenty dimensions.

## North-star

The long-term objective is not maximum score.

It is:

> At the same routing-call and time budget, OpenGravel more often finds the route a rider would choose again, with fewer incoherent maneuvers and less interaction required to get there.

That is measurable.
