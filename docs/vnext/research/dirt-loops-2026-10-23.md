# Dirt loops: live PA benchmark, 2026-10-23

All 12 Dirt OK treatments exceed 25% measured dirt, and all 24 treatments fit the requested time ±15%. Jim Thorpe, 2 h: **9.5% / 9.1 km → 42.6% / 31.6 km**, 129.5 min after. This is local source + live GraphHopper evidence; no production app deployment or on-road acceptance is claimed.

## Cause and reproduction

Baseline: `4f6544b4cb783286a65814fbffe23edfd632f86a`, production environment settings supplied in the task. The tunnel answered `OK` before routing. The benchmark enters `handleRoutePlanRequest` and its real `planRide` implementation, the same handler/service as `/api/route-plan`; it does not substitute scoring or eligibility.

- `src/server/planning/plan-service.ts:834`: production `OGV_ATLAS_GENERATORS=off` disables the atlas probes (the new loop-only override was absent). `OGV_FUN_GENERATORS=shadow` and `OGV_RIDE_FORMULA=shadow` cannot change the delivered winner. A map layer drawing an atlas corridor does not add it to the route candidate pool.
- `src/application/planner/rider-mode-search.ts:121`: loops return before the point-to-point strength sweep. They compare only existing in-window candidates and make **zero** search calls. Existing dirt-km selection works when useful dirt is present.
- `src/application/planner/candidate-lanes.ts:390` (`runLanes`, six-candidate cap), with `graphhopper/provider.ts` (three discovery seeds per profile): the first two lanes fill the cap. In this baseline that admits Fastest and Scenic but drops Twisty and Adventure, even though all four ran. This cap is unchanged by this patch; the separately budgeted atlas pool bypasses the generation starvation.
- Merely switching the old atlas generator on did not produce any probes for the fixed Jim Thorpe request (55 atlas rows considered). Its loop search first truncated corridors by a bend/quality prize, fixed each reversible road orientation relative to home, limited tours to three roads, and rejected short loops without calibration. It also excluded ordinary Mixed, including Mixed with an explicit positive target.

The task reported a 126 min / 55 mi / 2% production loop. Its request ID and other Ride style settings were not supplied; the request ID seeds the router, so that exact geometry was **not reproduced**. The fixed request below reproduces the dirt-starvation failure at 9.5%. A second seed (`req_style_loop_120`) returned 9.1% at 136.6 min. Neither is represented as the original 2% route.

Fixed Jim Thorpe request: `dirt-loop:jim-thorpe-120-dirt-preferred`, origin/finish `(40.8676,-75.7327)`, target 120 min, tolerance 18 min; Balanced, Avoid busy roads, tolls avoided, highways allowed, adventure bike with maintained gravel allowed and rough tracks avoided. All other corpus requests use `dirt-loop:<town>-<minutes>-<surface>`. Mixed uses the Fastest profile; Dirt OK uses Adventure, as the production request builder does.

Every baseline Jim Thorpe engine candidate (all four lanes, before the six-candidate cap):

| Lane | Seed position | Minutes | Distance km | Dirt km | Dirt % | Admission |
|---|---:|---:|---:|---:|---:|---|
| motorcycle_fastest | 1 | 111.48 | 93.95 | 0.13 | 0.13 | admitted |
| motorcycle_fastest | 2 | 105.21 | 108.48 | 0.00 | 0.00 | admitted |
| motorcycle_fastest | 3 | 134.91 | 104.11 | 6.54 | 6.28 | admitted |
| motorcycle_scenic | 1 | 132.57 | 103.01 | 3.03 | 2.94 | admitted |
| motorcycle_scenic | 2 | 153.65 | 137.07 | 3.41 | 2.49 | admitted |
| motorcycle_scenic | 3 | 131.02 | 95.20 | 9.06 | 9.51 | admitted |
| motorcycle_twisty | 1 | 126.04 | 118.93 | 0.46 | 0.39 | capped before selection |
| motorcycle_twisty | 2 | 132.51 | 101.52 | 1.04 | 1.03 | capped before selection |
| motorcycle_twisty | 3 | 132.29 | 85.61 | 12.88 | 15.05 | capped before selection |
| motorcycle_adventure | 1 | 130.44 | 121.34 | 0.00 | 0.00 | capped before selection |
| motorcycle_adventure | 2 | 118.35 | 116.67 | 0.00 | 0.00 | capped before selection |
| motorcycle_adventure | 3 | 133.13 | 85.16 | 13.06 | 15.34 | capped before selection |

