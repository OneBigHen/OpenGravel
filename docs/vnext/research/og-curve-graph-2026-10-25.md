# Local `og_curve` graph — 2026-10-25

Columns are **curvy miles / Franco per km / minutes** from the app's selected Best Ride.
HTTP attempts count actual requests, including loop calibration and retries.

| Ride | Mode | Current graph | `og_curve` graph | HTTP attempts current / new |
| --- | --- | --- | --- | --- |
| Jim Thorpe → Hawk Mountain | Balanced | 3.22 / 37.34 / 51.86 | 3.22 / 37.34 / 51.86 | 6 / 6 |
| Jim Thorpe → Hawk Mountain | Curvy | 3.22 / 37.34 / 51.86 | 3.22 / 37.34 / 51.86 | 10 / 10 |
| Jim Thorpe 120-minute loop | Balanced | 6.68 / 102.16 / 117.14 | 6.68 / 102.16 / 117.14 | 52 / 53 |
| Jim Thorpe 120-minute loop | Curvy | 6.68 / 102.16 / 117.14 | 6.68 / 102.16 / 117.14 | 35 / 35 |
| Allentown → Stroudsburg | Balanced | 3.56 / 32.83 / 63.57 | 4.49 / 60.13 / 67.71 | 6 / 6 |
| Allentown → Stroudsburg | Curvy | 5.14 / 114.39 / 84.24 | 4.49 / 60.13 / 67.71 | 10 / 10 |
| Doylestown → New Hope | Balanced | 0.91 / 38.14 / 29.08 | 0.85 / 39.94 / 25.65 | 6 / 6 |
| Doylestown → New Hope | Curvy | 0.85 / 60.59 / 25.83 | 1.09 / 50.54 / 26.24 | 10 / 10 |
| Reading → Jim Thorpe | Balanced | 10.19 / 76.30 / 116.16 | 8.67 / 52.04 / 113.16 | 6 / 6 |
| Reading → Jim Thorpe | Curvy | 10.19 / 76.30 / 116.16 | 8.67 / 52.04 / 113.16 | 10 / 10 |
| Bethlehem → Delaware Water Gap | Balanced | 5.09 / 72.15 / 70.93 | 4.36 / 53.80 / 67.67 | 6 / 6 |
| Bethlehem → Delaware Water Gap | Curvy | 4.84 / 87.84 / 72.49 | 4.36 / 53.80 / 67.67 | 10 / 10 |

**Verdict: HOLD for rollout.** The durable encoded-value/import path works, but this
model does not improve either target Jim Thorpe ride. Balanced Allentown gains
26% bend miles and 83% Franco/km for 4.14 extra minutes; Reading and Bethlehem
lose both bend miles and density. Curvy Allentown's density falls from 114.39 to
60.13. No general route-quality improvement or rider preference is established.
The Balanced loop spent 52 versus 53 HTTP attempts and is not an equal-spend
quality trial. All other pairs spent equal attempts. These are measurements,
not promotion acceptance; no live graph or deployment changed.

## Request-wiring follow-up

Identical Best Rides were traced to the unchanged Adventure candidates, not an
ignored encoded value. All eight Jim Thorpe plans (two graphs × two styles ×
destination/loop) were traced again and their selected geometry hashes matched
provider-source candidates. The destination's old graph has the same line from
both Twisty and Adventure; on the new graph, only Adventure supplies that winner.
Both loops select Adventure on both graphs.

