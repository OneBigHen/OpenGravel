# OpenGravel stack closeout and orchestrator work order

Audit date: 2026-10-02  
Audit baseline: `main@87a7b8aad1ac4d788cd8ec6b9e22f0fb2b2de928`  
Companion inventory: `docs/vnext/research/2026-10-02-connector-surface-inventory.md`  
Machine manifest: `docs/vnext/research/2026-10-02-stack-closeout-manifest.json`

## Mission

Close the gap between the amount of OpenGravel code that exists and the amount that is coherently production-ready.

The repository currently contains:

- a strong `main` with routing, map layers, traffic cameras, Discover, Spotify, offline support, route intelligence and local personalization;
- a large set of stacked/draft routing research PRs;
- PR #60 with substantial PA/NJ seasonal-road and rider-opportunity work;
- three open issues whose fixes are already merged;
- many surviving branches from already-merged work;
- useful legacy SwitchBack integrations that never made the VNext/OpenGravel cutover;
- documented Gaia/GOAT parity work that is much larger than what is actually implemented;
- provider configuration and provenance that are not yet centrally observable.

This closeout is not a request to merge everything. The goal is to leave one truthful production trunk, a small intentional research queue, and an explicit backlog for capabilities that genuinely do not exist.

## Non-negotiable architecture rules

1. **GraphHopper remains routing authority.** Experimental search, Jev, AI, Discover and places may propose or evaluate candidates; none may fabricate geometry or legal access.
2. **Unknown is not clear/open/legal.** Provider outage, no coverage, missing database and missing key stay typed unknown/unavailable.
3. **One source fact, many projections.** Road authority, surface, closures and place facts should be normalized once then projected into routing, maps, Explore and Ride.
4. **No provider vocabulary in product architecture.** UI asks for concepts such as seasonal roads, events, fuel or closures. Infrastructure chooses providers.
5. **No LLM as evidence authority.** AI may explain measured facts or judge bounded candidate tradeoffs in shadow/optional roles. It does not establish legality, surface, closure or geometry.
6. **No automatic route mutation from discovery.** A road/place/event suggestion becomes route intent only after an explicit rider action.
7. **Do not merge stacked PR children onto main without their required parent semantics.** Rebase or consolidate intentionally.
8. **Do not delete a branch merely because its PR was squash-merged.** Prove there is no unique content first.
9. **Every connector added or retained must declare configuration, health, freshness, coverage, provenance and failure behavior.**
10. **A green unit suite is not enough for navigation changes.** Resume, reroute, native handoff, CarPlay and in-motion UI require focused regression/device gates.

## Phase 0 — establish the closeout baseline

Before mutating anything:

- fetch `main` and compare its SHA to the audit baseline above;
- if `main` moved, regenerate PR/branch ancestry and mark this document's snapshot stale in the run log;
- capture all open PRs, open issues and branches;
- capture current CI state;
- create an orchestrator run log with each action, commit/PR, result, and reason;
- never use branch-name existence as proof that work is unmerged.

Recommended run categories:

```
VERIFY
MERGE
REBASE
CONSOLIDATE
SUPERSEDE
CLOSE
DELETE-BRANCH
DEFER
BLOCKED
```

## Phase 1 — close obvious repository debt first

### Stale issues

The current open issues are implementation-stale:

| Issue | Existing implementation | Required action |
| --- | --- | --- |
| #9 Resume mid-route restores from start | PR #15 merged | Run resume/reroute regression; close if pass. |
| #10 Native iPhone vs Ride Focus convergence | PR #16 merged, instrument work #20 merged | Verify default/setting/native handoff; close or narrow to any concrete remaining delta. |
| #11 Spotify player | PR #23 native + #26 web merged | Verify connect/control/disconnect/failure behavior; close or narrow to real defects only. |

Do not leave broad issues open after their implementation lands. If a regression exists, replace the stale issue with the exact failing behavior.

### Merged branches

For every branch whose PR is merged:

