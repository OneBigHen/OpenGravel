# Local `og_curve` graph — 2026-10-25

Latest calibrated candidate; columns are **curvy miles / Franco per km / minutes**
from the app's selected Best Ride. Δ minutes is treatment minus control.

| Ride | Mode | Current graph | Calibrated `og_curve` | Δ minutes | HTTP attempts current / new |
| --- | --- | --- | --- | --- | --- |
| Jim Thorpe → Hawk Mountain | Balanced | 3.22 / 37.34 / 51.86 | 2.94 / 17.65 / 52.88 | +1.01 | 6 / 6 |
| Jim Thorpe → Hawk Mountain | Curvy | 3.22 / 37.34 / 51.86 | 2.94 / 17.65 / 52.88 | +1.01 | 10 / 10 |
| Jim Thorpe 120-minute loop | Balanced | 6.68 / 102.16 / 117.14 | 6.46 / 93.05 / 125.49 | +8.35 | 52 / 52 |
| Jim Thorpe 120-minute loop | Curvy | 6.68 / 102.16 / 117.14 | 6.46 / 93.05 / 125.49 | +8.35 | 35 / 34 |
| Allentown → Stroudsburg | Balanced | 3.56 / 32.83 / 63.57 | 4.49 / 60.13 / 67.71 | +4.14 | 6 / 6 |
| Allentown → Stroudsburg | Curvy | 5.14 / 114.39 / 84.24 | 4.49 / 60.13 / 67.71 | -16.53 | 10 / 10 |
| Doylestown → New Hope | Balanced | 0.91 / 38.14 / 29.08 | 0.85 / 39.94 / 25.65 | -3.44 | 6 / 6 |
| Doylestown → New Hope | Curvy | 0.85 / 60.59 / 25.83 | 1.00 / 105.79 / 35.33 | +9.50 | 10 / 10 |
| Reading → Jim Thorpe | Balanced | 10.19 / 76.30 / 116.16 | 8.99 / 43.88 / 115.94 | -0.22 | 6 / 6 |
| Reading → Jim Thorpe | Curvy | 10.19 / 76.30 / 116.16 | 8.67 / 52.04 / 113.16 | -3.00 | 10 / 10 |
| Bethlehem → Delaware Water Gap | Balanced | 5.09 / 72.15 / 70.93 | 4.36 / 53.80 / 67.67 | -3.25 | 6 / 6 |
| Bethlehem → Delaware Water Gap | Curvy | 4.84 / 87.84 / 72.49 | 4.15 / 58.70 / 59.29 | -13.20 | 10 / 10 |

**Verdict: HOLD for rollout.** Calibration reaches the winning candidate pool:
both Jim Thorpe Best Rides now change, but both become worse. The destination
loses 8.7% curvy miles and 52.7% Franco/km for **1.01 extra minutes**; the loop
loses 3.3% curvy miles and 8.9% Franco/km for **8.35 extra minutes**. Balanced
Allentown gains 26% bend miles and 83% Franco/km for 4.14 minutes; Curvy
Doylestown gains 17% bend miles and 75% Franco/km for 9.50 minutes. Reading and
Bethlehem still regress. No general route-quality improvement is established.
The Curvy loop spent 35 versus 34 HTTP attempts, so that pair is not an equal-spend
quality trial; all other pairs, including the Balanced loop, spent equal attempts.
Passing validity/timebox checks is not promotion acceptance. Live router untouched;
nothing deployed.

## Calibration and cost

The read-only physical-edge scan weights each edge once by stored distance,
regardless of direction. It includes car-accessible non-residential road edges
with positive length, excludes OTHER/RESIDENTIAL/SERVICE/LIVING_STREET and
PRIVATE/NO access, and includes motorways. This is the provided PA/NJ extract,
not legal-clearance evidence. Quantiles are the first 1/15 bin reaching the
specified cumulative fraction of eligible length; zero-valued edges stay in
the denominator.

| Population | Edges | Length km | Zero length share | p50 | p75 | p90 | p97 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All eligible non-residential roads — cutoff source | 978,210 | 160,453.25 | 89.52% | 0 | 0 | 0.066667 | 0.4 |
| Known PAVED/ASPHALT/CONCRETE secondary/tertiary/unclassified | 261,792 | 36,408.46 | 96.77% | 0 | 0 | 0 | 0.066667 |
| Adventure-eligible paved-or-unknown backroads | 614,728 | 89,152.30 | 95.63% | 0 | 0 | 0 | 0.066667 |

