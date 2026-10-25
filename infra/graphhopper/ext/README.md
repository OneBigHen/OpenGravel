# `og_curve` graph extension (GraphHopper 11.0)

An offline geometry pre-pass and a small `TagParser`, compiled against the exact
GraphHopper web jar on powerplex. `GraphHopper.setImportRegistry` registers a
four-bit, direction-independent decimal value (`0..1`, steps of `1/15`). No
GraphHopper core/web classes are patched or replaced.

## Local geometry and continuity

`preprocess/curve.py` joins matching named/ref road ways only at degree-two
endpoints. It resamples the private scoring geometry at approximately 20 m,
including both ends with a direction-independent phase. Original OSM nodes and
way geometry are preserved. Heading uses a fixed local projection, so meridian
convergence on a straight road cannot manufacture curvature.

The signal is total absolute heading change per kilometre inside a centred
1 km window, clipped at collection ends. It replaces the tight-radius Franco
primitive for graph import; the app's Franco evaluation/scoring stays unchanged.
No sinuosity blend is used. Junction/control credit is suppressed within 30 m
both along the collection and by physical distance, with exact segment clipping.
Rapid alternating turns are rejected when signed/absolute heading coherence
among sample centres within 100 m on either side is below 0.5 (a nominal
200 m neighbourhood, clipped at collection ends). Broad sweeps and S-bends
survive without a minimum-radius cutoff; a repeated sawtooth is a negative fixture.

Per-sample absolute turn is capped at 30 degrees and window credit at 360 degrees/km.
The normalized value is `min(1, degrees_per_km / 360)`. The parser further caps
short-edge credit at 1/15 through 60 m, then ramps continuously to 1 at 600 m.
This uses original local-integral length, so GH geometry simplification cannot
change the cap. Residential/service/living-street (including `_link`) credit
remains zero. Bounds reduce farming incentives; they do not establish rider
preference or on-road safety.

The pre-pass preserves **all original IDs, nodes, way node lists, relation
members and tags**. It adds only local `og:curve` metadata on routable road ways, split into
ASCII chunks below OSM's 255-byte tag-value limit. The payload contains zlib/base64-encoded coordinates, cumulative distance and
cumulative normalized heading integral (integer millimetres). This is a private import
artifact, not data to upload to OSM. Structured local integrals avoid the
schema draft's way-splitting approach, which would require rewriting via-way
and other relation references.

GH 11 supplies a new `point_list` per junction-to-junction edge to tag parsers.
`OgCurveParser` matches its two endpoints into the pre-pass integral, divides
local curve area by local length, and quantizes once to `1/15`. GH geometry
simplification cannot smear the score across a whole OSM way. Repeated
coordinates are disambiguated by edge length; unresolved equal-length
occurrences earn zero credit. Malformed tags, unprepared road
ways and unmatched geometry fail the import. Artificial zero-distance edges
receive zero; GH copies imported flags to its turn-restriction duplicate edges.

A long individual GH edge still has one length-weighted average, as every encoded
value must. A brief curve inside a long straight edge cannot light up the whole
edge at maximum strength. We do not add artificial tower nodes or change graph
topology. `og_access`, elevation and the other schema-v2 fields remain out of
this task's scope.

## Models and serving

The baked `prefer-curvature.json` is shared by scenic and twisty lanes, used by
both Balanced and Curvy app modes. The current heading graph's length-weighted
p40=1/15 and p80=4/15 cutoffs come from all eligible non-residential road length
(zero share 28.93%; p50=1/15). Details are in the dated research report.
The two independent curve rules multiply priority by 0.5 on dull edges and by
0.75 through p80. Values above p80 receive no curve penalty. Urban and
residential/service penalties remain separate, as does the existing motorway
exemption on the first curve rule. All added multipliers are at most one.