The admitted Scenic seed at 131.02 min has 9.06 km dirt / 12.17 km continuity-weighted dirt value. It is the strongest in-window admitted dirt candidate. Adventure has a 13.06 km / 15.34% dirt seed at 133.13 min, but the cap removes it before the rider search. The companion JSON includes every baseline/treatment provider answer, final pool, search trial and formula reading for this fixed request.

## Implementation and configuration

- New `atlas-dirt-loops.ts`: bounded beam over up to 32 eligible nearby corridors, five corridor depths and beam width 32. Scores useful dirt length, connector cost, source quality and use of the time budget. Both orientations are considered only for explicitly reversible roads. No road is repeated within a tour. Five (rather than three) permits a useful ride across short atlas fragments.
- Existing atlas legal/access/closure/sand/grade/dead-end/routability gates remain. Rider-authored stops, shapes, sketch and road spans still suppress atlas generation. Router waypoint/span routing establishes the final line; canonical eligibility checks the returned candidate.
- A single probe adapts its sequence after an actual shortfall or overrun, for at most the configured 2–4 provider calls. Every successful candidate must pass the original measured lower AND upper time bounds. Estimates are never published as ETAs, and no router speed rules changed.
- Mixed loops seek a 25% share versus Dirt OK’s 50%; Mixed ranks progress toward its target over a fixed reference distance, then prefers less excess dirt and uses dirt-km/continuity to break ties. Additional route distance cannot buy more value after the target is met. This is a preference rather than a hard surface cap: the only available in-window atlas tour may exceed 25%. Dirt OK continues valuing dirt kilometres, scraps and continuity. Mixed point-to-point and Paved/Mostly paved behavior are preserved.
- Atlas `observedUnpavedShare` now divides by all measured road distance, including unknown surface. Unknown is never dirt. Dirt % and dirt km in this report use explicit router surfaces over total measured road distance.
- Adaptive probe diagnostics now identify the sources actually routed after a sequence change, rather than the initial proposal.
- New `OGV_DIRT_LOOP_GENERATORS=on` is a loop-only opt-in when the general atlas switch stays off; it applies only to Dirt OK and Mixed loops. Paved, Mostly paved, point-to-point, rider-disable and progressive first-answer gates retain their behavior.
- Dirt loops no longer request another three-seed Fastest loop as an atlas detour baseline: their budget is ride time, not a point-to-point detour. Paved/backroad baseline behavior remains.

The measured treatment requires these deployment changes **in addition to this source patch**:

```dotenv
OGV_ATLAS_GENERATORS=off
OGV_DIRT_LOOP_GENERATORS=on
OGV_ATLAS_CALLS=4
OGV_GRAVEL_ATLAS_PATH=/var/lib/opengravel/gravel-atlas-v3.sqlite
# Unchanged from the supplied production settings:
OGV_FUN_GENERATORS=shadow
OGV_RIDE_FORMULA=shadow
```

No environment or service was changed here. The loop-only override keeps the general atlas switch off, so Paved/Mostly paved and point-to-point do not start using the existing atlas experiments. `OGV_RIDER_MODES=off`, both atlas switches off, or zero atlas calls disables this path; the measured outcome is not claimed under those switches. A progressive first-route (`includeAlternatives=false`) still skips atlas work; this benchmark measures the full Best Ride plan.

## Six starts × two budgets × two surfaces

Pine Grove is **Pine Grove borough**, not Pine Grove Furnace. Coordinates: Jim Thorpe 40.8676,-75.7327; Pine Grove 40.5484,-76.3847; Lock Haven 41.1370,-77.4469; Renovo 41.3265,-77.7508; Kempton 40.6268,-75.8530; Wellsboro 41.7487,-77.3005.

Atlas inventory inside the budget radius (33.12 km / 49.68 km for 2 h / 3 h): lengths of legal, nonclosed corridors with at least one geometry point inside the radius. “Allowed” also applies the generator’s routability, link, grade, sand and confidence filters; lengths are catalogue opportunity, not routed proof. Every start exceeds the 10 km target condition.

| Start | 2 h legal / allowed km | 3 h legal / allowed km |
|---|---:|---:|
| Jim Thorpe | 135.0 / 83.2 | 308.4 / 202.8 |
| Pine Grove | 194.0 / 95.8 | 349.0 / 221.5 |
| Lock Haven | 689.5 / 463.9 | 1511.2 / 1091.4 |
| Renovo | 739.4 / 555.0 | 1546.5 / 1201.0 |
| Kempton | 107.3 / 79.0 | 195.1 / 120.1 |
| Wellsboro | 1017.1 / 875.0 | 1715.1 / 1455.1 |

