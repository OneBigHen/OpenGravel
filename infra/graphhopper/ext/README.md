# `og_curve` graph extension (GraphHopper 11.0)

An offline geometry pre-pass and a small `TagParser`, compiled against the exact
GraphHopper web jar on powerplex. `GraphHopper.setImportRegistry` registers a
four-bit, direction-independent decimal value (`0..1`, steps of `1/15`). No
GraphHopper core/web classes are patched or replaced.

## Local geometry and continuity

`preprocess/curve.py` joins matching named/ref road ways only at degree-two
endpoints. It applies the app's Franco-v1 radius bands (175/100/60/30 m), weights
(1/1.3/1.6/2), and 3–7 segment noise filter. The same geometry/weighted-metre
fixtures run against the unchanged app implementation and the Python port.
Forward/reverse minimum vertex weights remove source direction bias. Junction
and control vertices suppress curve credit within 30 m along the road.

A centred 400 m moving window measures weighted bend metres per metre, clipped
at collection ends and clamped to `[0,1]`. Short edges inherit the surrounding
continuous road signal instead of dividing their own tiny curve metres by an
invented 400 m of straight road. Residential/service/living-street shapes earn
zero credit, including `_link` variants.

The pre-pass preserves **all original IDs, nodes, way node lists, relation
members and tags**. It adds only local `og:curve` metadata on routable road ways, split into
ASCII chunks below OSM's 255-byte tag-value limit. The payload contains zlib/base64-encoded coordinates, cumulative distance and
cumulative windowed curve area (integer millimetres). This is a private import
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
both Balanced and Curvy app modes. Curve preference only multiplies priorities
by values at most one; urban and residential/service penalties apply separately.
Access, speed, fastest/adventure models and the app time/exposure gates retain
their existing behavior. Landmarks must be rebuilt with the new models. The
candidate config retains the current LM setup and empty CH profile list.
Penalty-only edge weights are suitable for CH preparation too; CH operation
is not claimed from this LM-only deployment.

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

The pre-pass records source, output and algorithm hashes and uses a 24 GiB
address-space ceiling. The importer requires the completed output manifest and
verifies the PBF hash. Do not run PA/NJ preprocessing/import on docker-dev.

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
