# OpenGravel: working instructions

OpenGravel is the best way to find and ride a gravel or twisty loop in the Mid-Atlantic, and trust it.
Repository: **OneBigHen/OpenGravel**. Do not make product changes in `switchback` or `opengravel-vnext`.

## The plan

The plan is `docs/PLAN.md`. It holds the goal, the five bars that define "excellent", the ranked
milestones, the frozen areas and the rules that stop churn. Work only on the current milestone's issues.

Everything else under `docs/` is history, not a work order. Do not read old closeout or handoff
documents unless an issue names them.

Read `AGENTS.md` for how to work and `DESIGN.md` before any UI work.

## Core invariants

- GraphHopper is routing authority.
- Unknown/unavailable is never converted to clear, open, legal, paved, or safe.
- A provider fact should be normalized once, then projected into routing, map, Explore and Ride.
- AI/Jev may explain or evaluate bounded candidates; it does not establish geometry, access, closure, surface or hard eligibility.
- Discovery suggestions never mutate a route without explicit rider action.
- Keep one RideSession/navigation lifecycle across web/native/CarPlay.
- Optional providers must fail independently of core planning/navigation.
- Do not merge a stacked child PR without preserving or replacing its parent semantics.
- Do not delete a squash-merged branch until file/patch comparison proves no intended unique content remains.
- Do not commit secrets or production credentials.

## Production

- Production runs on docker-stable (`ogv.service`, port 3200). Never deploy without the owner's go-ahead.
- Deploy only with `infra/deploy/release.sh` on docker-stable. It smoke-tests and rolls back by itself;
  `infra/deploy/rollback.sh` returns to the previous release.
- Never deploy from a dirty worktree. Never treat persistent SQLite/data directories as release files.
- Do not weaken a live-provider or device requirement by replacing it with a fixture and calling it verified.
