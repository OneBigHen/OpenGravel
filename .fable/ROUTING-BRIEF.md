# Fable brief: OpenGravel routing review

This codebase is yours. You are the routing advisor. Do not edit product code; write the plan.

## Owner's words (2026-11-10)
"Have Fable look into the routing too. It's complicated and can be made way better so fun curvy routes are calculated. We added tons of stuff, Jev algos, other stuff. I want Fable's opinion how we make all of this better, in addition to it all."

The owner vibe-codes and does not read code. It all has to be proven by running something (scorecard, real-router tests).

## Context
- Worktree `/root/Vibe/wt/og-worldclass` (branch `design/world-class`, = production code). Read `CLAUDE.md`, `AGENTS.md`, `docs/PLAN.md` (sections 1, 3, 5), and your own earlier plan `.fable/ROUND-PLAN.md` (section 5 has 3 routing changes; build on it, don't repeat it).
- Router: GraphHopper, PA+NJ, custom profiles (look for `motorcycle-*.json`, `request-builder.ts`). Planning entry: `src/server/planning/plan-service.ts`; planner logic `src/application/planner/` (rider-mode-search, curvy-search, atlas-generators, fun-generators, corridor loops, ride-formula rules), roads data `src/server/roads/` (curvature catalogue, gravel atlas, known roads), Jev ride-character judge (`jev`), AI advisor, frontier routing experiments. Docs in `docs/` (frontier-routing*, rider-first-routing-strategy, routing-method-comparison, ride-arc-analysis, library-corridor-routing, jev-frontier-shadow) are history: skim only for what was tried and measured.
- Scorecard: `npm run scorecard` (`scripts/scorecard/`, rides in `tests/scorecard/rides.json`). Last result: 4/20 wins, 0 trust failures. Bar: 16/20. Benchmark script `scripts/ride-formula-benchmark.ts`.
- Production health lists: curvature-db, gravel-atlas, road-authority (closures), Jev (optional classification), advisor (optional LLM). Several experiments run in "shadow" or off.
- Machines: docker-dev 10 GB RAM (no graph rebuilds here). Windows PC (`ssh windows-zac`, WSL, 64 GB, 16 cores) can rebuild GraphHopper graphs. Production router on docker-stable.

## Questions to answer (write to `.fable/ROUTING-PLAN.md`, ~3 pages)
1. **Map of what exists.** One diagram or table: every path a ride request can take today (A-to-B, loop, curvy, dirt, draw), every generator/judge/shadow switch, whether it's on in production, and what it costs in planning time. Mark each: keep, merge, turn on, or delete. Be blunt about dead weight.
2. **How should a fun curvy route be computed?** Your recommended method from first principles plus what competitors do (REVER, Calimoto, Kurviger: research if useful, cite). Consider: curvature baked into the graph as an edge attribute (Kurviger-style), custom-model weighting, candidate generation + scoring, corridor/known-roads stitching, loop shape. Pick one target architecture, explain why it beats the current pile, and how it handles A-to-B and loops, paved and dirt.
3. **Jev and AI.** Do Jev and the advisor earn their place in routing? Keep as explainers only, fold in, or delete?
4. **Speed.** First route under 5 s at the 75th percentile (PLAN bar). What makes planning slow today and how the target design fixes it.
5. **Migration in steps.** At most 6 steps, each scorecard-gated (wins never drop, trust failures stay 0), each with files, pass/fail command, worker (Codex Sol for routing; Sonnet if Codex quota is out; DeepSeek for mechanical), machine, size. Say which step replaces which of the 3 changes in ROUND-PLAN.md section 5, so there is one routing roadmap, not two.
6. **Scorecard honesty.** Is the scorecard measuring "fun" well? If not, the smallest change that makes it trustworthy (e.g. curvature metric, rider-track match), without letting us tune to the hold-out.

## Pass/fail for your plan
- Every claim about current behaviour cites a file:line or a measured result.
- Every step has a runnable check.
- One recommended architecture, not a menu.