The **all-non-residential population**, not a positive-only or Adventure subset,
supplies the cutoffs. Its positive-only p50/p75/p90/p97 are 0.2/0.466667/0.8/1;
using those would discard the zero-inflation problem. p97 is descriptive and
is not a third model cutoff. Because p50 is tied at zero, `< p50` penalizes
nothing; use inclusive comparisons:

- `og_curve <= 0` × 0.5, retaining the existing motorway exemption.
- `og_curve <= 1/15` × 0.75.
- Above p90: no curve penalty (× 1). The independent rules compose to 0.375
  at zero and 0.75 at the first positive bin on non-motorway roads.

Scenic/Twisty keep their urban and residential/service penalties. Adventure now
uses these same two curve rules on SECONDARY/TERTIARY/UNCLASSIFIED with surface
MISSING/PAVED/ASPHALT/CONCRETE/PAVING_STONES/COBBLESTONE. Residential, service,
living-street, primary, trunk, motorway, known unpaved and OTHER-surface edges
are outside the new Adventure guard. Existing dirt rewards, access, speed,
bike constraints and app time/exposure caps stay unchanged. Every **added curve
multiplier** is <=1; existing Adventure dirt rewards of 1.45/1.25 remain baked.
Fastest's model bytes are unchanged, and direct Fastest geometry, time and
weight match control for all three engine-test pairs.

**Scope assumption:** missing surface on a backroad is included as a backroad
heuristic for Mixed, never reclassified as paved. The app's evidence semantics
are unchanged. The shared Adventure model also affects paved-or-unknown connectors
for other Adventure callers; it cannot condition on an app mode. No rule is added
to the Fastest profile, and no app dispatch or score is changed.

The encoded values/pre-pass are unchanged. New baked models require matching
landmarks, so the prepared PBF was imported into a fresh cache:
`~/ghbuild-curve/graph-cache-og-curve-calibrated-backroads`, with
`config-calibrated-backroads.yml` and `custom-models-calibrated-backroads/`.
That import took **3m37.87s**, peak RSS **12.20 GiB**, heap ceiling 16 GiB,
six active CPUs and four LM preparation threads. A superseded known-paved-only
model import took 3m40.33s; it was not served or benchmarked after source
inspection showed the missing-surface exemption. Both caches are preserved.
No repeat PBF pre-pass was needed.

The final 24-case benchmark took **11.89s wall time**. Summed app-plan elapsed
time was 4.31s control and 5.17s treatment across 12 plans each. This single run
includes startup/JIT and is descriptive, not a general latency claim. Engine
checks took 0.92s. The unchanged control remained on :8989; only the isolated
old :8991 process was stopped and replaced. Its graph/models remain preserved.

[Full calibrated benchmark, distributions, hashes and timing evidence](og-curve-calibration-2026-10-25.json).
The pre-calibration [benchmark](og-curve-graph-2026-10-25.json) and
[wiring probes](og-curve-wiring-2026-10-25.json) remain historical evidence.

## Surface exposure in the calibrated benchmark

Raw missing/OTHER tag share is not the same as app unknown-surface share: the
existing app infers some pavement from road class. Both are recorded below;
missing UNCLASSIFIED remains unknown in the app. Unknown exposure rises on the
Jim Thorpe destination and Reading, another reason to HOLD. No missing tag is
proof of pavement, gravel, safety or legal access.

| Ride | Mode | Raw missing/OTHER % current / new | App unknown surface km current / new |
| --- | --- | --- | --- |
| Jim Thorpe → Hawk Mountain | Balanced | 44.22% / 46.32% | 0.180 / 1.480 |
| Jim Thorpe → Hawk Mountain | Curvy | 44.22% / 46.32% | 0.180 / 1.480 |
| Jim Thorpe 120-minute loop | Balanced | 72.21% / 66.02% | 18.586 / 13.974 |
| Jim Thorpe 120-minute loop | Curvy | 72.21% / 66.02% | 18.586 / 13.974 |
| Allentown → Stroudsburg | Balanced | 70.57% / 70.43% | 0.143 / 0.044 |
| Allentown → Stroudsburg | Curvy | 70.47% / 70.43% | 0.367 / 0.044 |
| Doylestown → New Hope | Balanced | 92.98% / 95.18% | 0.000 / 0.000 |
| Doylestown → New Hope | Curvy | 95.17% / 83.05% | 0.131 / 0.247 |
| Reading → Jim Thorpe | Balanced | 52.62% / 43.55% | 2.281 / 4.199 |
| Reading → Jim Thorpe | Curvy | 52.62% / 43.06% | 2.281 / 6.323 |
| Bethlehem → Delaware Water Gap | Balanced | 73.05% / 84.70% | 0.227 / 0.000 |
| Bethlehem → Delaware Water Gap | Curvy | 71.92% / 76.47% | 0.137 / 0.000 |

