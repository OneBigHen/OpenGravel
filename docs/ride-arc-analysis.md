# Ride Arc and coherence analysis — canonical contract

Status: canonical diagnostic contract (measurement only)  
Date: 2026-09-30, consolidated 2026-10-03 (PRs #35 + #49 over #50)

This is the **one** definition of Ride Arc phases and route coherence in
OpenGravel. Other docs (notably [rider-first-routing-strategy.md](rider-first-routing-strategy.md))
point here instead of defining their own metrics.

## Entry point

```ts
import { analyzeRideCoherence } from "@/application/planner/ride-coherence";

const diagnostics = analyzeRideCoherence({
  geometry,            // returned route line
  instructions,        // provider turn instructions (optional)
  roadSummary,         // ProviderRoadSummary; roadRuns enable the arc
  worthwhile,          // (run, index) => 0..1 | null — canonical policy, caller-owned
  arcOptions,          // optional analyzer thresholds
});
// diagnostics = { schemaVersion: 1, path, orderedEvidence, arc, arcUnavailable }
```

| Field | Source | Meaning |
| --- | --- | --- |
| `path` | `src/domain/route/coherence.ts` (#35) | U-turns, geometry reversals, maneuvers/10 mi, short legs, alternating doglegs, road-name changes, endpoint directness, immediate backtracking share, self-overlap share, shadow flags. Instruction-derived values are `null` when the provider sent no instructions. |
| `orderedEvidence` | `ProviderRoadSummary.roadRuns` (#50) | Run count and the share of metres with GraphHopper edge time. `null` when no ordered runs came back. |
| `arc` | `src/application/planner/ride-arc-analysis.ts` (#49) | Escape / core / terminal phases and `worthwhileMinuteRatio`. |
| `arcUnavailable` | this contract | `no-ordered-evidence`, `no-edge-time`, `no-worthwhile-policy` or `malformed` — exactly when `arc` is `null`. |

Rules:

- The contract never decides that a road is worthwhile. The caller passes a
  judge built from canonical road policy; without one the arc is
  `no-worthwhile-policy`, never a guess. **No canonical judge exists yet**, so
  every live baseline currently reports `worthwhileMinuteRatio = null`.
- A run without provider edge time makes the whole arc `no-edge-time`: phase
  minutes with a hole in the clock are not honest.
- Diagnostics only. Nothing feeds RouteScore, eligibility, roles or the
  production winner. Experiments read it through the routing scorecard
  (`measureExperimentCandidate()` / `scoreExperimentCase()`).

### What was consolidated and dropped

- Kept: #49's analyzer as the only phase/worthwhile definition; #35's
  path-coherence detector as the only pathology definition; one wrapper
  (`analyzeRideCoherence`) that reports both side by side.
- Dropped from #35's strategy doc: its own `escapeEfficiency` ("minutes until
  first sustained high-value corridor") and `worthwhileMinuteRatio`
  ("**estimated** minutes in high-value core corridors / total") formulas. They
  contradicted #49's known-only definition; the doc now links here.
- Changed in #35's detector: missing instructions used to report zero
  maneuvers/U-turns/doglegs ("no workload"); they now report `null`.
- Dropped from this doc: the "Provider data required" gap — #50's ordered
  `roadRuns` with edge time now supply the ordered substrate.

## Goal

Make the phase-aware routing thesis measurable:

    ESCAPE -> CORE RIDE -> RETURN / ARRIVAL

The current Quick Ride fallback of evaluating the middle 70% of geometry is intentionally simple. It prevents unavoidable local egress from dominating loop quality, but it cannot tell where worthwhile riding actually begins or ends.

`analyzeRideArc()` replaces that assumption with an ordered-evidence contract.

## Important boundary

The analyzer does **not** decide that a road is good.

It accepts ordered segments whose `worthwhile` value was already derived from canonical OpenGravel road evidence/policy.

That input should eventually consider known/estimated dimensions such as:

- road character / class;
- sustained curvature;
- junction flow;
- traffic context;
- requested surface;
- current access/closure status;
- terrain/bike compatibility.

If those facts are unknown for a segment, `worthwhile=null`.

The analyzer never converts unknown into 0.5.

## Core detection

A core is a sustained run of worthwhile road, not one attractive fragment.

Default diagnostic policy:

- worthwhile threshold: 0.65
- short connector bridge: <= 2 minutes
- minimum known worthwhile core time: 8 minutes
- minimum worthwhile share inside core: 60%
- minimum ordered-evidence coverage before any phase claim: 60%

These are experiment defaults, not production policy.

The primary core is selected by:

1. most known worthwhile seconds;
2. least bridged filler;
3. longest total core duration;
4. earliest route position.

## Unknown evidence

Unknown time remains in the denominator of `worthwhileMinuteRatio`.

Example:

- 40 min total
- 20 min known worthwhile
- 10 min known low-value
- 10 min unknown

reports:

    worthwhileMinuteRatio = 20 / 40 = 0.50

not 20 / 30 and not an invented estimate of the unknown ten minutes.

If total ordered-evidence coverage is below the configured threshold, the result still reports the known/unknown/worthwhile totals, but:

- coreDetected = false
- escape = null
- core = null
- terminal = null

This prevents UI copy such as "58 min backroads" when the app cannot actually support that segmentation.

## What this enables

When evidence is strong enough, Quick Ride can truthfully summarize:

> 11 min out · 58 min good roads · 13 min home

A destination ride can use the same phases, with `terminal` interpreted as arrival rather than return.

The route score remains separate.

## Routing use later

Do not immediately optimize directly against the detected phase boundary.

First use it as replay/reporting evidence:

- compare profile routes;
- compare library corridor treatments;
- compare departure/rejoin;
- compare corridor-prize loops.

Only after real ride testing should the generator actively search for:

- shorter escape time;
- longer worthwhile core;
- smaller terminal filler.

Otherwise the optimizer may learn to game the phase detector.

## Provider data

Ordered evidence comes from `ProviderRoadSummary.roadRuns` (see
[ordered-road-evidence-runs.md](ordered-road-evidence-runs.md)): travel-order
runs of raw surface / road class / environment / urban density / curvature /
toll with GraphHopper edge time. `rideArcSegmentsFromRoadRuns()` turns them into
arc segments using the caller's judge. Raw engine values stay raw; the judge is
where canonical policy decides what they mean for the current ride intent.

Do not reconstruct "good roads" from aggregate percentages.

## Product use

The best UI is not a phase diagram.

Use the measurement to simplify decisions:

Quick Ride card:

> 78 min  
> 10 min out · 56 min ride · 12 min home

Planner comparison:

> +9 min total  
> +17 min worthwhile roads

Post ride:

> 52 min on the roads this route was built around

Only show such copy when evidence coverage supports it.

## Free Ride

Ride Arc also gives the live copilot a time context:

- during escape, optional suggestions need to materially improve access to the core;
- inside core, avoid interrupting merely to trade one good road for another;
- during return pressure, protect the time promise and suppress optional detours.

That phase behavior should remain derived from the active ride/time intent, not become a new rider-facing mode.