1. `git fetch --all --prune`
2. identify the merge/squash PR;
3. use `git diff main...branch`, `git cherry main branch`, and file-level comparison;
4. if branch has no unique intended content, delete it;
5. if it contains unique content, either recover that content into a new focused PR, or record a deliberate supersede decision;
6. only then delete the old branch.

Known merged branch names still present include at least:

- `feat/acceptance-contracts`
- `feat/adventure-history-20260930`
- `feat/frontier-routing-research`
- `feat/gaia-goat-layer-parity`
- `feat/recorded-road-progress-20260930`
- `feat/ride-spotify`
- `feat/rider-preference-learning`
- `feat/routing-comparison-ux-20261001`
- `feat/spotify-web`
- `feature/pa-traffic-camera-layer`
- `fix/camera-native-fallback-20260930`
- `fix/frontier-exact-regret-20260930`
- `fix/relay-token-tamper-test-20261001`
- `fix/ride-interest-geometry`
- `fix/ride-offer-cancel`
- `fix/verified-qa-20260930`

Some are ancestry-clean; others appear "ahead" because the PR was squash-merged or because the branch carried unrelated work. Do not bulk-delete without content comparison.

### Legacy repositories

Treat `OneBigHen/switchback` and `OneBigHen/opengravel-vnext` as reference sources until the port inventory is complete.

Do not continue new feature development there.

Before archiving them:

- recover any unique data adapters intentionally retained;
- record every legacy capability as `ported`, `superseded`, or `intentionally dropped`;
- update references so no active runbook tells an agent to patch the old repo.

## Phase 2 — make connector state observable before expanding it

This is P0 because silent configuration drift makes code auditing unreliable.

### Build a provider registry

Create one server-side registry for external/local data sources. At minimum expose:

- id and label;
- authority category;
- facets;
- coverage;
- configured state;
- health state;
- last success;
- last failure category;
- TTL/freshness;
- required environment keys/artifacts;
- whether it can hard-gate routing;
- whether it is visible on the map;
- whether it is offline-capable.

Suggested states:

```ts
type ProviderHealth =
  | "ok"
  | "degraded"
  | "stale"
  | "unconfigured"
  | "unavailable"
  | "disabled";
```

No secret values may be returned.

### Extend the existing operator health endpoint

`/api/health` already exists and currently probes GraphHopper plus build/graph/policy version metadata. Extend that existing secrets-free contract (or add a namespaced provider subresource behind it) rather than creating a competing health system.

It should additionally answer questions such as:

- Is GraphHopper reachable?
- Is hosted fallback configured?
- Is TomTom configured?
- Did NWS answer recently?
- Is the OSM Discover index present?
- Are curvature and Gravel Atlas DBs loaded?
- Is road authority on?
- Which authority sources are active?
- Is events/places configured?
- Which traffic-camera adapters are enabled?
- Is offline-region metadata valid?

The rider UI does not need an admin dashboard immediately. The orchestration/deployment layer does need a single truth source.

### Repair `.env.example`

Document every environment setting currently read by production paths. At minimum audit:

```
GRAPHHOPPER_URL
GRAPHHOPPER_API_KEY
GRAPHHOPPER_HOSTED_DAILY_BUDGET

NEXT_PUBLIC_MAPBOX_TOKEN
NEXT_PUBLIC_OGV_BASEMAP
OGV_BUILD_ID
OGV_POLICY_VERSION
OGV_GRAPH_VERSION

TOMTOM_API_KEY
TOMTOM_TRAFFIC_API_KEY
OVERPASS_URL
NWS_USER_AGENT

OGV_DISCOVER_OSM_PLACES
WIKIMEDIA_USER_AGENT

CURVATURE_DB_PATH
GRAVEL_ATLAS_DB_PATH

OGV_ROAD_AUTHORITY
OGV_ROAD_AUTHORITY_CACHE_DIR
PTC_WZDX_API_KEY

TRAFFIC_CAMERAS_ENABLED
TRAFFIC_CAMERAS_STATES
PA511_CAMERAS_ENABLED
STORMSCOPE_CAMERAS_ENABLED
STORMSCOPE_CAMERA_BASE_URL

OGV_PLACES_API_URL
OGV_PLACES_API_KEY
OGV_EVENTS_API_URL
OGV_EVENTS_API_KEY

COMMUNITY_DB_PATH
OGV_MODERATION_TOKEN

Spotify server settings
advisor/Jev settings actually read by main
telemetry mode actually read by main
```

