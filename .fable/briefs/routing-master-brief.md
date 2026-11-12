# Routing master plan: top tier in PA and NJ — This codebase is yours

You are the advisor. Write `.fable/ROUTING-MASTER.md` in this worktree (`/root/Vibe/wt/og-r3b`,
branch `round/r3b` = everything built so far, including N6's bend-metres pick). Do not edit product code.

## Owner's goal (2026-11-11, verbatim intent)
"Quick route calculations, a full remap / relearning so it actually reroutes, and hits 15+ in New
Jersey and PA. Top tier. Cover all bases. The Windows PC is ready, execute."

So the targets are:
1. **Scorecard 15+ of 20 wins** on `npm run scorecard -- --set tuning`, with trust failures 0, and the
   hold-out set not worse (no overfitting). Wins must be honest: never game the yardstick. If the
   yardstick itself is unfair (your N6 verdict found curvy A-to-B needs +3 good miles that may not
   exist), say what change to the win rule is honest, justify it against what a rider feels, and keep
   the old rule's number reported beside it.
2. **Quick:** first route on screen in ≤5 s (p95) for A-to-B and loops; router calls per plan down.
3. **Full remap:** rebuild the routing graph with the curve field (`og_curve`, your ROUTING-PLAN.md
   section 2) plus whatever else the graph should learn (dirt, surface truth from N2/N3 data,
   rider-track evidence, dead-end/through-anchor data for loops, closures), for PA + NJ.
4. **Actually reroutes:** off-route rerouting during a ride is fast, keeps the rider's profile (twisty
   stays twisty, dirt stays dirt), rejoins the plan sensibly, and works with R3-6 rider reports.

## Read first
`.fable/ROUTING-PLAN.md` (yours: 6 steps), `.fable/N6-VERDICT.md` in `/root/Vibe/wt/.wt/og-next-og-n6/.fable/`,
`docs/PLAN.md`, `AGENTS.md`, `infra/graphhopper/` (custom models, build scripts), `scripts/scorecard/`,
latest scorecard output `/root/Vibe/wt/.wt/og-next-og-n6/scorecard-out/latest.json` (7/20 after N6),
`docs/vnext/research/graph-schema-v2-2026-10-04.md`.

## Machines
- **Windows PC** (`ssh windows-zac`, WSL Ubuntu, 50 GB RAM free, 16 cores, 62 GB disk free, Java 17,
  repo at `~/dev/OpenGravel`, stale). This is the graph build box. Scripts over ssh: use the base64
  trick, ssh→cmd quoting breaks `$`. Find out (read-only) what it already has: OSM extracts, GraphHopper
  jar/version, anything from earlier builds.
- **docker-stable** (CT109): production router on :8989 (GraphHopper), prod app. Find how the graph is
  deployed there today (read-only; never restart it). The new graph must be swappable with a rollback.
- **docker-dev** (here): 10 GB, edits and unit tests only. One heavy job at a time.

## What the plan must contain
- Work packages in order, each with: owner model (Opus for hard routing code, Sonnet for wiring/tests,
  DeepSeek for mechanical bulk), machine, files, and executable pass/fail checks.
- The exact graph build recipe on Windows: inputs, pre-pass (curve field etc.), GraphHopper config and
  custom models, import commands, expected size/memory/time, how to verify the graph (probes), how to
  ship it to docker-stable side-by-side (new port), A/B with the scorecard against prod, then swap.
- Loop anchors (through-anchors computed by the router itself), one-wave A-to-B, one scorer, speed
  budget, rerouting design, deletions of the guessing code.
- A scorecard ladder: expected wins after each package (estimate, labelled), and a stop rule if a
  package doesn't move the number.
- Risks and what needs the owner (should be nearly nothing; owner has said go).

You may run read-only commands, inspect the Windows PC and docker-stable read-only, and run at most
one scorecard if it settles a question (tunnel: port 8989 may already be forwarded locally; check).
Never `npm run build` or full test suites on docker-dev. End with a 10-line summary.
