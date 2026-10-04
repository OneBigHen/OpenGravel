# Phase 2 (gravel-first routing) — handoff, 2026-10-03 23:20

The Sonnet agent was stopped at the owner's request (Claude quota). Everything on disk is committed on `dlg/rider-modes` (pushed as `wip/gravel-first-routing`). The spec is `/root/Vibe/wt/.plan/rider-modes-phase2.md`.

## Done
- Phase-2 snapshot typechecks (`npx tsc --noEmit` clean at this commit).
- The shadow Jev fun judge runs off the response path (6f298cd).
- **Gravel Atlas v3** builder: chained corridors, Franco curvature scoring, dead-end and graph-validation columns (6ac6ceb). It was built on the Windows PC (`~/ga` in WSL; `ways.ndjson` → `atlas.sqlite`) and installed at `/var/lib/opengravel/gravel-atlas-v3.sqlite` (30 MB). Rebuild with `scripts/rebuild-gravel-atlas-remote.sh`.
- `OGV_RIDE_FORMULA` and the atlas generators are wired into planning (behind switches; off/shadow by default per spec).

## In progress at stop (in the last commit, not yet verified)
- `src/application/planner/atlas-generators.ts`, `plan-service.ts`, `route-plan-contract.ts`: the generator / plan wiring edits.
- `scripts/ride-formula-benchmark.ts`: the benchmark script, not run yet, so there's no results doc.
- Tests: `tests/unit/application/atlas-generators.test.ts`, `tests/unit/server/plan-service-ride-formula.test.ts`. The agent's last note was "Add tests."

## Next
1. Run the changed test files one at a time (`--maxWorkers=1`) and fix them.
2. Run the benchmark sequentially against GraphHopper :8989 → `docs/vnext/research/ride-formula-benchmark-2026-10-04.md`.
3. Run the remote gates: `/root/Vibe/wt/bin/ogv-remote-verify.sh <worktree> <sha> phase2 lint typecheck vitest build`.
4. Open the PR (ultrareview candidate), deploy with switches in shadow, promote if the benchmark wins.
