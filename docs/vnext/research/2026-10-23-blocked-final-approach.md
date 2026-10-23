# Blocked destination approach: implementation and live evidence

Date: 2026-10-23. Baseline: `origin/main` / `HEAD` before this change,
`3cd5ea675a190589e81333a3f218e382ef54189b`.
Branch: `feat/blocked-final-approach`. Local implementation only; no deployment.
The requested commit could not be created: this worker's managed filesystem makes
`.git` read-only, and `git add` failed creating `.git/index.lock`. All changes remain
in the working tree for the orchestrator to commit. A complete patch is also
available at `/tmp/final-approach.patch`.

## Cause and change

`src/application/route-intelligence/policy.ts:80` correctly rejects a route that
traverses an authoritative motorcycle prohibition. For Hawk Mountain, the live
Pennsylvania Game Commission source supplies the rejecting unnamed road.
`src/server/planning/plan-service.ts:438` previously converted all such empty
candidate pools directly into `no-route`, without distinguishing a blocked final
approach from a blocked road in the middle.

The coordinator now retains every rejecting record's geometry before deduplicating
rider copy. The planner only attempts recovery if every returned candidate fails
exclusively on located authority/access blocks and all those blocks begin within
the last 2 km **or** last 15% of the route. Loops, other eligibility failures,
unknown/unlocated restrictions, and middle-route blocks retain their existing
behavior. Explicit prohibited router road-access runs can also locate a destination
that snapped onto a restricted road; incomplete details and sand do not establish
an access block.

Recovery asks GraphHopper for a fresh route to a point before the first blocked
portion. There are at most three calls within an eight-second optional budget.
Stops, shaping, avoids, road spans, sketch, profile and bike restrictions remain in
the request. The returned endpoint must snap within 125 m of the proposed point.
The entire result passes the original pipeline again, and it cannot overlap the
original blocked road even for less than the authority hard gate's minimum overlap.
Geometry, instructions, distance and ETA all come from the new router answer.
Unknown evidence remains unknown. A failed retry preserves the original error.

The rider sentence travels through candidate `warnings` with code
`destination-final-approach`, survives the existing API provider and planning
controller, and is projected onto the selected route's existing route-choice note
surface (`RouteDecisionCard.tsx`). It also remains a route warning for Ride Focus.
An optional, bounded `destinationLabel` carries the searched destination name.
Authored destination coordinates and plan identity remain the rider's original
request; the returned geometry and warning explicitly describe the shorter finish.

## Live handler proof

GraphHopper health at `http://127.0.0.1:18989/health` returned `OK` before routing.
The harness calls `handleRoutePlanRequest` (the same handler called by
`src/app/api/route-plan/route.ts`) and the real `planRide` pipeline with the live
GraphHopper provider and live authority sources. Authority snapshots are warmed
before each plan, then the normal plan assessment budget applies. No geocoder,
AI, traffic or other optional credentials are injected. Roughly 60 provider calls
were used across baseline and implementation runs, below the requested ~100 cap.

For an independent before run, `git archive` of the exact baseline SHA was unpacked
under `/tmp/ogv-final-approach-baseline`, with the same live harness copied into it
and the installed node_modules linked. The six baseline tests produced exactly two
expected failures: Hawk Mountain returned HTTP 422 for alternatives off and on;
the other four requests succeeded. This is an actual pre-fix handler response,
not an inferred authority verdict. A new deterministic handler regression also
fails against that archived baseline (422 rather than 200), then passes here.

Start for every request: Jim Thorpe, PA `(40.8676, -75.7327)`.
Distances below are straight-line distances from the returned endpoint to the
original POI, measured with the domain `haversine` function.

| Destination / pin (lat, lon) | Before, alternatives off / on | After, off / on | Returned endpoint (lat, lon) | Gap to POI |
| --- | --- | --- | --- | --- |
| Hawk Mountain Sanctuary `(40.6288, -75.9772)` | 422 / 422 | 200 / 200 | `(40.634837, -75.986445)` | 1,029.2 m (0.64 mi) |
| Hickory Run State Park `(41.0262, -75.6966)` | 200 / 200 | 200 / 200 | `(41.026131, -75.696608)` | 7.7 m |
| Ricketts Glen State Park `(41.3352, -76.3016)` | 200 / 200 | 200 / 200 | `(41.335139, -76.301654)` | 8.1 m |

Hawk Mountain before:

> Every route to this destination is blocked. Unnamed Road is not open to motorcycles. Pick a point before it, or another destination.

Hawk Mountain after, through candidate warnings and the route-choice notice:

> Ends 0.6 mi before Hawk Mountain Sanctuary — the last stretch isn't open to motorcycles.

Both after modes return a 47,325.827 m route, 3,017.734 s ETA, with the endpoint above.
The first-answer request uses two provider calls (one baseline, one successful
replan); the alternatives request uses five total. Live authority reevaluation
finds no rejecting records on the returned geometry. The test also guards against
short overlaps with the original blocked road through deterministic tests.

**Proof limit:** the supplied Hickory Run area-office pin and chosen Ricketts Glen
pin are accessible in the current graph/feeds. They are honest unchanged controls,
not two further reproduced no-route-to-shortened-route cases; neither receives an
invented restriction sentence. Two additional *live blocked* park POI recoveries
were not established. No parking lot, property permission, physical arrival,
public deployment, browser or on-road acceptance is claimed.

Reproduce the after run:

```bash
curl http://127.0.0.1:18989/health
mkdir -p /tmp/final-approach-after
OGV_FINAL_APPROACH_LIVE=on \
OGV_FINAL_APPROACH_EVIDENCE_DIR=/tmp/final-approach-after \
GRAPHHOPPER_URL=http://127.0.0.1:18989 \
npx vitest run --config vitest.realrouter.config.mts \
  tests/real-router/final-approach-live.test.ts --maxWorkers=2
```

Full provider answers, source snapshots, handler statuses, warning sentences,
endpoint coordinates, distances and call counts from both runs are retained in
`/tmp/final-approach-before/*.json` and `/tmp/final-approach-after/*.json` in this
worker workspace. Logs: `/tmp/final-approach-before.log`,
`/tmp/final-approach-after.log`, `/tmp/final-approach-baseline-regression.log`.
These transient paths are not release artifacts; the committed harness reproduces
the checks while feeds and graph remain available.

## Gates and review

- `npx tsc --noEmit`: passed.
- `npx eslint` on every touched TypeScript/TSX file: passed.
- Focused `npx vitest run ... --maxWorkers=2`: 11 files / 384 tests passed.
  Covers decision boundaries, sparse geometry, same-name multiple blocks,
  prohibited router snaps, unknown/missing data, sand, retry limits, snap-back,
  preserved request anchors, router failure, closure-specific copy, handler
  validation, warning projection and DOM rendering, plus dependency boundaries.
- Live harness: 6/6 after; baseline 2 expected Hawk failures, 4 accessible controls.
- New deterministic handler regression on archived baseline: expected red (422).
- Independent standards and specification review found no correctness blockers.
  Both requested a true pre-fix handler baseline; the archived-baseline run above
  supplies it. Evidence reviewed
  separately from local/physical/browser deployment claims.
- Full suite, Next build and Playwright were intentionally not run per task limits.
