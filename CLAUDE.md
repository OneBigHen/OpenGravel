# OpenGravel — Claude/Opus working instructions

This repository, **OneBigHen/OpenGravel**, is the active product repository.

Do not make new product changes in `OneBigHen/switchback` or `OneBigHen/opengravel-vnext`. Those repositories are reference sources only when the closeout plan explicitly asks for a port comparison.

## Read before changing code

1. `docs/OPUS-PRODUCTION-HANDOFF.md`
2. `docs/vnext/research/2026-10-02-stack-closeout-orchestrator.md`
3. `docs/vnext/research/2026-10-02-stack-closeout-manifest.json`
4. `docs/vnext/research/2026-10-02-connector-surface-inventory.md`
5. `docs/architecture.md`
6. `.env.example`

The dated closeout files are an audited snapshot. Compare current `origin/main` and current GitHub PR state before mutating anything.

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

## Current closeout priorities

1. Make provider/configuration health observable.
2. Keep `.env.example` authoritative.
3. Correct provider/source provenance in rider-facing map layers.
4. Finish/consolidate PR #60 into Ride / Things / Along-this-ride.
5. Project canonical road authority (MVUM/WZDx/seasonal sources) into map surfaces.
6. Merge measurement/evaluation foundations before promoting routing experiments.
7. Consolidate stacked routing PR families instead of merging them independently.
8. Finish narrowed physical/provider acceptance issues #9, #10 and #11.
9. Capture the actual production topology under `infra/deploy/` before automating live deployment.
10. Assess legacy SwitchBack passkey/encrypted-sync code before continuing the incomplete OpenGravel sync branch.

## Local gates

Run before requesting merge:

```bash
npm ci
npm run audit:env
npm run lint
npm run typecheck
npm test
npm run test:architecture
npm run build
```

Use as relevant:

```bash
npm run test:real-router
npm run test:e2e:critical
```

With the real production environment loaded:

```bash
npm run audit:production-env
```

Do not weaken a live-provider/device requirement by replacing it with a fixture and calling the feature verified.

## Git hygiene

Start from current `origin/main`. Prefer a fresh worktree/branch per integration family.

Before closing/deleting old work:

```bash
git diff origin/main...origin/<branch>
git cherry origin/main origin/<branch>
```

A squash merge can make landed work appear unique by ancestry. Inspect content.

Every open PR should end the closeout with one explicit status: merge, stacked on named parent, consolidated/superseded, blocked by named external acceptance, or closed.

## Production

The repository currently has CI but production deployment is not yet fully represented as code.

Do not invent host paths/service names/reverse-proxy settings. Inspect the running deployment and capture the verified non-secret topology under `infra/deploy/`.

Never deploy from a dirty worktree. Never modify persistent SQLite/data directories as if they were release files. Maintain an exact rollback path to the previous commit/build.

See `docs/OPUS-PRODUCTION-HANDOFF.md` for release and rollback gates.

## Work log

During a multi-PR closeout run, update:

`docs/vnext/research/2026-10-02-stack-closeout-runlog.md`

Record decisions and evidence, not chain-of-thought: target, action, result, tests, commit/PR and reason.
