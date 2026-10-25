# Local `og_curve` heading graph — 2026-10-25

Latest heading-v3 candidate. Values are **curvy miles / Franco per km / minutes**
from the app's selected Best Ride; Δ minutes is treatment minus control.

| Ride | Mode | Current graph | Heading `og_curve` | Δ minutes | HTTP attempts current / new |
| --- | --- | --- | --- | --- | --- |
| Jim Thorpe → Hawk Mountain | Balanced | 3.22 / 37.34 / 51.86 | 2.94 / 17.65 / 52.88 | +1.01 | 6 / 6 |
| Jim Thorpe → Hawk Mountain | Curvy | 3.22 / 37.34 / 51.86 | 2.99 / 30.58 / 58.92 | +7.05 | 10 / 10 |
| Jim Thorpe 120-minute loop | Balanced | 6.68 / 102.16 / 117.14 | 6.37 / 121.65 / 115.42 | -1.72 | 52 / 53 |
| Jim Thorpe 120-minute loop | Curvy | 6.68 / 102.16 / 117.14 | 6.37 / 121.65 / 115.42 | -1.72 | 35 / 35 |
| Allentown → Stroudsburg | Balanced | 3.56 / 32.83 / 63.57 | 4.53 / 59.30 / 67.44 | +3.87 | 6 / 6 |
| Allentown → Stroudsburg | Curvy | 5.14 / 114.39 / 84.24 | 7.13 / 71.12 / 87.83 | +3.59 | 10 / 10 |
| Doylestown → New Hope | Balanced | 0.91 / 38.14 / 29.08 | 0.85 / 39.94 / 25.65 | -3.44 | 6 / 6 |
| Doylestown → New Hope | Curvy | 0.85 / 60.59 / 25.83 | 0.84 / 71.20 / 30.06 | +4.23 | 10 / 10 |
| Reading → Jim Thorpe | Balanced | 10.19 / 76.30 / 116.16 | 9.31 / 55.74 / 116.83 | +0.67 | 6 / 6 |
| Reading → Jim Thorpe | Curvy | 10.19 / 76.30 / 116.16 | 8.92 / 52.93 / 113.79 | -2.37 | 10 / 10 |
| Bethlehem → Delaware Water Gap | Balanced | 5.09 / 72.15 / 70.93 | 4.53 / 50.19 / 65.89 | -5.03 | 6 / 6 |
| Bethlehem → Delaware Water Gap | Curvy | 4.84 / 87.84 / 72.49 | 3.31 / 56.23 / 61.01 | -11.48 | 10 / 10 |

**Verdict: HOLD for rollout; the signal-spread goal passes.** The new median is positive,
but route quality is mixed under the requested unchanged evaluator. Jim Thorpe
Balanced destination loses 8.7% bend miles and 52.7% Franco/km for **+1.01 min**;
Curvy destination loses 7.3% bend miles and 18.1% Franco/km for **+7.05 min**.
The loop gains 19.1% Franco/km for **1.72 fewer minutes**, with 4.6% fewer bend
miles. Allentown Balanced gains both bend miles and density for +3.87 min;
Reading and Bethlehem lose both metrics. This does not establish a general
improvement or enjoyment of flowing roads. The Balanced loop spends **52 versus
53 HTTP attempts**, so its quality comparison is not equal-spend; all other pairs,
including the Curvy loop, spend equal attempts. Green validity checks are not
promotion acceptance. Live router untouched; nothing deployed.

## Distribution and calibration

Length-weighted physical graph edges, each counted once regardless of direction.
Population: positive-length, car-accessible non-residential roads in the provided
PA/NJ extract; exclude OTHER/RESIDENTIAL/SERVICE/LIVING_STREET and PRIVATE/NO
access. Motorways stay in the calibration population. Zero values remain in the
denominator. Quantiles are the first encoded bin reaching the requested fraction.

| Population | Edges | Length km | Zero share | p40 | p50 | p75 | p80 | p90 | p97 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All eligible non-residential — cutoff source | 978,210 | 160,453.25 | 28.93% | 0.066667 | 0.066667 | 0.200000 | 0.266667 | 0.333333 | 0.533333 |
| Known paved backroads | 261,792 | 36,408.46 | 30.02% | 0.066667 | 0.066667 | 0.133333 | 0.200000 | 0.266667 | 0.400000 |
| Adventure paved-or-unknown backroads | 614,728 | 89,152.30 | 28.40% | 0.066667 | 0.066667 | 0.200000 | 0.200000 | 0.266667 | 0.400000 |

**The median is positive without a score floor.** Non-residential zero share
falls from 89.52% under the Franco primitive to 28.93%. The encoded value remains
four-bit `0..1` in steps of `1/15`; values reflect normalized heading credit after
noise rejection and short-edge caps, not raw degrees/km measurements.