Adventure adds those same two curve rules only on secondary/tertiary/unclassified
roads with paved or missing surface tags (`MISSING`, `PAVED`, `ASPHALT`,
`CONCRETE`, `PAVING_STONES`, `COBBLESTONE`). Missing means surface-unknown,
not proven pavement. These are the
Adventure candidates used by Balanced/Mixed; other requests to that profile
also inherit its paved-connector preference. Known unpaved, unrecognized (`OTHER`) surfaces and
residential, service, living-street, trunk and motorway edges are excluded from
these additions. Existing dirt rewards, access and speed rules are retained;
all **new curve multipliers** are at most one. The Fastest model is unchanged.

Landmarks must be rebuilt with the new models, even though encoded values need
no reprocessing. Use a new graph directory with the existing prepared PBF;
never load old landmarks against different baked models. The candidate config
retains the current LM setup and empty CH profile list. Penalty-only edge weights
are suitable for CH preparation too; CH operation is not claimed from this
LM-only experiment.

The stock GH 11 server loads the serialized built-in `DecimalEncodedValueImpl`;
it needs no extension on its runtime classpath. Keep the matching jar, graph,
models, config and provenance hashes as one rollback unit. The importer refuses
an existing graph directory and never removes graphs. `Audit` loads read-only,
checks every edge's value and proves all residential/service/living-street
edges have zero curve credit.

## Reproduce on powerplex

```sh
# Stream assets with tar over SSH; avoid scp for large Windows files.
infra/graphhopper/prepare-curve-experiment.sh ~/ghbuild ~/ghbuild-curve-new
# Follow the printed pre-pass/import/server commands in separate terminals.
```

`build.sh` compiles in a fresh temporary directory and runs shared-fixture,
quantization, edge-locality, reversal, street/link guard and missing-pre-pass
tests before producing `target/og-curve-gh11.jar`. Python tests also check a
reversed degree-two way boundary, junction suppression and long straight tails.
The persisted tiny graph checks stock loading and flexible/LM/CH equivalence:

```sh
infra/graphhopper/ext/test-import.sh ~/ghbuild/graphhopper-web-11.0.jar ./curve-venv/bin/python
```

The read-only distribution command counts each physical, accessible road edge
once, weighted by its stored length. It excludes private/no access and
residential/service/living-street/OTHER classes, and reports zero shares, raw
16-bin meter totals, full-population and positive-only percentile ranks. The
known-paved subset (PAVED/ASPHALT/CONCRETE) and Adventure-eligible subset
separate documented surfaces from the exact model guard above.

```sh
java -Xmx6g -XX:ActiveProcessorCount=4 \
  -cp infra/graphhopper/ext/target/og-curve-gh11.jar:../ghbuild/graphhopper-web-11.0.jar \
  rodeo.opengravel.graphhopper.Distribution config-heading-v3.yml distribution.json
```

The heading-v3 manifest records fixed signal parameters and source/output/algorithm
hashes. Import validates those parameters, the pinned algorithm digest and the
prepared PBF hash; prior signal manifests are rejected. The compressed/chunked
payload retains its v1 envelope, now carrying normalized heading integrals.
The pre-pass uses a 24 GiB address-space ceiling. Do not run PA/NJ
preprocessing/import on docker-dev.

Run in the app checkout on powerplex with both isolated servers running:

```sh
OGV_CURVE_BENCHMARK=1 \
OGV_CURVE_CONTROL_URL=http://127.0.0.1:8989 \
OGV_CURVE_TREATMENT_URL=http://127.0.0.1:8991 \
OGV_CURVE_EVIDENCE=/tmp/og-curve-benchmark.json \
npm run test:real-router -- tests/real-router/og-curve-benchmark-live.test.ts
```

The benchmark fails on unavailable/wrong/mismatched graphs, uses `planRide`,
counts actual transport attempts (including loop calibration/retries), and
records paired deltas. Passing proves valid measurements and time bounds,
**not quality acceptance**. Inspect regressions and unequal-spend pairs before
any promotion. The scorecard document references helper modules absent from
the required parent branch; no competing evaluator was introduced.

The real adapter environment variable is `GRAPHHOPPER_URL`, not `OGV_ROUTER_URL`.
The comparison passes each URL directly to the same adapter factory. Live road
closure authority and AI are disabled equally; these are router/selection
measurements, not legal-clearance or on-road acceptance.
