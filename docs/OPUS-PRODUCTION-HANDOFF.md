# Opus local-to-production handoff

Updated: 2026-10-02

This is the operational entrypoint for a local Opus/Claude Code session working on OpenGravel.

Read first:

1. `docs/vnext/research/2026-10-02-stack-closeout-orchestrator.md`
2. `docs/vnext/research/2026-10-02-connector-surface-inventory.md`
3. `docs/vnext/research/2026-10-02-stack-closeout-manifest.json`
4. `docs/architecture.md`
5. `.env.example`

The closeout documents were audited from `main@87a7b8aad1ac4d788cd8ec6b9e22f0fb2b2de928`. Always compare current `origin/main` before acting; the manifest snapshot is a starting point, not permission to ignore newer commits.

## 1. Local workspace rules

Work from **OneBigHen/OpenGravel** only.

`OneBigHen/switchback` and `OneBigHen/opengravel-vnext` are reference repositories for port recovery. Do not land new product work there.

Start from a clean current checkout:

```bash
git fetch origin --prune
git switch main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
```

Prefer one worktree per integration family instead of continually reusing one dirty tree:

```bash
git worktree add ../ogv-work-<name> -b closeout/<name> origin/main
cd ../ogv-work-<name>
npm ci
```

Before editing:

- read the relevant open PR and its parent PRs;
- check whether the same behavior already landed by squash merge;
- search main for the actual composition root, not only the module;
- identify the production configuration required to turn the capability on;
- identify the rider-facing surface that should consume it;
- identify the test class required for promotion.

Never copy a whole legacy module just because the old repo had it. Recover the contract/evidence that is still useful and adapt it to current boundaries.

## 2. First local pass

Run the deterministic baseline before taking ownership of a batch:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run test:architecture
npm run build
```

If baseline is not green, record the exact pre-existing failure before making changes. Do not bury unrelated failures in a feature PR.

For routing/provider work also establish whether the local real-router environment is available:

```bash
npm run test:real-router
```

A missing live GraphHopper/provider is an environment result, not permission to convert a live test into a fixture test.

## 3. Closeout execution order

Use the machine manifest, but the intended order is:

### A. Repository truth

- keep issues #9, #10 and #11 limited to the physical/provider acceptance that remains;
- audit merged branches before deletion;
- identify stale worktrees and old checkouts;
- ensure no automation still targets SwitchBack/VNext.

### B. Deployment truth

- land the provider registry/health work;
- keep `.env.example` synchronized with production reads;
- fix source/provenance mismatches;
- make absent DB/index/key distinguishable from a genuine empty result.

### C. Integrate the PA/NJ intelligence stack

Finish the useful work from #60:

- DCNR;
- PA Game Commission;
- NJ WMA;
- validated PennDOT local-road evidence;
- opening windows;
- rider opportunities;
- first-party events provider compatibility.

Do not ship the temporary standalone Openings product model. Final projection is Ride / Things / Along this ride.

### D. Make map truth match routing truth

Project existing normalized MVUM/WZDx/access/surface evidence onto the map instead of implementing parallel map-only truth.

### E. Merge measurement before algorithms

Prioritize the common corpus/scorecard/evidence analysis before promoting corridor, Free Ride, Frontier or Jev experiments.

### F. Native acceptance

Run physical-device acceptance for:

- resume/recovery;
- Ride Focus/native screen choice;
- Spotify;
- reroute route replacement;
- Live Activity lifecycle;
- CarPlay only after entitlement/signing and shared-session tests are ready.

## 4. PR hygiene for the orchestrator

Every batch should end in one of these states:

- merged;
- intentionally stacked on a named parent;
- consolidated into a replacement PR;
- superseded with a reason;
- blocked by a named external acceptance condition;
- closed.

Do not leave a PR open merely because it contains interesting code.

For stacked work, the replacement PR description must state what prior PRs it supersedes and which commits/contracts were preserved.

When squash-merging, branch cleanup is a **content comparison**, not an ancestry check:

```bash
git diff origin/main...origin/<branch>
git cherry origin/main origin/<branch>
```

Inspect unique patches before deleting the branch.

## 5. Production is currently under-specified

The repository has `.github/workflows/ci.yml`, but no checked-in deployment workflow, reverse-proxy configuration, process-manager definition, or release/rollback procedure.

That is a production-readiness gap.

Before changing the live deployment, discover and record the existing runtime instead of inventing a new one during a feature merge.

Capture:

- production hostname/origin;
- process manager/service definition;
- Node version;
- checkout/release path;
- reverse proxy and TLS ownership;
- GraphHopper endpoint/service and graph coverage;
- persistent data directories;
- environment/secret source;
- offline-region and PMTiles roots;
- OSM Discover index path/build;
- Curvature and Gravel Atlas DB paths;
- backup/restore procedure;
- health/smoke endpoints;
- current restart and rollback commands.

Commit the **non-secret** deployment topology/runbook under `infra/deploy/` once verified. Secrets stay in the deployment secret store.

Do not normalize production by guesswork.

## 6. Persistent state that must survive releases

Treat these as state, never release-directory scratch files:

- public share SQLite database;
- community/contribution/rating SQLite database;
- feedback SQLite database;
- road-authority cache where retaining it is useful;
- offline graph regions;
- offline PMTiles basemaps;
- generated OSM Discover index;
- Curvature DB;
- Gravel Atlas DB.

Defaults under `data/` are convenient for development but production should use explicit persistent paths or a persistent release-independent data directory.

Before the first closeout deploy, record backup commands and test that SQLite files can be restored.

## 7. Production environment rules

Use `.env.example` as the inventory, but keep secrets out of the repo.

With the real production environment loaded, run:

```bash
npm run audit:production-env
```

The preflight prints only configuration state/path errors, not secret values. Treat any ERROR as a deployment blocker; review WARN lines before cutover.

At minimum production should make deliberate decisions for:

- `OGV_PUBLIC_ORIGIN`;
- routing and hosted fallback;
- basemap mode/Mapbox token;
- TomTom;
- NWS/Wikimedia identity;
- road authority;
- known-road databases;
- OSM Discover;
- Places/events;
- offline data roots;
- sharing/community/feedback DB paths;
- Spotify callbacks/session key;
- advisor/Jev;
- traffic-camera relays;
- telemetry.

Do not carry fixture variables into production.

The canonical public origin must be decided once and propagated to:

- `OGV_PUBLIC_ORIGIN`;
- Spotify callback registration and allowed origins;
- Mapbox token restrictions when used;
- reverse-proxy host configuration;
- share metadata;
- native universal/deep-link configuration where applicable.

If an old hostname remains, redirect it rather than silently serving two independent canonical origins.

## 8. Recommended release shape

Until deployment-as-code is captured, prefer immutable release directories over editing the live checkout.

Conceptually:

```
releases/
  <build-id-a>/
  <build-id-b>/