| Check | Direct evidence |
| --- | --- |
| Actual app request | `motorcycle_twisty`, exact public endpoints, request `custom_model.priority` for traffic/surface/access/tolls. The same initial Twisty body is sent by Balanced and Curvy to both graphs. |
| Baked model ignored? | No. GH 11's `DefaultWeightingFactory` calls `CustomModel.merge(profile.getCustomModel(), queryCustomModel)`; it copies the baked model and appends request priority rules. Requests contain no distance/speed replacement or `ch.disable`/`lm.disable` flags. Profiles retain LM preparation and no regional CH. |
| Exact-wire replay, :8989 → :8991 | **3.22 / 37.34 / 51.86 → 2.94 / 17.65 / 52.88** (curvy mi / Franco/km / min); geometry hashes differ. Adding only the `og_curve` detail leaves the treatment geometry and weight identical to the exact-wire replay. |
| `og_curve` path details on new Twisty line | `[0,11,0]`, `[11,17,0.067]`, `[17,849,0]`; the nonzero interval is **145.51 m**. Start/end coordinates and full interval dump are in the evidence. |
| Strong request penalty: `og_curve < 0.001` × `0.01` | Geometry changes again; **55.01 min / 3.01 curvy mi / 12.56 Franco/km**, weight **11,100.38 → 836,143.30**. |
| Strong penalty at `<0.15` or `<0.4` | Geometry stays unchanged, but weight rises to **844,295.46**. Every edge on this returned path is below both cutoffs, so these tests mostly impose a uniform time penalty. |
| Same `og_curve` expression against :8989 | HTTP **400**, explicitly `'og_curve' not available`; the expression is not silently discarded. |

**Interpretation:** wiring is active, but the returned Twisty line has too little
encoded signal to distinguish edges at the baked 0.15/0.4 thresholds. Its new
line is worse under the unchanged geometry measurements, and the app retains
Adventure's identical winner. HOLD therefore remains a **signal/profile-quality**
result. No adapter/profile-dispatch repair was warranted, and the original
six-ride comparison was not replaced with a different experiment.

[Exact request, selected-source hashes, path-detail dump and penalty probes](og-curve-wiring-2026-10-25.json).
The opt-in `og-curve-wiring-live.test.ts` passed on powerplex; TypeScript and
focused ESLint passed. No product-routing code, graph, or baked model was changed
by this follow-up, and no live router was contacted or deployment performed.

## What changed

Branch `feat/og-curve-graph` continues the explicitly requested
`feat/fun-best-ride@3fb2b69c0e63644d8233518647e01689588f8b95`.
The pre-pass joins shared normalized names/individual refs at degree-two nodes,
including reversed ways and road-class/ref-list changes. It ports the app's
unchanged Franco-v1 bands/noise filter, applies symmetric rejection and 30 m
junction/control suppression, clips affected segment portions, and computes a
centred 400 m moving window. Residential/service/living-street and `_link`
variants earn no curve credit.

Compressed cumulative **local** integrals are stored in bounded `og:curve` tag
chunks. Original IDs, node lists, relation members and tags remain intact;
there is no way splitting or turn-restriction rewrite. The TagParser integrates
only the actual GH edge's endpoints and quantizes a direction-independent
four-bit decimal to `1/15`. Unique endpoints tolerate interior simplification;
ambiguous repeated-coordinate occurrences earn zero. One long GH edge retains
one length-weighted average, not a maximum propagated over straight miles.

The shared scenic/twisty model penalizes dull edges, non-rural areas and
residential/service roads; every new multiplier is at most one. Balanced and
Curvy use these lanes through the existing app pipeline. Fastest/adventure
model bytes, speeds, access checks, time/exposure caps and scores are unchanged.
No new app policy is promoted. Regional preparation remains LM; a persisted
small fixture additionally verifies CH/flexible weight equivalence.

## Provenance and reproduction

GraphHopper builds, regional preprocessing/import and app gates ran only on
powerplex (`ssh windows-zac`, WSL Ubuntu user `zachary`).
`~/ghbuild-curve` resolves to `/mnt/wsl/ogv-data/home-zachary/ghbuild-curve`.
The existing `~/ghbuild` graph/models/config were copied into `control` and
served on WSL loopback `:8989`; treatment is `graph-cache-og-curve-window`,
`config-window.yml`, served on `:8991`. Neither is the live router.

- Runtime jar SHA-256: `b59c024afe172ec6ec85b6327006c3138ec58c7d0bcd26253d0e42853f613def`.
- Original extract SHA-256: `bcf75b9308da24ab6942afc9fdbfa1abbd4e464f7cf20e426e594b1910dbc76a`.
- Prepared extract SHA-256: `ce4751e6dcb6a6e62805c8db845904f44afd055bc57cc88af544879765a96cdb`.
- Scoring source SHA-256: `3f7054a822fa854dbaafbf6d54d96c76e14bd81d810388bfdceec7a9cbeee3da`.
- Both graphs: 3,625,018 nodes, 4,514,563 edges, 60,360 turn-cost entries.
  Node, geometry and turn-cost files are byte-identical (hashes in JSON evidence).
