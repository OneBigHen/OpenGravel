# Production cleanup worker report

Scope: Phase 1 repository hygiene, Phase 2 connector visibility and env contract,
Phase 10 dependency triage. Base: `c5d392b` on `sol/prod-cleanup`, stacked on
#61–#63. No routing selection, scoring, legality, geometry, provider calls or
rider screens changed. Existing TomTom stop attribution is already correct.

## Provider visibility

`src/server/health/provider-registry.ts` declares 19 connectors, including every
connector requested in the task. Public `/api/health` keeps its 200/no-store
contract and existing router-driven top-level status. Provider output exposes
names/flags and machine failure categories, never credential values, upstream
addresses, local paths, raw errors or dataset content.

Configured is separate from health. Only GraphHopper is actively probed. Other
network connectors remain `unknown`; no fabricated last success or coverage claim is supplied. Actual source
freshness is explicitly unknown. Known map-query cache TTLs are read directly
from the existing TomTom/NWS/Overpass/camera providers; they are not assertions
that their underlying data is fresh. Last success refers to this report's router probe, not a
persistent history. `evidence: artifact` means read-only catalogue/schema/index
or active-manifest validation, not that a production query has loaded the file,
that data is fresh, or that offline tile delivery has succeeded. Missing paths
are `missing`; corrupt/unreadable artifacts are configured but `unavailable`.
Each descriptor declares source provenance and its existing failure behavior;
camera config also lists the independent playback/security keys. A valid empty
catalogue/index remains distinguishable from absent geography.

Road authority lists enabled USFS/WZDx sources. Camera composition reuses the
existing adapter selector, including OH's key gate and PA/StormScope switches.
Valhalla has no production adapter and is explicitly disabled. Spotify can use
a rider-owned client ID; the registry does not claim an authenticated account,
active device, valid callback registration, or playback proof.

## Environment contract

`.env.example` now documents the root E2E runner settings and corrects obsolete
policy/events/Valhalla notes. The audit parses source syntax, checks root configs,
aliases and destructuring, and fails on missing **or stale** documented keys.
Fixture comments remain supported. Current result: 83 used, 83 documented keys.
No new secret environment key is introduced.

## Deleted modules and proof

Removed five unused re-export modules:

- `src/application/contributions/index.ts`
- `src/application/preparation/index.ts`
- `src/application/roads/surface-aggregation.ts`
- `src/application/route-intelligence/index.ts`
- `src/server/contributions/index.ts`

TypeScript import/export graph traversal and `rg` over src/tests/scripts/docs
found no consumers of these paths. The implementation modules remain directly
imported. Post-deletion `npx tsc --noEmit -p .` passes.

Retained risky/test-backed modules lacking app composition: legacy Free Ride
`discovery.ts`/`evaluation.ts`, personalization `route-features.ts` and
`rider-preference-repository.ts`, `road-entity-repository.ts`, contribution evidence,
telemetry service/transport/replay masking, and `MemoryShareRepository` (test
adapter). Worker URL imports and Next's proxy are framework composition roots,
not dead code. Do not delete based on a static import-only graph.

Duplicate truth paths retained for an owner decision: NWS preparation vs map
alert parsing/query policy; TomTom key preference differs between preparation
and stop/map adapters; TomTom map incidents vs WZDx routing authority; OSM forest
roads vs MVUM; TomTom stops vs Places events vs Discover; catalogue/rider-preference
scoring paths; web Ride Focus vs native Ferrostar lifecycle. Elevation's HTTP
adapter delegates to the existing Terrarium server source, so it is not a second
provider. Fixing these seams would exceed observational cleanup and could change
behavior. No unification was performed silently.

## Branch and issue evidence

Fetched current refs only in a disposable `/tmp` checkout. Verified remote main
as `d681ba25eead9ee6aac456ec4898b35c6bf16e61` (the original worktree's
`origin/main` is stale). For all 16 named branches in the work order, ran
`git rev-list --count origin/main..branch`, `git cherry origin/main branch`, and
`git diff --name-only origin/main...branch`.

Seven candidates have zero unique commits, cherry entries and changed files:

- `feat/adventure-history-20260930` (#32)
- `feat/frontier-routing-research` (#30)
- `feat/recorded-road-progress-20260930` (#52)
- `feat/rider-preference-learning` (#29)
- `feature/pa-traffic-camera-layer` (#24)
- `fix/camera-native-fallback-20260930` (#31)
- `fix/relay-token-tamper-test-20261001` (#58)

They are ancestry-clean deletion candidates; nothing was deleted on GitHub or
from the assigned checkout. Recheck pointers immediately before actual deletion.
Remaining named branches have unique ancestry/files; squash equivalence is not
proven. Keep them until file-level recovery/supersede decisions are made:
acceptance-contracts, gaia-goat-layer-parity, ride-spotify, routing-comparison-ux,
spotify-web, frontier-exact-regret, ride-interest-geometry, ride-offer-cancel,
verified-qa (full dated names in the work order).

Live GitHub readbacks show #9, #10 and #11 remain open, already narrowed:

- #9 records #15 implemented; signed-device resume/reroute acceptance remains.
- #10 records #16/#20 implemented; Ride Focus/native and instrument acceptance remains.
- #11 records #23/#26 implemented; Spotify account/dashboard/device acceptance remains.

No issue was closed; no physical/provider acceptance is inferred from CI.

## Dependencies and compatibility

Fresh `npm ci` installed the declared dependency tree in this worktree, replacing
its read-only shared symlink that lacked `hls.js`. No package/lockfile changed.
`npm audit --omit=dev` reports zero vulnerabilities. Full audit reports **zero
moderate and five high** findings in the braces → micromatch → fast-glob → Next
lint plugin/config chain. Registry lookup lists no braces release after 3.0.3;
its advisory affects all available releases. npm's offered fix is a major
eslint-config-next downgrade to 14.2.35, incompatible with this Next 16 lint
setup. No non-breaking patch is available; no forced downgrade was applied.

#57 remains open: Playwright 1.61.1 → 1.63.0. This cleanup changes no Playwright
API or dependency and should stack independently. Actual 1.63 compatibility
requires that PR's clean install, matching browser binaries and remote critical
suite; this worker does not claim that unrun gate.

## Verification and limits

Added registry production-composition/artifact/schema tests, health output and
HTTP contract tests, and env-audit subprocess drift tests. Local focused suite:
20 tests, three files. `npx tsc --noEmit -p .`, changed-file ESLint,
`npm run audit:env`, and `git diff --check` pass.

The assigned worktree's `.git` targets read-only metadata outside writable roots;
`git add` fails creating `index.lock`. Therefore its changes remain uncommitted.
A disposable checkout on the same branch under `/tmp` contains a committed
snapshot for the prescribed remote gate. See the worker's final response for the
snapshot SHA and remote summary lines. No push, merge, deploy, local build/full
suite/Playwright, live-service modification or screenshot claim is made.
Screens changed: **none**.