Cutoffs use the **all-non-residential population**, not a positive-only or
Adventure subset. `og_curve < 1/15` gets ×0.5 (existing motorway exemption);
`og_curve <= 4/15` gets ×0.75. Values above p80 get no curve penalty. Independent
rules compose to ×0.375 for zero and ×0.75 for the middle bands on non-motorways.
No multiplier above one is added. p97 is descriptive. Quantized ties mean the
exact length shares below/above the cutoffs need not be exactly 40%/20%.

## Signal and preserved behavior

- Private geometry is resampled near 20 m, with a symmetric phase including both
  ends. Fixed local-projection headings avoid meridian convergence on straight lines.
- Sum absolute heading change over a centred 1 km window, clipped at collection
  ends. Per-sample turn is capped at 30°; the window value is
  `min(1, degrees_per_km / 360)`. No sinuosity blend is used.
- Reject rapid alternating turns when signed/absolute heading coherence is below
  0.5 among sample centres within 100 m on either side, clipped at collection ends.
  The nominal 200 m noise guard rejects sawtooths while broad sweeps and S-bends
  retain credit. It is a geometric noise rule, not a tight-radius threshold.
- Keep 30 m along-road and physical junction/control suppression and exact segment
  clipping. Residential/service/living-street and `_link` variants still earn zero.
- Integrate locally at each GH edge’s original endpoints. Short-edge credit is at
  most 1/15 through 60 m, then ramps continuously to full credit at 600 m. This is
  a cap, never an additive floor, and uses original length so GH simplification
  cannot change the result. One long edge retains an average rather than a maximum.
- Keep original OSM IDs, nodes, way lists, tags, relations and graph topology.
  Compressed/chunked v1 payload envelope stays; heading-v3 changes the signal
  manifest. Import validates fixed signal parameters, pinned algorithm SHA and
  prepared-PBF hash, and refuses existing graph directories.

Scenic/Twisty retain urban and residential/service penalties. Adventure applies
the same curve preference only to SECONDARY/TERTIARY/UNCLASSIFIED with surface
MISSING/PAVED/ASPHALT/CONCRETE/PAVING_STONES/COBBLESTONE. Known unpaved and OTHER
surfaces are outside the added guard. Existing dirt rewards (1.45/1.25), access,
speed, app scores, bike constraints and time/exposure caps stay unchanged.
Fastest model bytes are unchanged and three direct control/treatment queries
return identical geometry, time and weight.

**Scope assumption:** MISSING is included as a backroad heuristic, never
reclassified as pavement. The shared Adventure model affects all its callers,
including the Balanced/Mixed lane; it cannot inspect app modes. No curve rule is
added to Fastest. These measurements do not prove surface, legal access, safety
or rider preference. Requested Franco/bend metrics remain the existing evaluator;
they do not fully measure enjoyment of flowing roads.

## Runtime, time cost and reproduction

All heavy work ran on powerplex through `ssh windows-zac`, WSL Ubuntu user
`zachary`, under `~/ghbuild-curve`. Control stays on :8989. Only the isolated
previous :8991 process was stopped; :8991 now serves `config-heading-v3.yml`,
`custom-models-heading-v3/`, and `graph-cache-og-heading-v3`. Prior graphs/models
are preserved. No live router or live graph was contacted or modified.

- Final heading pre-pass: **7:45.30**, peak RSS **3.51 GiB**.
- Measurement graph import (no LM): **1:53.34**, peak RSS **4.47 GiB**.
- Final graph import with four LM profiles: **3:41.59**, peak RSS **12.22 GiB**.
- Java import: 16 GiB heap ceiling, six active CPUs, four landmark threads.
- Final benchmark: **9.58s wall time**. Summed app-plan elapsed time across 12
  plans was 4.49s control / 4.19s treatment; engine checks took 0.78s. These are
  single-run measurements including JIT/cache effects, not a general latency claim.
- Measurement graph supplies actual encoded percentiles before the model/LM build;
  distribution matches the final serving graph exactly in all three populations.
- An unfiltered heading-v2 prototype was superseded after sawtooth fixtures exposed
  farming. It was not served or included in the final benchmark.

[Full heading benchmark, distributions, source/model/config hashes and timing](og-curve-heading-2026-10-25.json).
[Build and import instructions](../../../infra/graphhopper/ext/README.md).

The same six rides, fixed IDs and app source/options are used on both graphs:
`fun-best-destination`, `fun-best-loop-120`, then `og-curve:<corpus-id>` for
Allentown–Stroudsburg, Doylestown–New Hope, Reading–Jim Thorpe and Bethlehem–DWG.
Both styles use the touring bike, Mixed surface, gravel allowed, rough tracks
avoided, toll avoidance and protect-ride traffic; corpus highway avoidance stays.
The loop must fit 120 ±15 minutes. Optional closure authority, AI and Gravel Atlas
are absent equally. The adapter accepts `GRAPHHOPPER_URL`; the benchmark supplies
both isolated URLs directly to its factory.