- Pre-pass: 2,141,605 ways, 2,050,912 collections, 6m46s wall time, 3.51 GiB peak
  RSS, 24 GiB address-space ceiling. Import completed at 02:08; its original
  streaming log was interrupted by quota exhaustion, so no final import timing
  is claimed. Runtime reload and prepared LM queries verified the finished graph.

The app benchmark checks version/region/profiles/data date, uses identical
source/options/fixed request IDs, and captures canonical scores and paired
deltas. IDs: `fun-best-destination`, `fun-best-loop-120`, then
`og-curve:<corpus-id>` for the four named corpus rides. Direction is **Jim Thorpe
→ Hawk Mountain**, matching the parent diagnosis. Both modes use the default
touring bike, Mixed surface, gravel allowed, rough tracks avoided, toll avoidance
and protect-ride traffic. Corpus highway avoidance is retained; loop 120 ± 15 min.

Optional closure authority and AI are disabled equally. Gravel Atlas is absent
on powerplex, explaining why the control loop differs from the parent's
atlas-assisted docker-dev result. These are not paved-only or current legal
clearance results. The adapter's environment key is `GRAPHHOPPER_URL`; this
comparison supplies both URLs directly to its factory.

[Full machine evidence](og-curve-graph-2026-10-25.json) ·
[Build/pre-pass reproduction](../../../infra/graphhopper/ext/README.md).

```sh
# In the isolated app checkout on powerplex, with both servers running:
OGV_CURVE_BENCHMARK=1 OGV_CURVE_CONTROL_URL=http://127.0.0.1:8989 \
OGV_CURVE_TREATMENT_URL=http://127.0.0.1:8991 \
OGV_CURVE_EVIDENCE=../benchmark-final.json \
npm run test:real-router -- tests/real-router/og-curve-benchmark-live.test.ts
OGV_CURVE_ENGINE_URL=http://127.0.0.1:8991 \
npm run test:real-router -- tests/real-router/og-curve-engine-live.test.ts
```

## Verification

- 24/24 app benchmark cases passed validity/timebox/cap checks; six regional
  LM/flexible queries with penalty-only request models returned equal weights/times.
- Full graph audit: all 3,489,430 residential/service/living-street edges have
  zero curve credit; every encoded value is finite and bounded.
- Nine Python/PBF tests passed, including shared Franco fixtures, reversed-way
  continuity, local straight tails, controls, chunk limits and unchanged
  nodes/way references/restriction members. Ten Java parser fixtures passed.
- Small real import/persist/reload: stock loader, LM and CH weights agree with
  flexible routing (674.9026462222223); overwriting an existing graph is refused.
- Final app gates passed: environment audit, lint (one existing unused-variable
  warning), typecheck, 5,248 tests with three existing skips, 149 architecture
  checks, and production build. No browser/on-road or live-deployment claim.

## Future rollout and rollback — not executed

**Do not roll out this candidate on these results.** After separately authorized
quality acceptance, use the [exact operations appendix](../../../infra/graphhopper/ext/ROLLOUT.md):

1. On the actual serving host, identify the unique container mounting the
   live `/root/Vibe/switchback/data/graph-cache` path. Save its image/jar digest,
   config/model mount sources, graph hashes and paired app policy/release.
   This task did not inspect or contact that live router.
2. Stop the isolated candidate, stream a complete graph/jar/model/config/hash
   unit to a new staging directory, verify hashes and run a free-port canary.
   Rebuilds stay on powerplex. Preserve the existing live ports/binds/paths.
3. In an authorized stop, stop the identified router, rename the current graph
   to `graph-cache-rollback-<artifact-id>`, put the staged graph at the original
   mount source, install the matching config and entire model directory, then
   restart the qualified runtime. Promote a reviewed code-owned policy version
   and graph ID through the normal app release process.
4. Verify health, fingerprints, public planning behavior, access checks and the
   six-case comparison. On any failed gate, stop the replacement, move its graph
   aside, restore the saved graph/config/models/container and paired app release,
   restart, and recheck the original fingerprints and fixed requests.

Rollback requires no rebuild and never deletes/overwrites the previous graph.
