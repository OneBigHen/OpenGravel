# Routing stack decision (2026-10-04)

The owner asked whether OpenGravel was reinventing the wheel, and wanted the stack defended before more
work. Two outside reviews ran (a ChatGPT critique, then a Codex rebuttal). Every claim below was
checked against the code on `main` (aebe24a).

## Verdict: keep the stack

GraphHopper -> bounded candidate generation -> hard eligibility -> evidence enrichment -> deterministic
scoring -> diversity -> roles -> advisory AI.

- **GraphHopper stays.** It already parses surface, smoothness, track type, road class and access, and
  has a proper alternative-route algorithm. Valhalla, BRouter and OsmAnd would bring the same problems in a
  different language. We borrow their *ideas*, not their engines.
- **Franco is reused, not reinvented.** `src/domain/geometry/franco-curvature.ts` reimplements the
  published method in TypeScript: radius bands 175/100/60/30 m, weights 1/1.3/1.6/2, the noise filter
  and the 300/1000 scale. No Franco source was copied. Franco is GPLv3+ and OpenGravel is AGPL-3.0
  (root `LICENSE`), which is compatible either way.
- **The AI stays advisory.** Jev only labels the deterministic winner's character (FLOWING, TWISTY,
  BACKROAD, DIRT_FOCUSED). `plan-service.ts` keeps it out of selection, roles and plan success. An
  earlier summary said "Jev judges the finalists"; that was wrong.

## What the reviews got right (verified)

| Claim | Status on main | Evidence |
|---|---|---|
| Surface share ignores unknown metres | True | `engineSurfaceMix`: share = unpaved / (paved+gravel+dirt). 1 km gravel + 9 km unknown reads 100% unpaved. |
| Coverage is recorded but never scored | True | `surfaceMix.coverage` is set; `scoreCandidate` reads only `.unit`. |
| Confidence = how many evidence keys exist | True | `evidenceCoverage()` counts keys / total keys, not metres measured. |
| Backroad is blunt | True | `backroadShare`: anything but motorway/trunk/primary counts the same (secondary = service road = track). |
| GraphHopper curvature is primitive | True | Endpoint beeline / edge length; edges end at every junction. Hence #61. |
| Base pipeline sees few candidates | True for default modes | `MAX_TOTAL_CANDIDATES = 6`. Dirt modes already sweep 7 strengths + alternatives (#74); Curvy now sweeps 5. |
| Oracle recall@K benchmark | Already built | #73 added a generator oracle and selection regret to `ride-formula-benchmark.ts`. |

## Corrections we accept

1. **Put a local curve value on each edge, not a road's total Franco score.** A road with half a mile of
   switchbacks between four straight miles must not light up end to end. Build `og_curve` (0-1) per
   edge from Franco's segment maths (weighted curve metres per edge length, with continuity), and keep
   the road-level score for display only.
2. **Bound the curve reward.** Rewarding curvy edges invites routes that zig-zag down side streets to farm
   bends. Combine it with road class, an urban penalty, turn/junction friction, the detour budget and
   continuity. One more constraint the reviews missed: the profiles use landmarks (LM), so request-time
   priority above 1 is clamped. Curves have to be expressed as *penalising straight, dull edges* in the
   baked profile, not as a bonus.
3. **Borrow BRouter/OsmAnd's feature list, not their numbers.** Split "dirt" into surface character
   (paved / gravel / natural), technical difficulty (track grade, smoothness, sand, mud), weather
   sensitivity and access confidence. Their numeric weights are for bicycles or other bikes.
4. **Freeze the graph schema before rebuilding.** A custom encoded value needs a small GraphHopper
   extension (one `TagParser` reading a pre-processed `og:curve` tag). That is the normal GraphHopper
   pattern. Design every graph-level field first so the PA/NJ rebuild happens once.
5. **Two benchmark sets.** A segment corpus for calibrating the primitives, and route-vs-route pairs
   for selection. Seed both from the 112 curated rides and the GPX corpus; the owner judges only the
   ambiguous pairs.

## Order of work

1. Ship the Curvy sweep (this PR): Cherry Hill -> Batsto and the 24.8 Franco/km regret.
2. Evidence semantics: separate measurement, coverage (metres measured / route metres) and confidence;
   unknown surface is never counted as gravel, and unknown access is never counted as safe. Scale each
   scoring component by what was actually measured.
3. Road character: replace `backroadShare` with a continuous value from road class, urban density,
   speed, junctions and traffic.
4. Graph schema design doc: `og_curve`, smoothness, track type, slope, access confidence.
5. ADV surface and difficulty model, plus a wet/dry switch.
6. Default-mode candidates: 8-16 distinct lines via GraphHopper alternatives and a few strength steps;
   MMR still trims to three.
7. Corpora, then one PA/NJ rebuild on powerplex, a new policy version, and promotion only on recall,
   pairwise accuracy, detour regret, unknown-surface exposure and zero illegal/closed-road picks.

## Step 1 result: Curvy sweep (live router, 2026-10-04)

Production pick, Franco curvature per km (full table: `curvy-sweep-benchmark-2026-10-04.md`):

| Trip | Before (#75) | After |
|---|---:|---:|
| Allentown -> Stroudsburg | 44 | 114 |
| Hawk Mountain -> Jim Thorpe | 23 | 29 |
| Doylestown -> New Hope | 37 | 61 |
| Harrisburg -> Lancaster | 51 | 91 |
| Reading -> Jim Thorpe | 58 | 76 |
| West Chester -> Lancaster | 43 | 53 |
| Bethlehem -> Delaware Water Gap | 58 | 88 |
| Cherry Hill -> Batsto | 13 | 15 |

Curvy production regret: 24.8 -> 11.9 Franco/km.

Why the rest of the gap remains:
- **Cherry Hill -> Batsto is correct, not a bug.** The 61-min, 35 Franco/km line is 31% busy road (the
  adventure profile's line). The rider asked to avoid busy roads, so the search rejects it (busy limit =
  pick + 10 pp). The benchmark oracle ignores busy share, so it overstates regret here.
- **Doylestown and Hawk Mountain pick the curviest line in their own pool.** The curvier oracle lines
  came only from Gravel Atlas probes in the formula treatment. That is a *generation* gap: the router
  does not know where the curves are. Step 4 (`og_curve` in the graph) is the fix.
