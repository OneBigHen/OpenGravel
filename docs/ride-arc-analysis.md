# Ride Arc analysis

Status: measurement primitive  
Date: 2026-09-30

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

## Provider data required

Current ProviderRoadSummary is still mostly route aggregate data, with ordered surface/class runs.

That is not enough to derive a trustworthy per-segment worthwhile value.

Before live phase claims, the routing/evidence pipeline needs an ordered road-evidence projection with bounded segments/runs.

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