Remove or clearly mark dead compatibility variables.

### Fix current provenance drift

The stop-layer catalog currently labels fuel/food/coffee/camping/lodging/repair/viewpoints as OpenStreetMap while `src/server/map-layers/providers.ts` loads them with TomTom Search.

Resolve this before any map-layer expansion.

Acceptance: every visible layer's source/caveat must match the provider(s) actually serving that response.

## Phase 3 — finish PR #60 as the first integration target

PR #60 is the highest-value unmerged connector package. It adds PA/NJ authority and opportunity infrastructure and is currently ahead of main rather than a tiny speculative branch.

### Preserve

- PA DCNR seasonal road source;
- PA Game Commission source;
- NJ WMA source;
- PennDOT local-road/recon source where semantics are validated;
- absolute access-window support;
- opening-calendar projection;
- `/api/road-openings`;
- `/api/rider-opportunities`;
- `events.henning.rodeo`/generic Places compatibility;
- route-aware opportunity ranking;
- unknown/unpublished-date honesty.

### Change before production merge

Its own design document correctly identifies that the experimental standalone Openings lens is not the final information architecture.

Production UX should be:

```
Explore
  Ride
    routes
    worthwhile roads
    gravel/unimproved
    seasonal/opening-soon road opportunities
    popular riding areas

  Things
    events
    destinations
    food/drink
    unusual rider-worthy stops

Planner with route
  Along this ride
    road opportunities
    events
    stops
    detour-aware ranking

Active Ride
  only sparse safe-to-surface opportunities
```

Requirements:

- no provider-shaped tabs;
- no generic events in default Ride feed;
- no empty calendar module;
- no precise location request until the rider asks for nearby ideas;
- road opening remains an access fact, not a popularity fact;
- route-aware suggestions never mutate route automatically;
- use detour cost after a route exists;
- cap dense event sources so durable destinations still surface;
- route timing fit is deterministic where possible.

### Integration requirement

DCNR/PGC/NJ WMA authority records must join the same canonical road-authority/evidence model used by routing. Do not leave them as an Explore-only database.

After merge, map projection should be added from those same records.

## Phase 4 — converge routing truth and map truth

Today the backend can know more than the rider sees.

### MVUM

`src/infrastructure/route-intelligence/usfs-mvum/mvum-source.ts` already parses vehicle classes, road vs trail semantics, motorcycle access, seasonal windows and unknown state.

Do not write a second MVUM implementation for maps.

Add a projection from normalized authority records to an `mvum`/motorized-access layer and road detail.

### WZDx

The route-authority pipeline already normalizes WZDx work zones. Map conditions should be able to render those same records.

Keep TomTom live traffic/incidents as operational traffic context, but avoid independent contradictory closure truth.

### Surface and road character

Create map projections from canonical evidence:

- known surface and confidence;
- Gravel Atlas evidence;
- OSM surface/tracktype/smoothness when used;
- curvature/great-road evidence;
- derived grade;
- seasonal/access state.

The map card must explain evidence source and confidence. Derived difficulty must never be presented as legal access.

## Phase 5 — finish map parity in value order, not layer-count order

Do not chase Gaia's source count. Build the rider-critical stack.

### P0 terrain

1. USGS 3DEP ingestion/derivative pipeline for PA/NJ.
2. contours.
3. hillshade.
4. slope.
5. route/road grade derived from the same elevation truth.
6. OpenGravel Topo preset.
7. offline packaging of static derivatives.

