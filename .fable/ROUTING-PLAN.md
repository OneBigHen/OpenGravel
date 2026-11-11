# OpenGravel routing plan (2026-11-10)

Read from code on `design/world-class` (29cc986). Nothing was built and the scorecard was not run. I ran one read-only script that measures the riders' own tracks in `tests/scorecard/rides.json` (section 6); it makes no router calls. "Estimate" means not measured. This plan replaces section 5 of `ROUND-PLAN.md`; the table in section 5 says how.

## 0. Verdict

**The router cannot see fun, so everything around it tries to guess.** The twisty profile has no curve term at all (`infra/graphhopper/custom-models/motorcycle-twisty.json`, 8 lines). About 11,000 lines of code around it (sweeps, generators, judges, a 28-variable formula) then ask the router many times and pick the least dull answer. Each earlier study ended on the same sentence: "the router does not know where the curves are" (`docs/vnext/research/routing-stack-decision-2026-10-04.md`, step 1 result; `fun-best-ride-2026-10-25.md`, point 4). The fix was designed on 2026-10-04 (`graph-schema-v2-2026-10-04.md`) and never built. Build it, then delete the guessing.

Second finding, just as important: **the scorecard cannot be won on curvy rides as it is written** (section 6). Fix the yardstick before any routing work, or package 2 will fail its own pass line.

## 1. What exists today

Router calls are counted from code. Seconds are from PR #210's scorecard run (average 9.1 s, slowest 33.6 s, one request at a time) and code comments (single path about 1.3 s, alternatives 4 to 7 s on a long ride: `plan-service.ts:684-686`).

