# Quick Ride pilot — implementation and ride-test spec

Status: implementation-ready product spec  
Parent: `docs/adventure-world-layer.md`  
Initial geography: Southeast Pennsylvania, then central-PA dual-sport

## Goal

Quick Ride should solve one job extremely well:

> **Turn a spare block of time into a motorcycle ride that feels worth taking.**

The engine is not optimizing for distance.

It is optimizing for:

- fun minutes
- uninterrupted flow
- appropriate surface
- some novelty/variety
- predictable return time
- low planning effort

## Primary success metric

### Fun-minute ratio

Estimate how much of the planned ride is spent on roads that meet the rider's selected mood.

```text
funMinuteRatio =
  estimated minutes on matching/worthwhile road segments
  ------------------------------------------------------
                 total estimated ride minutes
```

A short ride with a higher fun-minute ratio should usually beat a longer route with more filler.

This metric is internal first. The UI can phrase it naturally:

> **54 min of backroads · 13 min getting there/home**

Do not expose a fake precise "fun score 93/100."

## Secondary metrics

For each candidate calculate:

```ts
interface QuickRideMetrics {
  totalMinutes: number;
  returnBufferMinutes: number;

  funMinutes: number;
  boringMinutes: number;
  urbanEscapeMinutes: number;

  newExplorableMiles: number;
  notRecentlyRiddenMiles: number;
  gravelMiles: number;
  curvyMiles: number;

  maneuverCount: number;
  maneuverDensityPer10Miles: number;
  signalCountEstimate: number;
  backtrackMiles: number;

  accessUnknownMiles: number;
  seasonalRiskMiles: number;

  candidateOverlap?: number;
}
```

## Time-budget contract

Input:

```ts
interface QuickRideRequest {
  origin: Coordinate;
  hardBudgetMinutes: 45 | 60 | 90 | 120 | number;
  backBy?: string;

  mood: "curves" | "new" | "gravel" | "scenic" | "surprise";
  surface: "paved" | "mostly-paved" | "mixed" | "dirt-ok";

  avoidHighways: boolean;
  stopBudgetMinutes: number;
}
```

Default reserve:

```text
reserve = max(8 min, ceil(hardBudget * 0.10))
target = hardBudget - reserve
```

Never use the reserve to make the planned route look better.

It exists for:

- a missed turn
- slow traffic
- getting geared up / leaving a parking lot
- an unexpected train crossing
- a brief stop
- route-estimation error

## Candidate generation

Generate many internal loop candidates, but return exactly three.

Each returned candidate should represent a real choice, not minor geometry variations.

Suggested families:

1. **Best flow**
2. **Most new**
3. **More surface/adventure**

For a paved-only rider, candidate 3 becomes scenic/quiet rather than dirt.

### Diversity gate

Do not show two candidates whose ridden geometry is effectively the same.

Initial gate:

```text
shared explorable distance < 70%
```

If three genuinely different candidates do not exist inside the time budget, show two.

Do not manufacture a bad third option.

## Route utility

First-pass candidate score:

```text
utility =
    0.26 * funMinuteRatio
  + 0.15 * flowScore
  + 0.14 * noveltyScore
  + 0.10 * surfaceMatch
  + 0.09 * scenicContext
  + 0.08 * returnConfidence
  + 0.07 * notRecentlyRiddenScore
  + 0.06 * explorationCoherence
  + 0.05 * discoveryValue

  - urbanFrictionPenalty
  - accessPenalty
  - backtrackPenalty
  - maneuverSpamPenalty
  - majorArterialPenalty
  - timeOverrunPenalty
```

Weights are tuning knobs, not product truth.

## Novelty score

Novelty is useful until it starts degrading the ride.

Suggested saturation:

```text
0% new roads     -> 0.00
10%              -> 0.45
20%              -> 0.75
30%              -> 0.95
40%+             -> 1.00
```

This prevents the route generator from chasing every unvisited lane.