Terrarium remains global fallback.

### P0 access

1. PAD-US public/protected land.
2. USFS Roads.
3. USFS Trails.
4. MVUM projection.
5. access controls/gates.
6. restricted/wilderness projection.

Keep OSM supplementary. Public ownership must never imply motorized access.

### P0 road evidence

Port the legacy PASDA PA unpaved adapter as another source of evidence:

Legacy:
`switchback/src/lib/roads/pa-unpaved.ts`
`switchback/src/app/api/pa-unpaved-roads/*`

It must not override newer verified Gravel Atlas or regulatory access data simply because it is official. Its age/source semantics must be visible.

### P1 conditions/connectivity

After road/access truth is coherent:

- NWS radar;
- NASA FIRMS hotspots;
- authoritative fire perimeter source;
- AirNow;
- snow source;
- conservative flood/water context;
- FCC mobile coverage.

Cell towers remain advanced context, not a substitute for coverage.

## Phase 6 — normalize Places and Discover

There are currently multiple place concepts:

- TomTom Search map stops;
- generic `PlacesSource` for event/happy-hour style content;
- OSM Discover index;
- Wikimedia enrichment.

Create one product-level place/opportunity model with source-specific adapters.

Do not necessarily collapse every API request into one upstream call. Do collapse identity, provenance, categories, freshness, confidence/popularity semantics, route detour, time-window fit and dedupe.

`events.henning.rodeo` should remain a provider behind the generic contract, not a UI architecture.

Automate `infra/discover/build-osm-places.*` as a documented deploy artifact. Missing Discover index must be visible in provider health.

## Phase 7 — clean up the routing research queue

The routing research is valuable but currently split across stacked drafts. Merge evaluation infrastructure before experimental selection behavior.

### First: measurement/evaluation foundations

Review/rebase/merge if tests and semantics still hold:

- **#39** permanent PA/NJ real-router quality corpus.
- **#48** common routing experiment scorecard.
- **#38** sustained curvature continuity.
- **#50** ordered road evidence runs, currently based on #38.
- **#49** Ride Arc analyzer, after its required ordered evidence contract is settled.

These improve measurement without changing the production winner and should precede aggressive search behavior.

### Consolidate Ride Arc/coherence

PR #35 and #49 overlap conceptually around Escape → Core Ride → Return.

Do not ship two competing definitions of route coherence. Produce one canonical analysis contract with ordered evidence, explicit unknown handling, no hidden score mutation, caller-supplied worthwhile evidence where needed, and diagnostics first.

### Corridor exploration family

The current stack is:

```
#33 library corridor probes
 ├─ #36 equal-budget runner
 ├─ #41 departure/rejoin
 └─ #44 missing-link discovery
```

Do not independently merge children against stale branch ancestry.

Recommended approach:

1. rebase #33 on current main;
2. keep the provider-neutral corridor primitive;
3. either stack the children cleanly or consolidate them into one experiment branch;
4. require equal provider-call budgets for claims of improvement;
5. use #39/#48 measurement contracts;
6. only then decide whether any generator enters production candidate generation.

### Free Ride network family

Current stack:

```
#37 directed opportunities
  -> #40 network integration with fallback
      -> #43 quality/deadline controls
```

Consolidate into one reviewed production candidate.

Required production properties:

- forward-direction awareness;
- real rejoin;
- traversal verification;
- provider timeout bounded;
- minimum confidence/utility;
- existing projected-ahead fallback always available;
- optional opportunity never delays maneuver guidance;
- no catalogue hint treated as road legality.

### Frontier/Jev family

- #53 adaptive probe allocation remains experiment-only until the current Frontier baseline (#55/#56 merged work) is measured with the common scorecard.
- #51 + #54 are a stack. If retained, merge as one shadow-only Jev capability after the complete candidate-order audit and provider-pin corrections.
- Jev must not change hard eligibility, closure/access truth, geometry, reroute authority or production winner until held-out evidence justifies a separate explicit promotion PR.