## Historical request-wiring follow-up — before calibration

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
residential/service roads; every added curve multiplier is at most one. Balanced
and Curvy use these lanes through the existing app pipeline. Adventure now has
the guarded calibrated rules described above. Fastest model bytes, speeds, access
checks, time/exposure caps and scores are unchanged.
No new app policy is promoted. Regional preparation remains LM; a persisted
small fixture additionally verifies CH/flexible weight equivalence.

## Provenance and reproduction

GraphHopper builds, regional preprocessing/import and app gates ran only on
powerplex (`ssh windows-zac`, WSL Ubuntu user `zachary`).
`~/ghbuild-curve` resolves to `/mnt/wsl/ogv-data/home-zachary/ghbuild-curve`.
The existing `~/ghbuild` graph/models/config were copied into `control` and
served on WSL loopback `:8989`. The original `graph-cache-og-curve-window` /
`config-window.yml` treatment is preserved; :8991 now serves the calibrated
cache/config/models identified above. Neither server is the live router.

- Runtime jar SHA-256: `b59c024afe172ec6ec85b6327006c3138ec58c7d0bcd26253d0e42853f613def`.
- Original extract SHA-256: `bcf75b9308da24ab6942afc9fdbfa1abbd4e464f7cf20e426e594b1910dbc76a`.
- Prepared extract SHA-256: `ce4751e6dcb6a6e62805c8db845904f44afd055bc57cc88af544879765a96cdb`.
- Scoring source SHA-256: `3f7054a822fa854dbaafbf6d54d96c76e14bd81d810388bfdceec7a9cbeee3da`.
- Both graphs: 3,625,018 nodes, 4,514,563 edges, 60,360 turn-cost entries.
  Node, geometry and turn-cost files are byte-identical (hashes in JSON evidence).
- Pre-pass: 2,141,605 ways, 2,050,912 collections, 6m46s wall time, 3.51 GiB peak
  RSS, 24 GiB address-space ceiling. The historical pre-calibration import
  completed at 02:08; its streaming log was interrupted by quota exhaustion,
  so its elapsed import time is unknown. The calibrated import timing is
  recorded above. Runtime reload and prepared LM queries verified both caches.

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

[Original pre-calibration machine evidence](og-curve-graph-2026-10-25.json) ·
[Build/pre-pass reproduction](../../../infra/graphhopper/ext/README.md).

```sh
# In the isolated app checkout on powerplex, with both servers running:
OGV_CURVE_BENCHMARK=1 OGV_CURVE_CONTROL_URL=http://127.0.0.1:8989 \
OGV_CURVE_TREATMENT_URL=http://127.0.0.1:8991 \
OGV_CURVE_EVIDENCE=../benchmark-calibrated.json \
npm run test:real-router -- tests/real-router/og-curve-benchmark-live.test.ts
OGV_CURVE_CONTROL_URL=http://127.0.0.1:8989 \
OGV_CURVE_ENGINE_URL=http://127.0.0.1:8991 \
npm run test:real-router -- tests/real-router/og-curve-engine-live.test.ts
```

## Verification

- Calibrated 24/24 app benchmark cases passed validity/timebox/cap checks. Nine
  regional LM/flexible comparisons across Twisty/Scenic/Adventure returned equal
  weights/times with request penalties. Three Fastest control/treatment pairs
  returned identical geometry, weights and times.
- Calibrated full graph audit: all 3,489,430 residential/service/living-street edges have
  zero curve credit; every encoded value is finite and bounded.
- Eight Python/PBF tests plus ten subtests passed again, including shared Franco fixtures, reversed-way
  continuity, local straight tails, controls, chunk limits and unchanged
  nodes/way references/restriction members. Ten Java parser fixtures and the new percentile/access/class/surface guard
  assertions passed. Distribution before/after matches exactly in all three populations.
- Small real import/persist/reload: stock loader, LM and CH weights agree with
  flexible routing (674.9026462222223); overwriting an existing graph is refused.
- Original implementation app gates passed (not rerun in full for calibration): environment audit, lint (one existing unused-variable
  warning), typecheck, 5,248 tests with three existing skips, 149 architecture
  checks, and production build. Calibration reran TypeScript and focused ESLint
  successfully on powerplex. No browser/on-road or live-deployment claim.

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