Only `ExplorableRoad` segments count.

## Recent-repeat score

Eventually the rider will exhaust most genuinely new roads near home.

The app must remain useful.

Add a time-decaying repeat penalty:

```text
ridden today       strong penalty
< 7 days           medium penalty
7–30 days          light penalty
30–90 days         almost neutral
> 90 days          neutral
favorite road      rider preference can override
```

This creates route rotation without pretending an old road is "new."

Useful language:

> **Mostly roads you haven't ridden lately**

## ExplorableRoad

The exploration graph should be a curated subset of the routable graph.

```ts
interface ExplorableRoad {
  edgeId: string;
  roadId?: string;
  eligible: boolean;

  funEvidence: {
    curvature?: number;
    lowJunctionDensity?: number;
    terrain?: number;
    gravel?: number;
    scenicContext?: number;
    knownRidingCorridor?: number;
  };

  access: {
    status: "known-open" | "known-restricted" | "unknown";
    authority: string | null;
    seasonal?: boolean;
  };
}
```

Initial exclusions unless needed as connectors:

- parking aisles
- service roads
- driveways
- ordinary subdivision streets
- tiny residential loops
- private roads
- roads with known restrictions
- dead-end branches without an actual destination/reason

Do not count motorway mileage as exploration.

## Flow score

"Curvy" must not become "make me turn at every intersection."

Reward:

- curves along the same road
- continuous backroad corridors
- fewer required navigation maneuvers
- fewer stop-controlled intersections
- longer uninterrupted segments
- sensible loop geometry

Penalize:

- left-right-left zig-zags
- rapid road-name changes
- U-turns
- repeated use of the same junction
- artificial doglegs added only to increase curvature
- constant local-street navigation prompts

A good riding road bends.

A bad generated route makes the rider keep turning.

Those are not the same thing.

## Urban friction / escape cost

Approximate friction from available graph/map evidence:

- traffic-signal count
- junction density
- road class
- major commercial corridors
- lower expected moving speed
- repeated stops
- live congestion where available

Evaluate the first and final legs separately.

```ts
interface EscapeSummary {
  outboundMinutes: number;
  goodRoadMinutes: number;
  returnMinutes: number;
}
```

Potential UI:

> **9 min out · 58 min backroads · 11 min home**

This is a very strong short-session explanation.

## Surface behavior

"Gravel" should mean useful gravel, not random 500-foot alleys.

Count gravel toward the route objective only when it is:

- a meaningful segment length
- legal/routeable
- compatible with the selected motorcycle/surface setting
- not just an unpaved parking/service connector

Surface uncertainty must be shown.

Example:

> **12 mi mapped gravel · 3 mi surface uncertain**

## Discoveries

A discovery may improve a route, but it is never allowed to ruin the time budget.

For a 60-minute ride:

- default stop budget = 0
- roadside/pass-by discoveries are preferred
- no detour offer over roughly 5 minutes unless explicitly enabled

For 90–120 minutes:

- one short optional detour can be considered
- the detour still has to fit inside the reserve policy

The right discovery is something the rider naturally passes.

## 3D landmark policy

3D objects are map landmarks, not objectives.

Initial archetypes:

- covered bridge
- fire tower
- dam
- water tower
- tunnel
- lookout structure
- ferry
- historic mill
- wind turbine

Each archetype has:

- GLB asset
- fallback symbol
- min/max zoom
- maximum screen-size
- max simultaneous instances
- priority

No model should obscure:

- route
- maneuver arrow
- closure/access warning
- rider puck

## "Surprise me"

Surprise mode should not mean random.

It chooses among the rider's existing safe preferences with a controlled novelty bias.

Example policy:

```text
40% best flow
25% more new
15% scenic
15% surface variation within rider setting
5% oddball/high-confidence discovery
```

Never surprise the rider with:

- unrequested technical dirt
- uncertain access
- much longer time
- a ferry with uncertain operation
- a road class they explicitly avoid

## Mystery Loop