Each cell reports actual router dirt share, dirt distance, and ETA. Δ is actual ETA versus the rider’s requested time.

| Start | Requested | Surface | Before dirt % / km | Before min (Δ) | After dirt % / km | After min (Δ) |
|---|---:|---|---:|---:|---:|---:|
| Jim Thorpe | 120 min | Dirt OK | 9.5% / 9.1 | 131.0 (+9.2%) | 42.6% / 31.6 | 129.5 (+7.9%) |
| Jim Thorpe | 120 min | Mixed | 2.0% / 1.6 | 102.2 (-14.8%) | 29.5% / 26.1 | 129.1 (+7.5%) |
| Jim Thorpe | 180 min | Dirt OK | 11.7% / 16.6 | 202.1 (+12.3%) | 29.8% / 35.6 | 179.7 (-0.2%) |
| Jim Thorpe | 180 min | Mixed | 8.3% / 10.5 | 167.2 (-7.1%) | 17.0% / 23.0 | 172.4 (-4.2%) |
| Pine Grove | 120 min | Dirt OK | 0.0% / 0.0 | 127.8 (+6.5%) | 31.7% / 22.9 | 126.9 (+5.8%) |
| Pine Grove | 120 min | Mixed | 0.0% / 0.0 | 117.5 (-2.0%) | 31.4% / 28.5 | 134.9 (+12.4%) |
| Pine Grove | 180 min | Dirt OK | 10.7% / 13.1 | 157.4 (-12.5%) | 43.0% / 48.1 | 191.1 (+6.2%) |
| Pine Grove | 180 min | Mixed | 0.6% / 1.0 | 187.7 (+4.3%) | 46.5% / 55.7 | 193.0 (+7.2%) |
| Lock Haven | 120 min | Dirt OK | 21.1% / 18.6 | 126.6 (+5.5%) | 30.3% / 23.0 | 119.3 (-0.6%) |
| Lock Haven | 120 min | Mixed | 34.0% / 27.7 | 131.3 (+9.4%) | 28.3% / 21.2 | 114.0 (-5.0%) |
| Lock Haven | 180 min | Dirt OK | 31.5% / 29.8 | 166.6 (-7.5%) | 55.7% / 57.1 | 178.8 (-0.6%) |
| Lock Haven | 180 min | Mixed | 17.0% / 20.7 | 158.4 (-12.0%) | 36.4% / 49.1 | 204.8 (+13.8%) |
| Renovo | 120 min | Dirt OK | 23.7% / 14.9 | 101.4 (-15.5%) † | 57.2% / 39.4 | 123.1 (+2.6%) |
| Renovo | 120 min | Mixed | 23.3% / 18.2 | 121.5 (+1.3%) | 23.3% / 18.2 | 121.5 (+1.3%) |
| Renovo | 180 min | Dirt OK | 26.8% / 37.4 | 183.9 (+2.2%) | 56.3% / 62.8 | 189.2 (+5.1%) |
| Renovo | 180 min | Mixed | 18.9% / 22.2 | 164.3 (-8.7%) | 41.1% / 42.2 | 160.2 (-11.0%) |
| Kempton | 120 min | Dirt OK | 14.6% / 12.5 | 114.3 (-4.7%) | 50.3% / 39.2 | 127.3 (+6.1%) |
| Kempton | 120 min | Mixed | 9.2% / 6.3 | 110.7 (-7.7%) | 41.7% / 28.6 | 107.7 (-10.3%) |
| Kempton | 180 min | Dirt OK | 4.1% / 6.4 | 206.0 (+14.4%) | 38.0% / 42.0 | 165.7 (-7.9%) |
| Kempton | 180 min | Mixed | 0.0% / 0.0 | 166.9 (-7.3%) | 18.8% / 25.1 | 172.4 (-4.2%) |
| Wellsboro | 120 min | Dirt OK | 40.3% / 27.4 | 128.9 (+7.5%) | 51.6% / 29.6 | 121.6 (+1.3%) |
| Wellsboro | 120 min | Mixed | 20.7% / 16.3 | 121.6 (+1.4%) | 32.8% / 23.6 | 104.5 (-12.9%) |
| Wellsboro | 180 min | Dirt OK | 29.5% / 40.6 | 196.6 (+9.2%) | 54.7% / 63.6 | 203.8 (+13.2%) |
| Wellsboro | 180 min | Mixed | 29.5% / 31.9 | 167.3 (-7.0%) | 29.5% / 31.9 | 167.3 (-7.0%) |

