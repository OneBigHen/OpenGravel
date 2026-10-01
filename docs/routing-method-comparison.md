# Trying routing methods

Plan a ride, then open **Compare routing methods** beneath the route cards.
On a phone, first open **Compare rides** to expand the choices. Pick a method
to read its explanation, then press **Show this route** to select its suggested
route. Inspecting a method does not change the ride or its selected route.

These are comparisons of at most three eligible choices from the same planning
attempt. To search for different roads, change Ride style and replan. Methods
can agree, particularly when the available road network offers few alternatives.

| Option | What it does | Limits |
| --- | --- | --- |
| Classic | Shows the normal application recommendation. | Uses the existing score, roles and rider preferences. |
| Frontier | Uses the exact bounded regret selector around your Roads choice: Fast, Balanced, Curvy or Backroads. Curvy also weighs sustained bend sections when every compared route has measured run lengths. | Requires measured curvature and backroad values. Missing continuity is left out of the common comparison; traffic/junction qualities remain unknown. |
| Sustained curves | Suggests the eligible choice with the longest measured run of bends. | Geometry estimate; does not prove uninterrupted traffic, road condition or safety. Zero measured bends differs from missing continuity. |
| Jev's read | Names the character of one already-scored route using aggregate features. | Advisory only; confidence is uncalibrated, and unavailable readings do not affect planning. It neither creates nor automatically selects a route. |

Experimental deterministic picks stay within the canonical Best Ride detour
envelope on destination rides. For loops they use the same authored or default
timebox as the planner, including its closest-valid-route behavior when no
choice fits. Destination added time uses the fastest eligible route shown;
loop added time uses the fastest choice within the same timeboxed comparison.
Check the route's actual estimated time, surface evidence and existing warnings.

Retained results from a superseded or failed attempt cannot be applied through
the comparison panel. The panel identifies them as the previous ride and asks
the rider to replan. Jev readings are bound to a current attempt and candidate
fingerprint, never carried across a new generation as labels for another route.
Responses must echo the captured ride, revision and generation. A current primary
route remains comparable while its optional alternatives load quietly.

## Ownership

`routing-method-comparison.ts` is a pure, read-only application projection.
The planner view model restricts it to visible route cards and derives whether
the answer is current. `RoutingMethodComparison.tsx` holds disclosure and radio
presentation state only. Its selection callback uses the existing
PlanningSession selection action. RideDocument, PlanningSession and RideSession
remain the three authorities.

Advisory transport data is validated, bounded and copied from an allowlist.
It travels in provider diagnostics, outside candidate scores, eligibility,
evidence and roles. Direct TypeSafe uses frozen `jev-1.13.0`; no latest/preview
alias is accepted. Requests retain aggregate-only input, the existing 1.5-second
deadline, zero retries and existing cache/call budget. This is the character
classifier; the separate Jev frontier order/replay audit remains research.

The experimental comparison profiles are defined in `frontier-comparison-policy.ts`.
They do not replace RoutePolicy or automatic planning. Bend-run metrics are
measured from returned geometry and propagated as estimated diagnostic evidence;
the existing curvature score normalization stays unchanged.

Curvy's continuity quality combines the longest run's share of bend metres and
its share of the measured route. One short isolated bend cannot earn a perfect
continuity score just because it is the route's only bend. Missing run lengths
remain unknown; if any comparable choice lacks them, continuity is left out for
all choices. The weights and geometry proxy are comparison heuristics, not
calibrated rider preferences. See [the research and evaluation note](frontier-routing-quality.md).

## Research that is not runnable here yet

Library corridors and departure/rejoin generators need provenance-preserving,
licensed contiguous road data plus verified connectors. A GPX attraction prior
does not establish access or passability. Ride Arc needs ordered worthwhile-road
evidence before it can report trustworthy core riding minutes. Neither is
presented as a runnable routing method in this release.

The bounded probe allocator remains separate research in #53. Forecasts must
first be calibrated against observed canonical route quality and actual provider
attempts before it can be dispatched by the live planner.

## Donor slices

- #38: sustained-bend metrics, adapter propagation and evidence tests, keeping
  the existing curvature scoring shape.
- #54: only the frozen direct model identity, character-classifier transport
  validation and its regression tests. The broader #51/#54 Jev frontier evaluator,
  replay artifacts and production-selection restrictions remain separate.

Required verification includes all repository gates, relevant planner critical
flows in Chromium and WebKit, responsive interaction checks, and a live router
comparison. Browser emulation and Mac WebKit do not establish physical on-road
acceptance or measured preference/calibration gains.
