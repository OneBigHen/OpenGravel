# Routing master plan: top tier in PA and NJ (2026-11-11)

Read from `round/r3b` at 3e79088c, the N6 scorecard run (`latest.json`, 7/20), the live router through the
tunnel on :8989 (13 timing calls, no scorecard run), docker-stable and the Windows PC (both read-only).
Nothing was built. "Measured" means I ran it today. "Estimate" means I did not.

This replaces steps 3 to 6 of `ROUTING-PLAN.md`. Steps 1 and 2 are done (scorecard v2, N6).
One brief per package is in `.fable/briefs/rm-*.md`.

## 0. Verdict

1. **The router is already fast. The app around it is slow.** Measured today on production: one route
   takes 0.05 to 0.25 s, a 200-mile route 1.0 s, a three-leg loop 0.08 s. A loop plan makes 21 to 53
   calls where 6 would do, sends them three at a time, and re-ranks on every step. The 5-second target is an
   app fix, not a hardware one.
2. **"Twisty" today is the fastest route with a different label.** Allentown to Stroudsburg: twisty
   34.9 miles, fastest 34.8 miles, same road (measured). The remap is the fix, and it is cheap: a full
   PA + NJ graph builds in about 10 minutes on the Windows PC (estimate from the last build's file times).
3. **15 of 20 is reachable only with a fairer win rule, and I am saying so plainly.** Under today's rule
   (v2) the ceiling is about 11 to 13, because 6 rows cannot win whatever we route (section 2). Under the
   corrected rule (v3) today's routes already score 11, and the plan should land 15 to 17. Both numbers
   are printed side by side on every run, for good.
4. **The tuning set has no New Jersey ride at all.** "15+ in NJ and PA" cannot be shown today. Package
   RM-0 adds a fixed 10-ride NJ set, chosen in this document before any run.
5. **Rerouting works but replans the whole rest of the ride.** The fix is to route only back onto the
   line and keep the rest untouched, so twisty stays twisty by construction (section 7).

Two corrections to my own `ROUTING-PLAN.md`:
- It said the twisty profile has no curve term. Wrong. Production merges three files
  (`motorcycle-base.json`, `prefer-curvature.json`, `motorcycle-twisty.json`), and the middle one
  penalises straight edges using the engine's weak built-in value. The conclusion stands: that value
  cannot steer (N6 proved it), but the sentence was wrong.
- It said the first answer is always the fastest profile. That was fixed since (`firstAnswerLane`,
  `candidate-lanes.ts:219`): the first answer already uses the rider's profile.

## 1. What I found on the machines

| Where | Fact |
|---|---|
| docker-stable router | `og-graphhopper.service`, GraphHopper 11.0, `java -Xmx4g -jar /root/Vibe/switchback/data/graphhopper-web-11.0.jar server /root/Vibe/switchback/infra/graphhopper/config.yml`, port 8989 (admin 8990), 3.0 GB in use. Graph in `/root/Vibe/switchback/data/graph-cache` (1.3 GB, built 2026-10-04). Four landmark profiles, 233 MB each. No rollback copy on disk today |
| docker-stable box | 8 GB RAM, 2.5 GB available, swap 2.0 of 2.0 GB used, disk 6.1 GB free. **Two routers cannot run side by side in RAM** |
| App to router | `ogv.service` reads `GRAPHHOPPER_URL=http://127.0.0.1:8989`; atlas at `/var/lib/opengravel/gravel-atlas-v3.sqlite` |
| Router config | Lives only in the frozen `switchback` repo, with the build scripts (`scripts/graphhopper.sh`, `bootstrap-data.sh`, `prepare-motorcycle-osm.mjs`). This repo holds copies of the custom models only |
| Windows PC | 16 cores, 50 GB RAM, Java 17 with `javac`. `~/ghbuild/` holds the same jar, the same `pa-nj-motorcycle.osm.pbf` (496 MB, map data up to 2026-08-02, already passed through the motorcycle access normaliser) and the same graph as production. 891 GB free on `/mnt/wsl/ogv-data` (use that, not the 62 GB home disk). `osmium` 1.16 at `/mnt/wsl/ogv-data/trails/tools/usr/bin`, pyosmium in `/mnt/wsl/ogv-data/ghbuild-hike/venv`, atlas build folder `~/ga`. No router running. `~/dev/OpenGravel` is at 1ba87ed (stale) |
| Engine extension points (checked in the jar) | `GraphHopper.setImportRegistry`, `ImportUnit.create`, `postImportOSM()` (where the engine computes its own town-density value, before landmarks are prepared). `GraphHopperManaged` builds a plain `new GraphHopper()`, so a small classpath overlay is needed, the same pattern as `build-hike-snap.sh` |
| Tunnel | Local port 8989 is forwarded to production now |

## 2. The yardstick: what is unfair, and the honest fix (scorecard v3)

Rows that cannot win under v2, whatever the router does:

| Row | Why it cannot win | What a rider would say |
|---|---|---|
| Allentown, Hawk Mountain, Doylestown, Harrisburg (curvy A-to-B) | Needs 3 more bend miles than the fastest route. Riders' own favourite loops hold about 3 bend miles in 95 miles. A 14 to 40 mile trip is asked for 2 to 7 times the bend density riders themselves choose | "It was as twisty as my favourite roads" is a win |
| Old Buck loop (gravel) | We found 28.5 dirt miles; the rider who made the loop found 25.9, in 88 more minutes. Scored a Tie because the share is under a flat 35% | Beating the person who designed the ride is a win |
| Green Buch loop (gravel) | 8.2 dirt miles at 26% share against the rider's 7.9 at 18%. Tie for the same reason | Same |
| Phoenixville | Broken row: a 72-mile rider loop whose ends are 1.4 miles apart was stored as a 1.4-mile A-to-B | Not a ride |

**v3 changes exactly three things. Everything else in the rule stays.**

1. **Curvy A-to-B is judged like a curvy loop:** good-mile share at or above the frozen rider bar (2.39%),
   and still at least 1.5 times the fastest route's good miles. The "+3 miles" test stays for dirt, where
   3 miles is something a rider feels.
2. **Par rule for loops that have a rider's line:** a loop also wins when it has at least as many good
   miles **and** at least as high a good share as the rider's own line, and 1.5 times the fastest loop.
   Both conditions, so a shorter loop cannot game it.
3. **Phoenixville is repaired** as the loop it is, by a stated rule (a track whose ends are within 5 km
   and whose length is over 20 times that gap is a loop).

Guards: every number in v3 comes from riders' lines or from the old rule, none from our router's output.
The threshold stays frozen at 2.39% (the repair does not change any rider line). v2 and v1 headlines are
printed beside v3 on every run. The hold-out set is scored under both rules on ship day.

**Computed today from `latest.json`, no router calls:** the same 20 routes score **11/20 under v3** and
7/20 under v2. The four rows that change are Green Buch, Old Buck, Allentown and Doylestown. The owner
should hear this in one sentence: "4 of the 15 come from a fairer ruler, not from better routes."

Also in RM-0, because the current numbers mislead:
- **First-route time is measured wrongly.** It times the first provider call of the full plan in single
  file. v3 times a real first-answer request, the way the app sends it, and reports p50, p75 and p95.
- **Two clocks.** Twisty and adventure times ignore speed limits; fastest obeys them. Hawk Mountain shows
  our 33-mile route as 6 minutes quicker than the 28.7-mile fastest route. The graph rebuild gives our
  profiles the same clock as fastest (section 4). The fastest profile itself is not touched, so the
  baseline stays the baseline.

**The NJ set (fixed here, before any run; `--set nj`, headline printed separately, target 7 of 10):**

| # | Ride | Mode |
|---|---|---|
| 1 | Catalog: Kitchen Sink Loop (South Jersey), `fb-902850f532a356f57e1c` (rider's line kept) | curvy |
| 2 | Catalog: South Jersey Pine Barrens, `project-gpx-bf5b7ac152d746902354896a--t2` (rider's line kept) | gravel |
| 3 | Loop, 2 h, from Newton (41.058, -74.753) | curvy |
| 4 | Loop, 3 h, from Frenchtown (40.526, -75.062) | curvy |
| 5 | Milford NJ (40.5687, -75.0946) to High Point State Park (41.3207, -74.6618) | curvy |
| 6 | Lambertville (40.3659, -74.9429) to Clinton (40.6368, -74.9099) | curvy |
| 7 | Loop, 2 h, from Branchville by Stokes State Forest (41.146, -74.752) | gravel |
| 8 | Loop, 2 h, from Chatsworth (39.8176, -74.5354) | gravel |
| 9 | Batsto Village (39.6418, -74.6477) to Chatsworth (39.8176, -74.5354) | dual-sport |
| 10 | Blairstown (40.9829, -74.9596) to Walpack Center (41.1587, -74.8793) | gravel |

Reserves, used in order only if a ride cannot be planned at all on the production graph: Hackettstown
(40.8540, -74.8291) to Belvidere (40.8298, -75.0777) curvy; loop, 2 h, from Hammonton (39.6365, -74.8024)
gravel. Honest warning: Pine Barrens dirt is mostly sand, and sand is a trust failure. Rows 8 and 9 may be
honest Ties. We report that; we do not swap the rides.

## 3. Target architecture in one picture

```
build (Windows PC)                         request (app)
------------------                         -------------
PA+NJ map file (already normalised)        first answer: 1 call, rider's profile  -> on screen
  -> import with the og extension          full plan:   1 wave, <= 5 calls (A-to-B) or <= 6 (loop)
     og_curve    curve field per road        fastest (reference)
     og_through  not a dead end               rider's profile, normal and strong
     same clock for our 3 profiles            up to 2 detours through a known good road / 3 loop rings
  -> 4 landmark profiles (same names)      one gate (trust), one scorer (good miles), rank once
  -> anchors table from the atlas,         reroute: <= 3 short calls back onto the line, splice
     checked against this graph
```

## 4. Graph v2: what the graph learns

| Field | What it is | How |
|---|---|---|
| `og_curve` (0 to 1) | Bend density of the road around this edge: weighted bend metres within 500 m either way along the same road, divided by the metres covered, scaled so 20% reads as 1 | Computed **inside the import**, after the map is loaded, with the same maths as `road-bends.ts` (175 / 100 / 60 / 30 m radius bands, 30 m minimum arc, roads that earn). Pinned to the app by shared fixtures |
| `og_through`, `og_through_street` | True when the edge is not dead-end territory: it sits in a connected part of the network with at least 20 km of roads once every "only way in" edge is removed. The street version ignores unpaved roads and rough tracks | Graph bridge-finding inside the import. This is the dead-end and through-anchor data, computed by the router itself |
| `osm_way_id` | Built-in. Lets us join our own facts later and debug | Config only |
| Kept | All 13 values production has, including `curvature`, so today's app works on the new graph unchanged | |

**Decision: no map-file pre-pass for curves.** My October design wrote the curve onto the map file and
split roads where it changed. Splitting roads breaks turn-restriction records (they name roads by id),
which would let the router make illegal turns. Computing the field inside the import has no such risk,
gives one value per junction-to-junction piece (the finest thing a router can use), and needs no second
copy of the maths in Python. The window along the road is what gives routing leverage: a per-edge value
alone makes a 10 km twisty road only 4% cheaper than a straight one; the windowed value makes it about
30% cheaper (worked example in `rm-1`).

**Not in this graph, on purpose:** elevation (no score for it, bigger build), baked closures (they change
weekly; the request-time gate stays), rider tracks (they would leak the hold-out set into the graph).
Permanent no-motorcycle roads (`og_access`) and a map refresh wait for RM-9.

**Profiles v2** (same four names, so memory should not grow; confirm in the import log):
- `motorcycle_fastest`: byte-identical to today. It is the baseline.
- `motorcycle_twisty`: drop `prefer-curvature.json`; penalise dull edges by `og_curve` band; penalise
  primaries, town streets, service roads and city edges (the guard against bend farming; today
  residential streets get a small *bonus*, which is backwards); honest clock.
- `motorcycle_scenic`: a mild version of the same.
- `motorcycle_adventure`: road logic unchanged, honest clock only. It wins today; do not disturb it.
- Strength is a request-time rule on `og_curve` (landmarks allow penalties only), not a fifth profile.
  Measured cost of request-time penalties today: 0.58 s against 0.08 s, so the default strength must be
  baked and only "strong" pays that.

Starting numbers are in `rm-2`. They are calibrated on the tuning set only, three rebuild rounds at most.

## 5. The build recipe (Windows PC)

All under `/mnt/wsl/ogv-data/ghbuild-moto-v2/` (`B` below). Scripts go over ssh with the base64 trick.

```
inputs   ~/ghbuild/pa-nj-motorcycle.osm.pbf   (same file as production; record its sha256)
         ~/ghbuild/graphhopper-web-11.0.jar    (same jar as production)
         repo branch with infra/graphhopper/moto/  (RM-1)

1. extension   infra/graphhopper/moto/build-og-ext.sh $B/graphhopper-web-11.0.jar $B/og-ext
               -> $B/og-ext/og-ext.jar  (javac only; the upstream jar is never modified)
2. import      cd $B && java -Xms4g -Xmx12g -XX:+UseParallelGC \
                 -cp og-ext/og-ext.jar:graphhopper-web-11.0.jar \
                 com.graphhopper.application.GraphHopperApplication import config-v2.yml | tee import.log
3. serve       same classpath, `server config-v2.yml`, -Xmx4g, 127.0.0.1:8989 inside WSL, detached
4. tunnel      on docker-dev: ssh -N -L 8988:127.0.0.1:8989 windows-zac
               (8989 stays production; if WSL does not forward localhost, bind 0.0.0.0 in WSL)
```

Expected (estimates): import 4 to 6 minutes, field and through passes 1 to 2, landmarks 2 to 4, so under
15 minutes; 12 GB heap is far more than needed (production's own script imports with 5 GB); graph
1.33 to 1.40 GB (today 1.28 GB); serving memory about 3.0 to 3.1 GB. A profile-only change needs just the
landmark step again (about 3 minutes).

**Verify (`infra/graphhopper/moto/probe-graph.py`, exits non-zero on any miss):**
1. `/info`: version 11.0, the four profile names, every old value plus `og_curve`, `og_through`,
   `og_through_street`, `osm_way_id`, same bounding box.
2. Baseline unchanged: 20 fixed A-to-B pairs on `motorcycle_fastest`, distance and time within 1% of
   production. `turn_costs` file the same size as production's (1,048,676 bytes): no restriction lost.
3. Field yardstick: on the 6 curvy tuning rides with a rider's line, mean `og_curve` along the rider's
   line beats the fastest route's on at least 5; rank agreement (Spearman) of `og_curve` with the
   scorecard's bend share across all measured lines is 0.8 or better.
4. Through flags: 95% of 20 atlas corridors with a way in and a way out read true; 95% of 20 with no way
   out read false.
5. Speed: 40 single routes per profile, p95 0.6 s or less. Memory after 200 requests 3.3 GB or less.

**A/B:** `GRAPHHOPPER_URL=http://127.0.0.1:8988 npm run scorecard -- --set tuning` against the same
commit on :8989. Use a separate worktree copy per graph so `scorecard-out/` caches never mix; re-snap
rider lines on the new graph (`--refresh-rider-lines`); do **not** re-freeze the threshold.

**Ship (RM-7), with rollback:**
1. Copy graph, `og-ext.jar`, config and models to `/var/lib/opengravel/router/v2-<date>/` on
   docker-stable (1.4 GB; 6.1 GB free). Check sha256 against the Windows build.
2. Side-by-side smoke on port 8991 using memory-mapped files, a 1 GB heap and a hard systemd memory cap of
   1.8 GB, so it cannot push the live router out. Run the probe set through it, then stop it.
   (Memory-mapped setting: `graph.dataaccess.default_type: MMAP`; confirm the key on the Windows rehearsal.)
   The full scorecard A/B is the Windows run on byte-identical files; the box has no RAM for two full
   routers.
3. Swap: one systemd drop-in that points `og-graphhopper.service` at the new classpath, config and graph,
   then one restart (about 40 s without routing, an estimate RM-2 replaces with the measured load time;
   do it at a quiet hour). The old graph, jar and config
   are never touched.
4. After: health, probe set, the hold-out scorecard (it is ship day), app smoke test.
5. Rollback: delete the drop-in, restart. Rehearse both directions on the Windows PC first. Today's app
   works on either graph, and the new app code asks the router what it carries, so app and graph roll
   back independently.

## 6. Planner: loops, A-to-B, one scorer, speed

**Loop anchors (RM-5).** Built once per graph by `scripts/build-loop-anchors.ts` from the Gravel Atlas
(8,144 corridors, 505 of them in NJ), each checked on the running v2 router: it must ride through at
about its own length and read `og_through` true for the bike class. The table carries position, heading,
length, quality, grade, sand share and the graph's import date; a table built for another graph is
ignored. At request time: size a circle from the ride time, pick three directions where good anchors are
dense, build three rings of two or three anchors, route each as **one** call on the rider's profile with
dead-end territory penalised, correct the size once. At most 6 calls. No random turning points, so the
engine's "could not find a valid point" failures (34 in the last run) disappear. No anchors nearby, or
no table: the engine's own loop, one seed. Core planning never depends on the file.

**A-to-B, one wave (RM-4).** At most 5 calls, sent together: fastest; the rider's profile (this is also
the first answer); the rider's profile at "strong"; up to two detours through a known good road inside
the budget. For dirt, "strong" is the existing dirt strength, so the 7-call sweep goes.

**One budget.** Direct 1.15, Balanced 1.35, Scenic 1.75, measured against the fastest route on one
clock. Default Balanced, which is also the scorecard's limit. Replaces the three hidden caps
(1.25, 1.35, 1.75).

**One scorer.** `src/domain/route/good-miles.ts`: dirt metres in gravel modes, `bendMeters` in curvy.
The planner's pick, the route card and the scorecard import the same function. Hard gates unchanged.

**Speed budget.**

| Step | Budget | Today (measured) |
|---|---|---|
| One router call, single route | 0.6 s p95 | 0.05 to 0.25 s; 1.0 s for 200 miles |
| First answer on screen | 5 s p95, 1 router call | not measured honestly yet (RM-0) |
| Full plan | 6 calls at most, one wave, 8 s p95 | 21 to 53 calls on loops, 6 to 11 on A-to-B; 75th percentile 37 |
| Reroute | 3 calls at most, 3 s p95 | one full replan |
| Calls in flight, whole server | 8 | 3 (`concurrency.ts:4`) |

**Deletions (RM-3 first, then with each package).** Jev judge, frontier harness, fun generators, library
probes, methods panel and their switches (over 5,000 lines) go in RM-3 with identical scorecard
verdicts. `curvy-search.ts`, `balanced-search.ts`, `rider-mode-search.ts` go with RM-4.
`atlas-generators.ts`, `atlas-dirt-loops.ts`, `corridor-prize-loop.ts` and the seed, calibration and
re-seed loops in `provider.ts` go with RM-5 (one seed stays as the fallback).

## 7. Rerouting: rejoin and splice (RM-6)

Today (`guided-reroute.ts`, `reroute.ts`): one request from the rider's position to the end. Loops get up
to 15 shaping points along the rest of the loop, so the whole remainder is routed again and can change.
A-to-B keeps the profile but loses the line that was chosen.

New rule: **route only the way back; keep the rest of the ride byte for byte.**

1. When off route, take up to three rejoin points on the line ahead: about 0.8, 3 and 8 km beyond the
   nearest point ahead. Never beyond the next stop still to visit, never inside a spot the rider reported.
2. One short call each, together, on the ride's own profile, with the rider's heading (no "turn around"),
   bike limits and reported spots applied.
3. Pick the earliest rejoin that needs no U-turn, unless a later one saves more than the good miles it
   skips are worth. Splice: connector plus the original line from the rejoin point, turn list and surface
   spans carried over.
4. Trust gates run on the connector only (the rest already passed).
5. If no connector passes, or the best one costs more than a quarter of the time left: today's single
   replan to the end, on the same profile.
6. If the rider ignores two reroutes in a row, the next one rejoins further ahead.
7. **Rider reports reroute the ride in progress.** A report on the line ahead (R3-6) triggers the same
   steps, with rejoin points beyond the reported spot.
8. No signal: unchanged (R3-7). The line stays; reroute when signal returns.

Works on the old graph. Proven by new ride-sim scenarios (bound in 5 s, remainder identical, good miles
kept, report avoided) and one live-router test.

## 8. Work packages, in order

| # | Rider sentence | Owner | Machine | Size | Needs |
|---|---|---|---|---|---|
| RM-0 | "The score is fair, shows NJ, and times what I actually wait for." | Sonnet | docker-dev | M | none |
| RM-1 | "The map itself knows which roads bend and which are dead ends." | Opus | Windows PC | L | none |
| RM-2 | "Ask for twisty, get twisty." Profiles v2, build, probes, A/B | Opus | Windows PC + docker-dev | M | RM-0, RM-1 |
| RM-3 | "Planning stops waiting on things no rider sees." Deletions | DeepSeek, Opus reviews | docker-dev | M | RM-0 |
| RM-4 | "A-to-B in one go, inside the detour I allowed." | Opus | docker-dev | L | RM-3 |
| RM-5 | "Loops follow real gravel and real curves, and never a dead end." | Opus | docker-dev, anchors on Windows | L | RM-2, RM-4 |
| RM-6 | "Miss a turn and it puts me back on my ride, not a new one." | Opus (module), Sonnet (wiring, ride-sim) | docker-dev | M | none |
| RM-7 | "The new map is live, and one command puts the old one back." | Opus, hands-on | docker-stable | S | RM-2 pass, owner's go |
| RM-8 | "First route in 5 seconds, and a dial for how far out of my way." | Sonnet (gate), Opus (dial) | docker-dev | S | RM-4, RM-5 |
| RM-9 | After 15+: map refresh, permanent no-motorcycle roads baked in | Sonnet | Windows PC | M | RM-7 |

Three lanes, at most three open PRs: **graph** (RM-1, RM-2, RM-7), **planner** (RM-0, RM-3, RM-4, RM-5,
RM-8, one after another: they share `plan-service.ts`), **ride** (RM-6, any time). Day one: RM-0, RM-1
and RM-3 together. The graph lane's heavy work is on the Windows PC, so docker-dev carries one scorecard
at a time and nothing heavier. If a package fails twice with its owner, one attempt by Codex Sol, then
park it (AGENTS.md).

Every routing PR attaches a tuning scorecard run: v3 wins not lower, trust failures 0. The hold-out set
runs once, on ship day.

## 9. Scorecard ladder (estimates, except the first two rows)

| After | v3 wins | v2 wins | Which rows move, and why |
|---|---|---|---|
| Today, N6 (measured) | n/a | 7 | |
| RM-0, same routes (computed) | 11 | 7 | Green Buch, Old Buck, Allentown, Doylestown: rule only. Phoenixville becomes a loop row, probably a Tie |
| RM-3 | 11 | 7 | Must be identical. That is its pass line |
| RM-2, new graph, today's planner | 12 to 13 | 7 to 9 | Hawk Mountain; one of Hawley or Crystal Cave |
| RM-4 | 13 to 15 | 8 to 10 | Lock Haven stops losing on time and wins on dirt; Harrisburg Loss to Tie |
| RM-5 | 16 to 18 | 12 to 14 | Hawley, Crystal Cave, Phoenixville, Rothrock, maybe Quick and the Dead |
| Planning figure | **15 to 17** | **11 to 13** | Discounted for what will not pan out |

Rows I do not expect to win: Williamsport to Waterville (there may be no dirt between them inside the
budget) and Harrisburg to Lancaster (flat farmland). NJ: first number comes from RM-0; target 7 of 10.

**Stop rules.**
- A package that misses its scorecard line gets one fix attempt. If it still misses, stop, attach the row
  table, and bring it back to the advisor. No constant-tuning loops.
- RM-2: three calibration rounds at most. If curvy rows have not moved by then, ship the graph only if
  nothing got worse (it still carries the through flags and the honest clock) and say the field did not
  earn its keep.
- Any gravel row that was a Win and stops being one blocks the PR.
- If v3 reaches 15 but v2 is under 10, stop and tell the owner before calling it done: that would mean
  the rule is doing the work, not the routes.
- Hold-out on ship day: v3 within 2 of tuning, v2 not under today's 6, trust failures 0. A miss means no
  ship.

## 10. Risks, and what needs the owner

1. **Production RAM.** 2.5 GB available, swap full. The swap is a 40-second restart, not a hot switch.
   If the new router needs more than 3.3 GB it does not ship. Freeing memory (the frozen hiking router
   holds 0.2 GB; the speech model 1.2 GB) is the owner's call and not required by this plan.
2. **The Java extension is the one hard piece.** About 500 lines against GraphHopper internals. Guard:
   the baseline-parity probe (fastest routes within 1% of production) and the turn-restriction check.
   Fallback if it stalls: ship the profiles on the built-in value plus the through flags only.
3. **The fairer rule looks like moving the goalposts.** Guard: v2 beside v3 forever, the "v2 under 10"
   stop rule, hold-out under both rules.
4. **Sand in South Jersey** may hold NJ under 7 of 10 honestly. We report it.
5. **Map data is 3 months old** (2026-08-02). Refreshing it now would blur the A/B, so it waits for RM-9.
6. **Bend farming.** Guard: the field is zero on town streets, the profiles penalise them, and the
   existing residential and busy exposure limits stay in the pick.

**Needs the owner:** one "go" on ship day for RM-7, with the scorecard line and three screenshots, as the
standing rule says. Nothing else.