current -> releases/<build-id-b>

persistent/
  env
  sqlite/
  discover/
  maps/
  road-data/
```

A production release should:

1. start from a reviewed main commit;
2. install from the lockfile with the required Node version;
3. run deterministic gates;
4. build;
5. verify required persistent paths are readable/writable;
6. start the candidate release on a non-public port if the current topology permits;
7. run health + smoke tests;
8. switch the service/current pointer;
9. repeat health + smoke against the public origin;
10. preserve the previous release for immediate rollback.

Do not run schema/data migrations that make rollback impossible without a backup.

If the existing production topology uses a different safe release mechanism, document and preserve it rather than replacing it mid-closeout.

## 9. Pre-production health gate

Current `/api/health` checks app metadata plus GraphHopper reachability. Until provider-health expansion lands, supplement it manually.

Required checks before public cutover:

### Core

- app starts with production env;
- `/api/health` returns app up and GraphHopper available;
- one fastest route;
- one curvy/frontier route;
- one loop/round-trip request;
- one road-span/matched-road request;
- one reroute request from a route midpoint.

### Data

- Photon search/reverse;
- elevation;
- NWS route weather;
- TomTom route traffic when configured;
- map-layer request with enabled configured layers;
- traffic cameras in at least one supported state;
- OSM Discover when configured;
- Curvature/Gravel Atlas evidence when configured;
- road authority when enabled;
- Places/events when configured;
- offline region list/download if production advertises offline support.

### Persistence

- create/read/revoke a share;
- community DB opens;
- feedback DB opens;
- existing persistent data survives restart.

### UI

- planner loads on phone viewport;
- Explore loads real catalog;
- map Layers opens and accurately reports unavailable providers;
- route can enter Ride Focus;
- route can be stopped/resumed;
- installable PWA metadata remains valid.

## 10. Physical iOS release gate

Do not call the native release production-ready from simulator tests alone.

Close #9, #10 and #11 only after their narrowed acceptance lists pass.

Also verify:

- background location;
- screen wake behavior;
- voice;
- mute;
- route replacement;
- incoming call/background/foreground recovery where practical;
- Live Activity stale/end state;
- Spotify callback on real provider account;
- native navigation setting persistence.

CarPlay is a separate gate and must not block web production unless the release claims CarPlay support.

## 11. Rollback rule

Every deployment action must answer this before execution:

> If this breaks route planning five minutes after cutover, what exact command restores the previous working build without losing rider data?

If there is no exact answer, deployment is not ready.

Rollback must not depend on rebuilding old source or reconstructing old environment variables from memory.

## 12. Post-deploy observation

For the first production release after closeout:

- verify health immediately;
- exercise one live route end-to-end;
- inspect server logs for provider/config failures;
- confirm persistent DBs are still writing;
- confirm no fixture responses are present;
- confirm map source/provenance labels match actual providers;
- monitor provider quota/rate-limit behavior;
- keep the previous release intact through the observation window.

A provider outage should degrade that capability, not trigger rollback of an otherwise healthy core planner unless it exposes a correctness/safety defect.

## 13. Definition of production-ready

OpenGravel is ready for the closeout production cut when:

- main is green;
- open PRs are intentional and understandable;
- stale branches/worktrees are cleared;
- the production environment is represented by the repo's env contract;
- the live deployment topology is documented;
- persistent state is external to release churn and backed up;
- provider health/configuration is observable;
- provenance is truthful;
- #60's authority/event work has an intentional merge/reject state;
- routing experiments have not silently changed production selection;
- device acceptance is recorded for the native claims included in the release;
- rollback is tested or mechanically credible.

Do not redefine "production-ready" as "the build completed."
