# Ordered road evidence runs

Status: provider evidence transport  
Date: 2026-09-30  
Dependency: curvature-continuity work

## Problem

OpenGravel's GraphHopper adapter already receives rich path details in route order:

- surface;
- road class;
- road environment;
- urban density;
- curvature ratio;
- toll;
- speed limits.

But most of those values are reduced into whole-route totals before the application layer sees them.

Whole-route totals can answer:

> How much gravel is on this route?

They cannot honestly answer:

> How long until the good riding begins?

or:

> Is the curvy/backroad character sustained in the middle, or scattered through urban connectors?

Ride Arc phase analysis therefore needs bounded **ordered** evidence.

## Change

ProviderRoadSummary gains optional `roadRuns`.

One run contains raw provider facts in travel order:

- metres;
- duration seconds;
- surface;
- road class;
- road environment;
- urban density;
- curvature ratio;
- toll state.

Consecutive geometry steps with identical raw attributes are merged.

The run list is capped at 512. A pathological route that exceeds the cap omits `roadRuns` entirely rather than truncating the route and creating dishonest phase order.

## Time

The request now includes GraphHopper's built-in `time` path detail.

This is preferable to inventing segment duration from distance or requesting a profile-specific encoded speed key.

GraphHopper's TimeDetails is generated from the active weighting per traversed edge and includes turn-time penalties.

An edge may contain multiple response-geometry steps. OpenGravel allocates that edge's time across its geometry steps proportional to their distance, then merges adjacent equal-attribute steps.

This allocation is diagnostic segmentation. The route's authoritative total duration remains GraphHopper's path time.

If the active provider omits the time detail, run duration is `null`.

## Semantics

These fields remain raw routing evidence.

Examples:

- `secondary` is not automatically "good";
- `rural` is not automatically scenic;
- a low curvature ratio is not automatically a safe/fun corner;
- `gravel` is not automatically appropriate for the current bike;
- `missing` remains missing.

Application policy must derive any `worthwhile` segment value used by Ride Arc.

## Why this is stacked on curvature continuity

GraphHopper's encoded `curvature` is an edge-level straight-line/road-length ratio.

It is useful evidence, but short OSM edges can make a winding road look locally straight.

The curvature-continuity work measures the returned geometry itself and should remain the stronger signal for sustained bending character.

Ordered provider runs add road context and time; they do not supersede geometry.

## Next adapter

After this and Ride Arc analysis land, build one application-layer projection:

    ProviderRoadRun[]
      + geometry bend runs
      + current RideIntent
      + canonical access/closure evidence
            |
            v
       RideArcSegment[]
            |
            v
       analyzeRideArc()

Do not put that classification inside the GraphHopper adapter.

## Expected product use

When evidence coverage is sufficient:

> 11 min out · 58 min good roads · 13 min home

When it is not:

do not show phase-specific road-quality copy.

The UI should never turn provider-data availability into fake certainty.
