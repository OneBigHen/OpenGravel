# RM-1: the map learns its bends and its dead ends (engine extension)

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/r3b`. Owner model: Opus.
Machine: Windows PC for every build and run (`ssh windows-zac`, WSL Ubuntu; send scripts with the base64
trick, ssh to cmd breaks `$`). Edits may be made on docker-dev and pushed as a branch. Size: L.
Plan: `.fable/ROUTING-MASTER.md` sections 4 and 5.

## Goal (rider sentence)
"The map itself knows which roads bend and which are dead ends."

This package adds the fields and proves they are right. It does **not** change any route: the profiles
stay exactly as production has them. RM-2 changes the profiles.

## Current state
- Production router: GraphHopper 11.0, config and build scripts only in the frozen `switchback` repo
  (`/root/Vibe/switchback/infra/graphhopper/config.yml`, `scripts/graphhopper.sh`, `bootstrap-data.sh`,
  `prepare-motorcycle-osm.mjs`, `lib/motorcycle-osm.mjs`). This repo has copies of the custom models in
  `infra/graphhopper/custom-models/` and nothing else for the motorcycle router.
- Production's twisty profile is three files merged: `motorcycle-base.json`, `prefer-curvature.json`,
  `motorcycle-twisty.json`. The built-in `curvature` value is edge length over straight-line length and
  resets at every junction; N6 proved it cannot steer.
- Windows PC has everything: `~/ghbuild/graphhopper-web-11.0.jar`, `~/ghbuild/pa-nj-motorcycle.osm.pbf`
  (496 MB, the file production imported), Java 17 with `javac`, 16 cores, 50 GB RAM. Build under
  `/mnt/wsl/ogv-data/ghbuild-moto-v2/` (891 GB free), not in the home disk.
- Checked in the jar: `GraphHopper.setImportRegistry(ImportRegistry)`, `ImportUnit.create(name,
  Function<PMap,EncodedValue>, BiFunction<EncodedValueLookup,PMap,TagParser>, String...)`, protected
  `postImportOSM()` (town density, then speed limits, then the edge sort; landmarks come later, in
  `postProcessing`). `com.graphhopper.http.GraphHopperManaged` builds `new GraphHopper()` and never sets
  a registry, so an overlay is needed.
- The pattern to copy: `infra/graphhopper/build-hike-snap.sh` (pinned upstream source at commit
  `69e50f6e2cfaf0a8e69752df9953ee5f1ac276a4`, sha256 check, small patch, `javac`, separate jar, launched
  with `-cp overlay.jar:graphhopper-web-11.0.jar com.graphhopper.application.GraphHopperApplication`).

## Build (all new files under `infra/graphhopper/moto/`)
1. `build-og-ext.sh JAR OUT_DIR`: fetch upstream `GraphHopperManaged.java` at the pinned commit, verify
   sha256, apply `ext/GraphHopperManaged.patch` (`new GraphHopper()` becomes
   `new com.opengravel.gh.OgGraphHopper()`), compile it with `ext/src/**`, write `og-ext.jar`. The
   upstream jar is never modified.
2. `ext/src/com/opengravel/gh/OgImportRegistry.java` (extends `DefaultImportRegistry`): registers
   `og_curve` (decimal, 5 bits, 0 to 1), `og_through` and `og_through_street` (booleans). Anything else
   goes to `super`.
3. `OgGraphHopper.java` (extends `GraphHopper`): sets the registry; overrides `postImportOSM()` to call
   `super` and then the two passes below, each only when its value is configured.
4. `OgCurveField.java`:
   - Raw pass, per edge: the maths of `src/domain/geometry/road-bends.ts` on the edge's own geometry.
     Resample at 10 m; a bend is at least 30 m of same-direction arc under 175 m radius, weighted 1 / 1.3 /
     1.6 / 2 at 175 / 100 / 60 / 30 m; roads that do not earn (residential, service, living street,
     links, roundabouts, non-rural density) score 0; motorway, trunk and primary earn only under 100 m.
     So an arc cut by a side road is not lost, extend the line 40 m into the continuing edge at each end
     (same road class, and same name or the smallest turn under 35 degrees) and credit only the metres
     inside this edge. No continuation means a junction corner, which earns nothing.
   - Window pass: `og_curve = min(1, D / 0.20)`, where D is weighted bend metres within 500 m either way
     along the same continuation chain, divided by the metres covered. Why the window matters: a 10 km
     road with ten 100 m bends costs 16.0 against 16.7 for a straight road when only the bend edges are
     cheaper (priority 1.0 against 0.6), which is 4%; with the window the whole road reads about 0.5 and
     costs 11.8, which is 30%. Only the second makes a router take a detour.
5. `OgThroughFlags.java`: over edges a motorcycle may legally use (`car_access` either way, road access
   not private or no), find bridges with an iterative Tarjan (the graph has millions of edges; no
   recursion), remove them, and mark `og_through` true for every edge in a remaining part with at least
   20 km of roads. `og_through_street` is the same on the graph without unpaved surfaces and without
   tracks rougher than grade 1.
6. `config-v2.yml`: production's config with `graph.location: graph-cache-v2`, the three new values and
   `osm_way_id` added to `graph.encoded_values`, **profiles and custom models byte-identical to
   production** (copy `prefer-curvature.json` and the others into `moto/custom-models/`).
7. `build-graph.sh BUILD_DIR`: the one command for steps 1 to 3 of the recipe in `ROUTING-MASTER.md`
   section 5; writes `import.log` and a `SHA256SUMS` of the graph folder.
8. `probe-graph.py --url ... --prod ...`: the five checks in `ROUTING-MASTER.md` section 5.
9. Copy `prepare-motorcycle-osm.mjs` and `lib/motorcycle-osm.mjs` from switchback byte for byte (record
   sha256 in the PR), so the whole recipe lives here. Do not re-run it: this round uses the same map file
   as production.
10. Shared fixtures: `scripts/geometry/write-road-bend-fixtures.ts` writes
    `tests/fixtures/road-bends/*.json` (10 single-road lines: straight, sweeper, hairpins, zig-zag, an arc
    cut by a side road, a town street, a primary) with `measureRoadBends` results;
    `tests/unit/geometry/road-bend-fixtures.test.ts` pins the TypeScript side; `ext/OgChecks.java` reads
    the same files and checks the raw pass, plus a synthetic tree, ring and lollipop for the through flags.
11. Field check: `scripts/scorecard/field-check.ts` reuses `snapRiderLine` (`scripts/scorecard/rider-line.ts`)
    with `og_curve` added to the requested details, for the rider's line and the fastest route of each
    tracked tuning ride.
12. Add a "Motorcycle router v2" section to the existing `infra/graphhopper/README.md` (no new document).

## Pass / fail (run on the Windows PC; v2 router on 127.0.0.1:8989 there, tunnel to local 8988)
- `build-graph.sh` completes; `import.log` shows no exception; total time and peak heap are in the PR.
- `java -cp og-ext.jar:graphhopper-web-11.0.jar com.opengravel.gh.OgChecks tests/fixtures/road-bends`
  exits 0: raw bend metres within 5% (or 15 m) of the TypeScript value on every fixture; through flags
  right on the synthetic graph. `npx vitest run tests/unit/geometry/road-bend-fixtures.test.ts` passes.
- `probe-graph.py` exits 0:
  - `/info` lists `og_curve`, `og_through`, `og_through_street`, `osm_way_id` and every value production
    lists; version 11.0; same four profiles; same bounding box.
  - **No route changed:** 20 fixed pairs on each of the four profiles, distance and time within 1% of
    production. `turn_costs` in the new graph is 1,048,676 bytes, as in production.
  - Field: on the 6 curvy tuning rides with a rider's line, mean `og_curve` on the rider's line beats the
    fastest route's on at least 5; Spearman 0.8 or better between mean `og_curve` and the scorecard's
    bend share over all measured lines.
  - Through: 95% of 20 atlas corridors with entry and exit links read true at their midpoint; 95% of 20
    with no exit read false.
  - 40 single routes per profile: p95 0.6 s or less. Serving memory after 200 requests 3.3 GB or less
    with `-Xmx4g`.
- Graph size in the PR (expected 1.33 to 1.40 GB; production is 1.28 GB).

## Stop rule
If the field check misses after one fix attempt, stop and report the per-ride table. Do not tune the
window or the scale to pass; those numbers are also read by RM-2. If the overlay cannot be made to work
on GraphHopper 11.0 in two attempts, report what failed: the fallback is profiles on the built-in value
plus through flags only, and that is the advisor's call.

## Rules
- Read `CLAUDE.md` and `AGENTS.md` first. Hiking files in `infra/graphhopper/` are frozen: add beside
  them, change none.
- Never touch docker-stable in this package. Never stop a process you did not start on the Windows PC;
  check the listener's PID first. Run the import detached so a dropped ssh does not kill it.
- New output folders only; never `rm` with a wildcard.
- Never push to `main`. Small plain-English commits. Final message: what the graph now knows, the probe
  output, build time and size, anything you could not do.