† Before: Renovo 120 min Dirt OK missed the lower bound; the existing pipeline selected its closest available loop. Every treatment is inside the window.

The final matrix was replayed under the dedicated loop-only configuration above: all 24 results matched the general-atlas treatment, with **zero additional HTTP calls** from the shared raw-response cache.

Total actual HTTP `/route` calls including exploratory probes and the alternate-seed reproduction attempt: **523**. Before/after use identical request IDs and cached raw router responses for unchanged lane requests. The original baseline was captured before edits; rerunning `--arm before` on patched source measures only an env rollback, not the original Mixed selection. Raw cache must be fresh for a different router graph.

The matrix uses an HTTP-saving optimization (the lane cap runs before canonical normalization/eligibility): after the first two lanes both return three candidates, the benchmark supplies empty answers for later lanes the six-candidate cap is guaranteed to discard. All six candidates entering ranking are unchanged. A strict replay with all four lanes for Jim Thorpe confirms the same 9.5% before / 42.6% after winners. This is disclosed rather than counted as a complete four-profile trace for every matrix row. The strict Jim Thorpe trace is complete.

Shadow fun-generator strategies were supplied as an empty array to avoid spending router calls on work that cannot affect the answer. Live traffic, optional classifiers/judge and road-authority providers were disabled for a deterministic router/atlas comparison; no live closure-provider or on-road acceptance is claimed. Router private/car-access/rough-track protections remain active.

## Reproduction and gates

```sh
curl http://127.0.0.1:18989/health
# Capture before on the original baseline source, then after on this patch:
node --conditions=react-server --import tsx scripts/dirt-loop-benchmark.ts --arm before --prune-capped-lanes
node --conditions=react-server --import tsx scripts/dirt-loop-benchmark.ts --arm after --prune-capped-lanes
# Complete, unpruned fixed-request trace (reuses the same raw-response cache):
node --conditions=react-server --import tsx scripts/dirt-loop-benchmark.ts --arm after --only jim-thorpe --minutes 120 --surface dirt-preferred
```

The script replays each plan even when a previous output file exists; only raw router responses are cached. Cache keys include both endpoint URL and request body. The script writes raw router responses and per-plan evidence under `/tmp`, caps cumulative cached + in-flight HTTP requests at 600, and records actual HTTP requests rather than provider invocations. It is not part of the default test suite. To run against the baseline commit, copy this standalone benchmark script into that checkout; its `@` imports must resolve against that checkout’s `tsconfig.json`.

- Test-first regressions failed before implementation: Mixed atlas generation, short-loop calibration and Mixed loop selection.
- `npx tsc --noEmit`: passed.
- `npm run audit:env`: passed (117 source keys / 117 documented).
- `npx eslint` on all ten changed TS/test files: passed.
- Focused `npx vitest run --maxWorkers=2` on `atlas-generators`, `rider-mode-search`, `fun-generators`, `plan-service-atlas`, `plan-service-ride-formula`, `gravel-atlas`, and `ride-formula`: **7 files / 85 tests passed**.
- No full suite, Next build or Playwright was run.

## Limits

The 25% outcome is measured for this fixed six-start corpus on the supplied graph, not a guarantee for arbitrary starts, seeds, traffic or closure conditions. Missing atlas/router data or an impossible budget must keep a truthful lower-dirt fallback; the patch never manufactures dirt or changes ETA to pass. The legacy six-candidate lane cap remains a separate improvement opportunity. The exact original 2% request and public app deployment remain unverified.

Two independent DeepSeek review axes completed. Their actionable Paved baseline, Mixed long-route saturation, stale output, cache URL identity and adaptive provenance findings were addressed and regression-tested. The cumulative 600-response benchmark cap is deliberate across both arms, rather than a per-arm allowance.

Commit preparation is blocked in this environment: `git add` cannot create `.git/index.lock` (read-only filesystem), despite source files being writable. No commit/push/deploy occurred. `git ls-remote` observed main at `2dba4e11b35110a282ab315236a895d7659b892a`; this task preserves the explicitly requested branch/base instead of rebasing it.