### Personalization

#47 can be evaluated independently because the base preference learner (#29) is already merged.

Verify that it controls question budget only; it must not smuggle a new scoring authority into routing.

## Phase 8 — navigation/native closeout

### #59 mobile routing UX

Rebase and verify against current main. This is a normal UX candidate, not a research stack.

Test at small iPhone width, larger text, iPad, sheet/navigation overlap, Create/Cancel reachability, route method explanation collapse, and the place-search Enter race.

### #45 attention envelope

Potentially useful shared primitive for web/native/CarPlay/Free Ride.

Merge only if it remains presentation/attention policy and does not become a second maneuver authority.

### #46 CarPlay

Preserve one process-wide OpenGravel/Ferrostar navigation session.

Before production merge require:

- Apple entitlement/provisioning resolved;
- physical CarPlay or supported simulator verification;
- phone/Live Activity/CarPlay share one route replacement;
- reroute does not spawn a second session;
- pause/resume restores current progress;
- disconnect/reconnect behaves;
- no Free Ride prompt steals attention from maneuver/critical alert.

## Phase 9 — cross-device sync decision

Current OpenGravel branch `feature/accountless-e2ee-device-sync` is incomplete and has no PR. Legacy SwitchBack has substantially more passkey/encrypted-sync implementation.

Do not continue the current scaffold blindly.

Run a focused port assessment of:

```
switchback/src/app/api/identity/*
switchback/src/app/api/sync/*
switchback/src/lib/identity/*
switchback/src/lib/sync/*
```

Target product:

- simple link flow between rider-owned devices;
- server stores opaque encrypted data where practical;
- minimal credential/account surface;
- clear conflict model;
- explicit data classes synced vs local-only;
- no routing dependency on sync availability.

Create a fresh PR from current main if retained. Supersede/delete the old incomplete sync branch after salvaging any useful crypto tests/types.

## Phase 10 — dependency maintenance

Open dependency PRs should not distract from semantic closeout.

Group low-risk compatible patches after feature integrations settle:

- #3 jsdom patch;
- #5 eslint-config-next patch;
- #7 vitest patch;
- #57 Playwright patch.

Treat major/broad toolchain changes separately:

- #4 ESLint 10 major;
- #1/#2 GitHub Actions major upgrades.

For each dependency PR, run full `npm run verify` and relevant E2E. Close superseded dependency PRs rather than rebasing indefinitely.

## Current open PR disposition map

| PR | Current purpose | Recommended closeout disposition |
| --- | --- | --- |
| #60 | seasonal roads + rider opportunities | **Priority integration.** Finish Ride/Things/Along-this-ride UX, rebase if needed, merge. |
| #59 | mobile planner UX | Rebase/test/merge if clean. |
| #54 | Jev order audit/provider pin | Consolidate with #51, shadow only. |
| #53 | adaptive frontier probes | Keep experiment; measure after #39/#48 and current Frontier baseline. |
| #51 | Jev frontier shadow | Consolidate with #54; no production winner authority. |
| #50 | ordered road evidence | Rebase/merge with #38 dependency handled; measurement substrate. |
| #49 | Ride Arc analysis | Consolidate semantics with #35 after ordered evidence settled. |
| #48 | experiment scorecard | Early merge candidate. |
| #47 | teaching budget | Independent review; merge if it only bounds teaching. |
| #46 | CarPlay | Keep draft until entitlement/device acceptance. |
| #45 | attention envelope | Review as shared UI policy; no nav authority. |
| #44 | missing links | Consolidate under #33 experiment family. |
| #43 | Free Ride network quality | Consolidate with #37/#40. |
| #42 | corridor-prize loop beam | Experiment; evaluate with common scorecard before production. |
| #41 | departure/rejoin | Consolidate under #33. |
| #40 | Free Ride network integration | Consolidate with #37/#43. |
| #39 | real-router corpus | Early merge candidate. |
| #38 | curve continuity | Early measurement merge candidate. |
| #37 | directed Free Ride network | Consolidate with #40/#43. |
| #36 | equal-budget corridor runner | Consolidate under #33. |
| #35 | Ride coherence | Consolidate with #49; avoid duplicate model. |
| #33 | library corridor probes | Parent experiment primitive; rebase first. |
| #57/#7/#5/#3 | dependency patches | Batch after feature stabilization where compatible. |
| #4 | ESLint major | Separate migration. |
| #2/#1 | Actions majors | Separate CI maintenance. |