| Path or part | Where | In production | Router calls | Verdict |
|---|---|---|---|---|
| First answer | `candidate-lanes.ts:180` | On. It is always the **fastest** profile, whatever the rider asked | 1 (loop: 3 to 27) | **Fix**: answer with the rider's own profile |
| Character lanes: fastest, scenic, twisty, adventure | `candidate-lanes.ts:92-121`, `plan-service.ts:689` | On | 3 to 4 | **Merge** into one wave (step 6) |
| Loop engine: random turning point, 3 seeds, 2 time corrections, 2 re-seeds | `request-builder.ts:799`, `provider.ts:111,120,220,394` | On | 3 to 27 per lane, so 12 to 108 per loop | **Replace** (step 5). About half of answers rode a dead end (PR #210) |
| Curvy A-to-B search | `curvy-search.ts:12-15`, cap 1.35 | On (`OGV_CURVY_SEARCH`) | +2 with alternatives | **Merge** (step 6) |
| Curvy loop pick | `curvy-search.ts:75` | On | 0: picks among the random loops | **Replace** (step 5) |
| Balanced search | `balanced-search.ts`, cap 1.25 | On | +2 | **Merge** (step 6) |
| Dirt A-to-B sweep, 7 strengths with alternatives | `rider-mode-search.ts:72-74,161-166`, cap 1.75 | On | +7 | **Merge** to 2 strengths (step 6) |
| Dirt loop tours from the Gravel Atlas | `plan-service.ts:842-843,1003-1050`, `atlas-generators.ts`, `atlas-dirt-loops.ts`, `corridor-prize-loop.ts` | On for loops | +2 to 4 | **Replace** (step 5). 0 of about 20 tours survived the dead-end check (PR #210): pure cost today |
| Atlas probes on A-to-B, backroad stitch | same files | Off | 0 | **Delete** (step 3) |
| Curve rules ("ride formula" rules) | `ride-formula-rules.ts:26`, `provider.ts:298` | Off (`shadow` only reports) | 0 | **Turn on** as one extra candidate (step 2) |
| Ride Formula scorer, 28 variables | `ride-formula.ts`, `domain/route/ride-formula.ts` | Shadow: diagnostics only | 0 | **Delete** (step 2). Benchmark: 5 wins, 7 losses, 16 ties |
| Fun generators (4 strategies from the 112-route library) | `fun-generators.ts`, `fun-generator-strategies.ts`, 6 more files, 3,083 lines | Shadow: runs after the answer, logs only | 2 detached | **Delete** (step 3); the one idea that worked moves into step 6 |
| Jev fun judge | `fun-judge*.ts`, `jev-fun-judge.ts` | Off | 0 | **Delete** (step 3) |
| Jev frontier shadow, replay, evaluation | `jev-frontier-*.ts`, `frontier-*.ts`, 2 scripts; 4,868 lines with the judge | Never imported by production (`tests/architecture/jev-shadow-boundary.test.ts:62`) | 0 | **Delete** (step 3) |
| Jev character label | `plan-service.ts:1439-1456`, `jev-fun-character.ts:98` | On when the key is set; the plan waits up to 0.8 s | 0 (1 LLM call) | **Delete from planning** (step 3) |
| "Routing methods" panel with "Jev's read" | `RoutingMethodComparison.tsx:74`, `PlannerWorkspace.tsx:850` | On, in the rider's result panel | 0 | **Delete** (step 3, with shots) |
| Live-traffic refine | `plan-service.ts:1222` | Default on (`.env.example:100`); production value not checked | +1 | **Keep**, off the first answer |
| Hard gates: bike limits, access, closures, dead-end spur, avoid areas | `rider-road-eligibility.ts`, `road-authority.ts`, `dead-end-spur-eligibility.ts` | On | 0 (closures wait up to 2.5 s, `coordinator.ts:25`) | **Keep**. This is the trust bar |
| Draw a route, stops, shaping, road spans | `sketch-routing.ts`; searches skip them (`curvy-search.ts:57`) | On | 1 per chunk | **Keep** |
| Blocked final approach retry | `plan-service.ts:1234` | On | up to 3, only when blocked | **Keep** |
| AI advisor ("Ask") | `src/application/advisor/` | Not in the planning path at all | 0 | **Keep frozen** |

Two blunt notes. A shadow experiment's setting is also production's search budget (`plan-service.ts:834-835`). And there are six "how good is this ride" scorers (canonical score, ride formula, geometry-fun, fun assessment, fun-route measurement, the scorecard's own), so the planner optimises one thing while the scorecard counts another.

## 2. How a fun curvy route should be computed

**What the competitors do** (checked today):
- **Kurviger** is built on GraphHopper, the same engine as ours. Curviness is part of the road weights, offered as four fixed strengths: Fastest, Fast and curvy, Curvy, Extra curvy. Higher strengths "avoid cities even more" and accept longer detours. Loops take a distance and an optional direction; it also has an "avoid using the same road twice" option.
- **Calimoto** scores every road for twistiness and connects the high scorers (a reviewer's description, not an official one). Loops are a distance dial plus a direction. Its known flaw is bend farming: twisty mode snakes through towns and down "goat tracks"; an August 2026 update tries to avoid cities.
- **REVER** has one PRO toggle, Twisty Roads, that "seeks the most crooked roads between A and B" and avoids highways. Butler Maps is a hand-rated road overlay, not the router.

All three put curviness **inside the road weights** and expose a few fixed strengths. None runs candidate tournaments or AI judges. We can beat them with what they lack: dirt, bike limits, closures, and loops aimed at roads we already know are good.

**Target architecture: the "fun field". One sentence: teach the graph where the good roads are, ask it a handful of questions, score once.**

1. **Curves live on the road graph.** A pre-pass over the map data writes a local curve value on every road piece (`og_curve`, 0 to 1), using the same Franco maths the app already has (`src/domain/geometry/franco-curvature.ts`), joined across junctions and smoothed over 400 m so only the twisty part of a road lights up. The engine's built-in value only compares an edge's length with its straight-line length and resets at every junction, which is why it is weak. The baked profiles then penalise dull, urban and residential edges rather than reward bends, which is the guard against bend farming. Dirt already lives on the graph (surface, track grade, smoothness). Same four profiles, so router memory should not grow (confirm from the import log).
2. **Strength is a dial, not a search.** One detour budget, measured against the fastest route: Direct 1.15, Balanced 1.35, Scenic 1.75. Today there are three hidden caps (1.25, 1.35, 1.75) measured against different baselines.
3. **A-to-B = one wave of at most 5 calls:** fastest (the reference), the rider's profile at two strengths, and up to two "one good road" detours through a known good road near the direct line. That last idea is the only generator that earned anything in testing (new Best Ride on 2 of 4 trips, bends up 1.4 to 2.9 times, `2026-10-03-routing-generators.md`).
4. **Loops = a ring of through-anchors, not a random turning point.** At build time, mark anchors: the midpoint of each Gravel Atlas corridor and each rated curvy road (the 7,800-road catalogue, `known-roads-db.ts`) that **the router itself** rides straight through for each bike class. Today's dead-end check counts map links (`atlas-generators.ts:166`) and the router disagrees, which is why every tour was rejected. At request time, build three ring skeletons (two or three anchors each, sized from the ride time, aimed where good roads are dense), route each as one call on the rider's profile, correct the size once. At most 6 calls. Via points sit mid-road on through roads, so the U-turn spurs of PR #210 have no cause. If the anchor data is missing, fall back to the engine's own loop (core planning must not depend on an optional file).
5. **One gate, one scorer.** Hard gates stay exactly as they are. One measure of good miles, shared by the planner, the route card and the scorecard. Pick the most good miles inside the budget. Rank each candidate once.

Why this beats the pile: search can only choose among what the router offers, and the router is blind today. With the field, the first answer is already the right kind of ride, so the sweeps, seeds, shadow families and judges have nothing left to do. Paved and dirt, A-to-B and loop all use the same parts.

## 3. Jev and AI

- **Jev judge: delete.** Measured on 16 live plans: it agreed with the plain scorer 14 of 14 times and would have changed 0 of 16 Best Rides (`2026-10-03-routing-jev.md`). It also flipped its answer when the order of routes was reversed.
- **Jev frontier harness: delete.** No production code imports it.
- **Jev character label: remove from planning.** It only names a winner that is already picked (Flowing, Twisty, Backroad, Dirt), from numbers the planner already holds; the plan waits up to 0.8 s for it; and it is shown only in a research panel. A plain rule over the same numbers can name the ride. If the owner wants Jev's voice, fetch it after the route is on screen, never before.
- **Advisor ("Ask"): keep, frozen, explainer only.** It is not in routing today and should never be.

## 4. Speed

Slow today because: (a) loops multiply lanes by seeds by corrections by re-seeds, 12 to 108 searches, with only 3 allowed at once (`concurrency.ts:4`); (b) dirt A-to-B adds 7 alternative searches at 4 to 7 s each; (c) the server re-runs the whole ranking pipeline for every screen and verify step (`plan-service.ts:1094,1105,1117`) on one thread: "6 s alone, 16 to 23 s together" (`client-planning-service.ts:286-290`); (d) the plan waits for Jev (0.8 s) and closures (up to 2.5 s); (e) heavy request-time penalties probably weaken the engine's landmark speed-up (estimate, not measured); (f) the production box has 8 GB with swap 96% full (`docs/PLAN.md` risk 2).

Also: the 5-second bar is met today by showing the **fastest** route first, then swapping it 6 to 30 s later for the ride that was asked for. That is not an honest first route.

Target: first answer is one call on the rider's own baked profile (loop: one skeleton). Full answer is one parallel wave with a hard cap of 6 router calls per plan, one ranking pass, and nothing awaited except routing and the trust gates. The scorecard prints router calls and first-route seconds per ride, so the cap is checked on every PR.

## 5. Migration: one roadmap, six steps

Every step: `npm run scorecard -- --set tuning` through the SSH tunnel, wins not lower, trust failures 0, attached to the PR. Routing workers: Codex Sol (`delegate sol --wt <slug>`), Sonnet if quota is out. One heavy worker at a time.

| # | Rider sentence | What and files | Pass/fail | Worker, machine, size |
|---|---|---|---|---|
| 1 | "The score means what a rider means by fun." | Scorecard v2 (section 6): `scripts/scorecard/{measure,scoring,run,report,types}.ts`, `tests/unit/scorecard/`, `docs/PLAN.md` section 5; snap rider tracks with the existing `src/server/road-matching/match-service.ts`. No file under `src/` changes behaviour | Two runs identical; report prints v1 and v2 headlines, router calls and first-route seconds per ride; run exits non-zero unless "rider's own line beats fastest" on 10 of 12 tracked rides; `npx vitest run tests/unit/scorecard` | Sol, docker-dev, M |
| 2 | "Ask for twisty, get twisty." | **Is ROUND-PLAN 5.1 and `.fable/pkg2-brief.md`, with one correction.** Add the curve and arterial penalties as **one extra request** in the Curvy and Backroads wave and let the existing geometry-fun pick choose (`ride-formula-rules.ts`, `request-builder.ts:718`, `provider.ts:298`, `curvy-search.ts:12`, and `scripts/scorecard/run.ts:90`, which hard-codes the rules off). Do not apply them to every call: the 2026-10-04 run that did, together with the formula pick, lost 7 of 16 (`curvy-sweep-benchmark-2026-10-04.md`: Allentown to Stroudsburg fell from 114 to 39 curve points per km). Delete `OGV_RIDE_FORMULA` and the formula scorer | v2 curvy wins up by 2 or more, total not lower, trust 0; `grep -rc OGV_RIDE_FORMULA src scripts .env.example` prints 0 | Sol, docker-dev, S |
| 3 | "Planning stops waiting on things no rider sees." (plumbing PR) | Delete Jev judge, frontier, the four fun-generator strategies and their library probes, A-to-B atlas probes, the methods panel, and switches `OGV_FUN_GENERATORS*`, `OGV_JEV_*`, `OGV_ATLAS_GENERATORS`, `OGV_CURVY_SEARCH`. Search budget becomes a named constant. Jev label leaves `planRide` | Scorecard verdict per ride identical to step 2's run; `git diff --shortstat` shows 6,000 or more lines removed; grep for the four switch names prints 0; typecheck, lint, `npx vitest run tests/architecture tests/unit/planner tests/unit/server`; shots of the result panel | DeepSeek, Opus reviews, docker-dev, M |
| 4 | "The map itself knows which roads are twisty." | Graph v2: pre-pass `infra/graphhopper/og-curve.py` (pattern: `hike-access.py`), a small engine extension for `og_curve` (pattern: `build-hike-snap.sh`), the motorcycle `config.yml` moved into this repo, new `motorcycle-twisty.json` and `-scenic.json`; re-validate the atlas per bike class (`scripts/validate-gravel-atlas.ts`). Step 2's request rule is kept or deleted by the score | New router on the Windows PC: `curl -s localhost:8989/info` lists `og_curve`; shared fixtures agree with `franco-curvature.ts`; scorecard through a tunnel to `windows-zac`: curvy wins up by 2 or more, total not lower, trust 0. Production swap only with the owner's go | Sol, Windows PC, L |
| 5 | "Loops follow real gravel and real curves." | **Replaces ROUND-PLAN 5.2.** New `src/application/planner/loop-skeletons.ts` plus an anchors table from `scripts/build-gravel-atlas.ts`. Delete `atlas-generators.ts`, `atlas-dirt-loops.ts`, `corridor-prize-loop.ts`, `fun-generators.ts`, `OGV_DIRT_LOOP_GENERATORS`, `OGV_ATLAS_CALLS`; the seed and re-seed code in `provider.ts` stays only as the no-anchors fallback | Loop rides (1 to 11, 13, 14): 3 or more extra wins, good miles over fastest above +250, trust 0, every loop plan 6 router calls or fewer; `npx vitest run tests/unit/planner/loop-skeletons.test.ts` | Sol, docker-dev, atlas build on Windows PC, L |
| 6 | "Tell it how far out of your way you will go, and see a real route in 5 seconds." | **Replaces ROUND-PLAN 5.3.** One budget dial, one wave: new `ride-search.ts` replaces `rider-mode-search.ts`, `curvy-search.ts`, `balanced-search.ts`; first answer uses the rider's profile (`candidate-lanes.ts:180`); rank once (`plan-service.ts`); dial in `RideStyleControls.tsx` | No ride over budget; 12 or more wins; first-route seconds at the 75th percentile 5 or less; every plan 6 calls or fewer; `--set holdout` on ship day within 2 of tuning | Sol for routing, Opus for the dial, docker-dev, M |

Expected wins (estimate, v2 yardstick): after step 2, 4 to 6; step 4, 8 to 10; step 5, 12 to 14; step 6, 14 to 16. Planner code around the router falls from about 11,000 lines to under 3,000.

## 6. Is the scorecard measuring fun?

Trust failures and dirt miles: yes. Curvy: **no**, for four reasons.

1. **The curvy loop bar cannot be reached.** A curvy loop wins only if 25% of its length is "bend metres" (`scoring.ts:16`), counted as tight curves under 175 m radius (`measure.ts:24,42`). In the 2026-10-04 benchmark, the highest bend share among 80 real router routes was 7%. The riders' own tracks in the tuning set never exceed 9.8%, and the six curvy ones measure 0.4% to 4.6% (measured today on the stored tracks, which are thinned, so they read low). Five of the 20 rides (7 to 11) can never be a Win, and package 2's pass line ("curvy wins 0 to 4 or more") is out of reach on this yardstick.
2. **It counts corners as curves.** The scorecard measures raw geometry with no junction filter, so a zig-zag through a street grid scores as good miles. The planner's own measure filters junctions, town streets, ramps and roundabouts and counts long sweepers (`geometry-fun.ts:8-12`, `src/domain/geometry/heading-fun.ts`). Planner and scorecard disagree about what a curve is.
3. **Two clocks.** The planner allows dirt 75% over (`rider-mode-search.ts:47`) and measures each cap against its own baseline; the scorecard fails anything 35% over the plain fastest route (`scoring.ts:8`). Rides 15 and 20 lose on time alone (PR #210).
4. **Speed is the wrong number.** It times the full plan with requests forced into single file (`run.ts:77`), not the first route the PLAN bar is about.

**Smallest change that makes it trustworthy (step 1):**
- Curvy good miles come from the planner's own `analyzeGeometryFun` bend metres, in one shared module, as PR #210 did for dead ends.
- Add a third contestant, shown on every row: **the rider's own line**, snapped to our roads and measured with the same code. It is never used to plan and never scored as "match the rider".
- **Yardstick check:** the rider's hand-picked line must beat the fastest route on good miles on at least 10 of the 12 tracked tuning rides. If the measure cannot tell a rider's favourite road from the highway, it is not measuring fun, and the run fails.
- Set the curvy share threshold once, at 75% of the median rider-line share on the tuning set, and freeze it with the manifest hash. It is set from what riders rode, not from what our router returns, so it cannot be tuned to our output.
- Print router calls and first-route seconds per ride, and the 75th percentile.
- Print the v1 headline beside v2 until the bar is met, so nobody can say the goalposts moved quietly.

Guards against tuning to the test stay as they are: the hold-out set runs only on ship days, and the owner's ride days decide. (My track measurement read the geometry of both sets but involved no routing; the hold-out tracks show the same low bend shares.)

## Sources

Kurviger: docs.kurviger.com/general/definitions; wiki.openstreetmap.org/wiki/Kurviger. Calimoto: waltinpa.com/calimoto-app-review; meetmobility.com/reviews/calimoto-route-planning-and-tracking-review. REVER: rever.co/post/twisty-roads-is-here; rever.co/help/butler-maps. GraphHopper curvature value: graphhopper.com/blog/2023/03/14/graphhopper-routing-engine-7-0-released. Scorecard history: GitHub PR #210.
