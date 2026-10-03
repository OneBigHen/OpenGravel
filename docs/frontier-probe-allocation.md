# Frontier probe allocation: a bounded search experiment

Base: public `main@1a04c4661575fded6cde019731a64e75f128f139`.
Status: pure experimental allocator; no production candidate-lane wiring.

## Problem and resulting behavior

Static fastest/scenic/twisty lanes can spend the next provider call on a
near-duplicate. The next call should explore a missing useful tradeoff, such
as sustained curves or flowing backroads, at the same total attempt budget.

`selectNextFrontierProbe()` accepts an already-eligible, canonically measured
candidate pool, positive request-fit preference profiles, caller-supplied
forecast outcomes, and an actual provider-attempt ledger. It returns one probe
ID and its reserved attempt count, or an explicit invalid/exhausted result.
It does not execute a provider, debit a ledger, select a production route,
change scores/roles, or promote forecast features into evidence.

The execution caller must reserve the full worst-case HTTP attempt count
before dispatch, charge actual attempts including failures, retries,
connector legs and fallback requests, and re-run the allocator after the
returned paths pass the canonical pipeline. No corpus-trained forecast is
invented: a cold start yields no useful probe and the caller retains static
lanes. Baseline and explicit authored objectives remain the caller's prior
reservations; this allocator only considers the remaining budget.

## Acquisition rule

1. Reject malformed, unbounded, duplicate or non-finite input. Reject signed
   weights explicitly until an intrinsic-evidence-to-signed-utility adapter
   exists; never clamp a rider's negative preference into a positive profile.
2. Remove attempted and unaffordable probes. Their forecasts cannot define
   the remaining discovery reference.
3. Build a fixed reference of each profile's best usable utility across the
   observed pool and nonzero-probability outcomes of affordable untried probes.
   Include only profiles with usable evidence in the observed representative
   set; an unknown observed utility is never replaced with zero.
4. Reduce the observed pool with the existing exact bounded-regret selector.
   Measure its maximum and mean utility regret against that fixed reference.
5. For each mutually exclusive forecast outcome, tentatively add one candidate,
   reduce with the same selector, and measure the change against the same
   reference. Weight changes by the outcome probability. Unassigned probability
   means no useful returned path and contributes zero gain.
   Reject a probe if a positive-probability outcome loses comparability for
   those fixed profiles.
6. Rank expected maximum-regret reduction per reserved HTTP attempt, then
   expected mean-regret reduction per attempt, then stable probe ID. Reject a
   worsening expected maximum or a numerically zero improvement.

This is an acquisition hypothesis using forecast regret, not measured rider
regret or a guarantee that the next route is better. Individual adverse outcomes
retain their negative contribution. No profile utility is fabricated for
insufficient evidence. Existing `frontierUtility()` coverage semantics remain.

Input bounds are six observed candidates, eight profiles, eight probe forecasts,
three outcomes per probe, one-to-three representatives, and at most 32 reserved
provider attempts. Each tentative pool has at most seven candidates, retaining
the existing selector's exact small-pool path. IDs are unique across observed
and forecast candidates; forecast IDs should use their own local namespace.
IDs are at most 128 characters; the attempted-probe ledger cannot have more
entries than the actual attempts used, and therefore never exceeds 32 entries.

## Verified synthetic cases

The tests use three independent single-axis profiles and an efficient baseline
with `(time, curves, flow) = (.9, .1, .3)`. These are synthetic normalized
qualities, not measured routes or a subjective winner.

| Case | Verified behavior |
| --- | --- |
| Generic outcome `(.9, .11, .3)` versus curved outcome `(.5, .95, .3)` at probability `.8` | Chooses the curve probe. Current worst forecast regret is `.85`; expected reduction is `.68`, mean reduction `.2266667`. |
| Curved probe reserves two attempts but only one remains | Chooses the one-attempt generic probe; retry/connector reservation is honored. |
| Curved outcome has actually entered the measured pool | Reconsiders the remaining tradeoffs and chooses a flow probe. |
| Forecast is unknown or has zero probability | No invented discovery gain; abstains. |
| The observed pool has no usable curve evidence | No invented zero utility; returns `no-comparable-evidence` when no profile is comparable. |
| All attempt capacity is used | Returns `attempt-budget`. |
| No forecasts exist | Returns `no-useful-probe`, preserving cold-start truth. |
| Equal acquisition values with reversed input order | Stable ID tie-break; caller facts remain unchanged. |

Malformed probabilities, excess outcome mass, invalid cost reservations,
duplicate identities, invalid/bounded pool controls, negative/unknown/overflowing
profile weights and invalid ledgers fail closed. Regression tests were developed
through observed failing assertions before the corresponding implementation.

## Route-quality experiment still required

Construct forecast outcomes from leave-one-corridor-out measured history;
do not train on the evaluation corridor or label a recording as liked. Compare
static allocation, this acquisition rule, and one corridor/departure-rejoin
treatment at equal actual HTTP-attempt budgets. Report sustained bends,
ordered flow/interruptions, time/detour, overlap, exact representative regret,
latency, and blinded rider preference. The existing draft scorecard and ordered
road-run PRs are donors for that experiment, not dependencies merged here.

Primary-source research and the generation ladder are in
[2026-10-01-curvy-frontier-routing.md](research/2026-10-01-curvy-frontier-routing.md).
The regret motivation is [Truschel and Storandt, ATMOS 2025](https://doi.org/10.4230/OASIcs.ATMOS.2025.13);
this allocator is an OpenGravel acquisition hypothesis, not that paper's algorithm.

No production route-quality improvement, on-road acceptance, model judgment,
merge or deployment is claimed. RideDocument, PlanningSession, RideSession,
map rendering, canonical policy and PlannerWorkspace ownership are unchanged.