## Additional stack problems the orchestrator must actively look for

### Dead or invisible modules

For every `src/application`, `src/infrastructure`, `src/server` and `src/ui` module:

- establish whether it has a composition-root import;
- establish whether the endpoint has a caller;
- establish whether the feature is behind a flag/config;
- establish whether the flag is documented;
- establish whether tests only exercise fixtures while production composition is absent.

Flag modules that are test-only by accident, unreachable from UI, endpoint-only with no caller, UI-only with an always-unconfigured backend, or superseded but still imported.

Do not delete until behavior ownership is identified.

### Duplicate truth paths

Search specifically for:

- duplicated NWS parsing/fetch policy;
- duplicated TomTom key selection;
- route closures vs map closures;
- OSM forest roads vs MVUM access;
- map POIs vs Places vs Discover;
- multiple elevation truth sources;
- multiple preference/scoring paths;
- native vs web navigation lifecycle ownership.

### Fixture masking

Any provider with a fixture mode must have at least one test of the production composition/configuration boundary. A fixture passing must not prove that a deployment can actually enable the connector.

### Offline honesty

For every new authoritative static layer, decide whether it is included in offline packs, online-only with visible status, cached as a dated snapshot, or unavailable offline.

Never leave an enabled layer visually stale without indicating its age.

## Validation matrix

Every integration batch must run:

```
npm ci
npm run lint
npm run typecheck
npm test
npm run test:architecture
npm run build
```

Then targeted tests as applicable:

- `npm run test:real-router` for routing experiments/provider changes;
- `npm run test:e2e:critical` for UI/flow changes;
- traffic-camera live smoke where provider terms allow;
- NWS/TomTom/authority live contract smoke with secrets only in secure environment;
- Maestro/native device flows for resume/native navigation;
- CarPlay device/simulator acceptance before #46 promotion.

Record live-provider failures separately from deterministic test failures.

## Completion criteria

The stack-closeout campaign is complete when:

1. open issues describe real remaining defects, not already-merged work;
2. merged/superseded branches are removed after proof of no unique content;
3. every remaining open PR has an intentional owner/status/dependency;
4. the connector inventory is generated or kept current from one provider registry;
5. `.env.example` matches production configuration;
6. provider health is observable without exposing secrets;
7. map provenance is truthful;
8. routing and map project access/closure facts from one normalized evidence model;
9. PR #60's useful PA/NJ sources are either merged or explicitly rejected with rationale;
10. legacy SwitchBack capabilities are marked ported/superseded/dropped;
11. no production feature depends on a stale VNext/SwitchBack branch;
12. routing experiments are measured under common budgets/corpus before promotion;
13. native resume/reroute/UI regressions pass;
14. the remaining backlog clearly distinguishes **not built** from **implemented but unconfigured**.

## Desired end state

At the end of the run, a new agent should be able to inspect `main`, the provider-health response, this inventory, and the remaining open PRs and understand the real product without reconstructing history from dozens of old branches.

The core architecture should read:

```
external/local sources
        |
        v
provider registry + health
        |
        v
canonical evidence / place / authority models
        |
        +-------------------+--------------------+
        |                   |                    |
        v                   v                    v
      routing              maps              discovery
  eligibility/score   layers/detail      Ride/Things/Along
        |                   |                    |
        +-------------------+--------------------+
                            |
                            v
                    one rider session
               web / native / CarPlay
```

The repository should optimize for truth and composability, not for the number of providers or experimental branches.