Potential P1 experiment.

The route is fully planned and reviewable, but the rider can choose:

> **Keep the loop a surprise**

Ride Focus then reveals normal turn-by-turn navigation without showing the complete path constantly.

This can add some game feeling without adding collectibles.

Requirements:

- full route is always available via one explicit action
- no hidden access/surface surprises
- rerouting works normally
- return-time budget remains visible

Do not ship until normal Quick Ride is proven.

## Free Ride budget guard

Free Ride can run with or without a time box.

With a time box:

```ts
canOfferDetour =
  estimatedHomeTimeAfterOffer
  <= requestedBackBy - minimumRemainingReserve
```

When false:

- no fun detours
- no discovery offers
- normal navigation / Head Home remain

Potential prompt:

> **You've used your ride buffer. Head-home suggestions only.**

No scolding language.

## Rider feedback

Post-ride, make personalization almost effortless.

Optional:

```text
How was the route?

[ Great ] [ Fine ] [ Not for me ]
```

Then optionally:

```text
Road highlight:
[ ★ Pineville Rd ]
[ ★ River Rd ]
```

Allow a rider to mark:

- favorite
- avoid
- surface wrong
- access wrong

Do not require per-road ratings.

## PA ride-test matrix

### Test 01 — 45-minute paved escape

Origin: suburban Southeast PA  
Mood: Curves  
Surface: Paved  
Goal: prove the app can find something worth doing when the radius is small.

Pass:
- planned route <= 37 min target
- no unnecessary highway
- low maneuver spam after urban escape
- route is not just subdivision completion
- return buffer visible

### Test 02 — 60-minute "new roads"

Origin: suburban Southeast PA  
Mood: New roads  
Surface: Mostly paved

Pass:
- novelty only on explorable roads
- candidate is still objectively reasonable
- no >5 min discovery detour
- at least two candidate families if geography permits

### Test 03 — 90-minute mixed KLR loop

Mood: Surprise / mixed  
Surface: Mixed

Pass:
- meaningful gravel segments
- mapped uncertainty disclosed
- no illegal/private access
- at least one route candidate that remains mostly paved

### Test 04 — 120-minute scenic loop

Mood: Scenic  
Stop budget: 10 min

Pass:
- one worthwhile stop/pass-by node
- stop does not consume return reserve
- scenery evidence does not overwhelm road quality

### Test 05 — repeat rider

Rider has already ridden most top roads nearby within the last month.

Pass:
- app rotates corridors using recency decay
- does not chase junk roads for novelty
- favorite/strong roads may repeat
- language changes from "new" to "haven't ridden lately" when appropriate

### Test 06 — closure consumes buffer

During ride, closure/reroute adds 11 minutes.

Pass:
- fun detour offers stop
- new route preserves fastest reasonable return
- rider sees updated home estimate/buffer
- progression tracking continues normally

### Test 07 — central PA authority

Route approaches a state-forest road/trail with seasonal rules.

Pass:
- legal/seasonal authority wins over exploration desire
- unknown is displayed as unknown
- prior rider history does not imply current access

## Instrumentation for development

Privacy-preserving metrics worth collecting only with telemetry opt-in:

- requested ride budget
- candidate selected
- planned vs actual duration
- planned vs actual return buffer
- candidate overlap
- fun-minute estimate
- percent new explorable road
- reroute count
- offer shown / accepted / ignored
- post-ride Great/Fine/Not for me
- abandoned route before start

Do not need exact long-term ride history on the server to tune the product.

## P0 acceptance gate

Do not build the 3D landmark system until at least ten real short-session rides satisfy most of these:

- route created in seconds
- rider starts without manual waypoint editing
- actual return time stays reasonably inside requested budget
- route has noticeably less boring/urban friction than naive loop generation
- novelty does not create junk routing
- three candidates feel meaningfully different
- rider would choose Quick Ride again

The feature should first be fun as plain lines on a plain map.

Then make it beautiful.
