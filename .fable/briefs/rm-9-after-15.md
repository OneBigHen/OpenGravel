# RM-9: after 15+: fresh map data, and no-motorcycle roads the router never offers

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off the then-current round branch.
Owner model: Sonnet (Opus reviews the access join). Machine: Windows PC for builds, docker-dev for
scorecards. Size: M. Plan: `.fable/ROUTING-MASTER.md` sections 4 and 10.
**Do not start before RM-7 has shipped and the tuning score is 15 or more.** Two parts, two PRs, each
with its own A/B, so a change in the score can be traced to one cause.

## Goal (rider sentences)
- "The map is this month's, not last summer's."
- "It never even offers a road that is closed to motorcycles for good."

## Current state
- The router's map file (`pa-nj-motorcycle.osm.pbf`) holds map data up to 2026-08-02. It was made by
  merging the Geofabrik Pennsylvania and New Jersey extracts and running the motorcycle access
  normaliser (`prepare-motorcycle-osm.mjs`, copied into `infra/graphhopper/moto/` by RM-1; the original
  steps are in switchback's `scripts/bootstrap-data.sh`).
- Tools on the Windows PC: `osmium` 1.16 at `/mnt/wsl/ogv-data/trails/tools/usr/bin` (needs
  `LD_LIBRARY_PATH=/mnt/wsl/ogv-data/trails/tools/usr/lib/x86_64-linux-gnu`), Node 24.
- Roads permanently closed to motorcycles (Game Commission roads, administrative forest roads) are
  caught per request by the road-authority gate (`src/server/planning/road-authority.ts`). When the
  feed does not answer in time the route can slip through: the hold-out run of 2026-11-11 had one such
  failure ("PGC Road is not open to motorcycles").
- The v2 graph carries `osm_way_id`, so a fact can be tied to a road.

## Part A: map refresh
1. `infra/graphhopper/moto/refresh-map.sh BUILD_DIR`: download the two Geofabrik extracts into a new
   dated folder, `osmium merge`, run the normaliser, record sha256 and the data date. Then
   `build-graph.sh` with the profiles exactly as shipped.
2. Re-check the atlas and rebuild the anchors table against the new graph (both are valid for one graph
   only).
3. A/B on tuning and NJ against the shipped graph, same code.
4. Ship with RM-7's scripts and the owner's go.

Pass / fail: `probe-graph.py` passes (the "fastest within 1%" check is replaced by "within 5% on at
least 18 of 20 pairs", because roads really changed; list the pairs that moved and why); v3 wins not
lower by more than 1, trust failures 0; every row whose verdict changed is explained in the PR by a
map change, not waved through. Write the refresh as a monthly step in `infra/graphhopper/README.md`.

## Part B: permanent no-motorcycle roads in the graph
1. A build-time join, `scripts/build-access-overrides.ts`: take only **permanent** prohibitions from
   the road-authority sources (not seasonal gates, not closures with dates), match each to roads by
   routing along its line on the v2 router with the `osm_way_id` detail, and write a list of way ids
   with the source and reason. A match needs at least 80% of the line's length on one way; anything
   less goes to a "not matched" report and is left to the request-time gate.
2. Apply the list to a copy of the map file as `motorcar=no` plus `og:access=prohibited` (keep the
   source id in a tag) using the same change-file method as the normaliser. Whole roads only: never
   split a road, so turn restrictions are untouched.
3. Rebuild, probe, A/B. The request-time gate stays on: the graph only removes what is certain.

Pass / fail: every prohibited road in the list is refused by all four profiles (route across it and
show the detour); 20 legal roads next to them still route as before; the hold-out failure case
replans without the PGC road with the authority feed switched off; tuning v3 wins not lower, trust 0;
the "not matched" report is attached.

## Not in this package
Seasonal closures in the graph (they change through the year; the request-time gate owns them), rider
tracks as a routing signal (they would leak the hold-out set), elevation, new states.

## Stop rule
If Part A moves the score by more than 1 either way and the cause is not clear from the changed rows,
do not ship it; keep the August map and report. If Part B blocks any road that is legal, it does not
ship until the join is fixed: a wrongly blocked road is a broken promise too.

## Rules
- Read `CLAUDE.md` and `AGENTS.md` first. Unknown is never turned into prohibited or into clear: only
  sources that state a permanent prohibition count.
- New folders only on the Windows PC; never `rm` with a wildcard; detach long runs.
- Never push to `main`; production changes only through RM-7's scripts with the owner's go.
- Final message: data date, the A/B lines, the roads now blocked, anything you could not do.