```sh
OGV_CURVE_BENCHMARK=1 OGV_CURVE_CONTROL_URL=http://127.0.0.1:8989 \
OGV_CURVE_TREATMENT_URL=http://127.0.0.1:8991 \
OGV_CURVE_EVIDENCE=../benchmark-heading-v3.json \
npm run test:real-router -- tests/real-router/og-curve-benchmark-live.test.ts
OGV_CURVE_CONTROL_URL=http://127.0.0.1:8989 \
OGV_CURVE_ENGINE_URL=http://127.0.0.1:8991 \
npm run test:real-router -- tests/real-router/og-curve-engine-live.test.ts
```

## Verification and surface exposure

- 24 app benchmark cases pass validity, Balanced detour-cap and loop-time checks.
- Nine regional Twisty/Scenic/Adventure LM versus flexible comparisons pass with
  penalty-only request models; three Fastest parity comparisons pass.
- Thirteen Python/PBF tests pass, including a broad 1,000 m-radius sweep with zero
  historical Franco credit, S-bends, sawtooth rejection, straight tails, reversed
  controls and per-way emitted integrals, chunk bounds and unchanged OSM topology.
- Ten Java fixture cases plus short-edge ramp, original-length invariance,
  percentile/access/class/surface assertions pass. Tiny import/reload passes
  stock loading and flexible/LM/CH weight equivalence. Existing graph overwrite
  and incompatible heading manifests are rejected.
- Regional serving remains LM-only with CH disabled, matching the control.
  CH compatibility is proven only by the tiny persisted fixture, not a regional CH build.
- Full graph audit confirms finite/bounded values and zero credit on all
  3,489,430 residential/service/living-street edges. Nodes, geometry and turn-cost
  files are byte-identical to control: 3,625,018 nodes, 4,514,563 edges and 60,360
  turn-cost entries. TypeScript and focused ESLint pass. Full app build/unit suite
  from the original implementation was not rerun for these offline-signal changes.

Raw missing/OTHER tags are distinct from the app’s unknown-surface evidence,
which retains its existing road-class inferences. Both are recorded:

| Ride | Mode | Raw missing/OTHER % current / new | App unknown surface km current / new |
| --- | --- | --- | --- |
| Jim Thorpe → Hawk Mountain | Balanced | 44.22% / 46.32% | 0.180 / 1.480 |
| Jim Thorpe → Hawk Mountain | Curvy | 44.22% / 62.41% | 0.180 / 0.000 |
| Jim Thorpe 120-minute loop | Balanced | 72.21% / 73.42% | 18.586 / 19.972 |
| Jim Thorpe 120-minute loop | Curvy | 72.21% / 73.42% | 18.586 / 19.972 |
| Allentown → Stroudsburg | Balanced | 70.57% / 70.37% | 0.143 / 0.000 |
| Allentown → Stroudsburg | Curvy | 70.47% / 93.28% | 0.367 / 0.766 |
| Doylestown → New Hope | Balanced | 92.98% / 95.18% | 0.000 / 0.000 |
| Doylestown → New Hope | Curvy | 95.17% / 82.68% | 0.131 / 0.000 |
| Reading → Jim Thorpe | Balanced | 52.62% / 42.74% | 2.281 / 4.199 |
| Reading → Jim Thorpe | Curvy | 52.62% / 43.23% | 2.281 / 6.323 |
| Bethlehem → Delaware Water Gap | Balanced | 73.05% / 57.08% | 0.227 / 0.000 |
| Bethlehem → Delaware Water Gap | Curvy | 71.92% / 60.70% | 0.137 / 0.291 |

## Future rollout and rollback — not executed

**HOLD means do not roll out this candidate.** After separately authorized quality
acceptance, follow the [operations appendix](../../../infra/graphhopper/ext/ROLLOUT.md):

1. Identify the actual serving container and graph/config/model mount sources;
   save its image/jar, complete artifacts, hashes and paired app policy/release.
2. Stop the isolated candidate and stream a complete matching graph/runtime/
   config/model/hash unit into a new staging directory. Verify hashes and use
   a free-port canary. Keep the original live mount/port layout and rollback unit.
3. In an authorized stop, rename the existing live graph to a rollback directory,
   install the staged graph and matching models/config/runtime, and restart.
4. Verify health, fingerprints, fresh public planning and all 24 comparison cases.
   On failure, stop the replacement, move it aside, restore the saved graph,
   models/config/container and paired app release, then verify original requests.

Rollback needs no rebuild and never deletes the previous graph.

Historical [Franco benchmark](og-curve-graph-2026-10-25.json),
[wiring probes](og-curve-wiring-2026-10-25.json), and
[Franco calibration](og-curve-calibration-2026-10-25.json) remain separate evidence;
their old distributions/results are not heading-v3 measurements.
