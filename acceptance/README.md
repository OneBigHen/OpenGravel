# OpenGravel acceptance contracts

Gherkin is the source of truth. `acceptance/features/` holds 25 missions as
behavior-level specifications; the deterministic executors (Playwright,
Maestro) implement them; an exploratory lane fuzzes around them. The expensive
model only looks at novel, reproducible bugs.

```
                 acceptance/*.feature
                     25 missions
                          │
             ┌────────────┴────────────┐
             │                         │
      deterministic tests       exploratory bot
             │                         │
     ┌───────┼─────────┐         Hercules / cheap LLM
     │       │         │                │
Playwright Maestro   Appium       finds weird behavior
 WebKit     iOS      special             │
 Chromium   iPad     cases               │
     │       │         │                  │
     └───────┴─────────┴────────┬─────────┘
                                ↓
                      normalized result.json
                                ↓
                        QA_CAMPAIGN.json
                                ↓
                  expensive model ONLY on
                    novel/reproducible bugs
```

## Layout

| Path | What it is |
|---|---|
| `acceptance/features/M01-*.feature` … `M25-*.feature` | The 25 missions, behavior-level Gherkin. No selectors, no waits, no click scripts. |
| `acceptance/manifests/M01.yaml` … `M25.yaml` | Per-mission manifest: priority, executors, preflight, evidence, exploratory policy. |
| `.maestro/M11-*.yaml`, `M12`, `M13`, `M14`, `M16` | Deterministic iOS flows for the ride-critical missions. |
| `scripts/qa/aggregate.mjs` | `--validate` checks every manifest; otherwise rolls lane outputs into per-mission `result.json` + `QA_CAMPAIGN.json`. Dependency-free Node. |
| `.github/workflows/acceptance.yml` | Nightly cron + manual dispatch: web gate, iOS Maestro job, aggregation. |
| `acceptance/exploratory/` | Hercules lane scaffolding (exploratory, cheap model, JUnit out). |

## Cost-tier policy

| Lane | Model cost |
|---|---|
| ~3000 backend/vitest tests | $0 LLM |
| Playwright suite (Chromium + WebKit) | $0 LLM |
| Maestro iOS suite | $0 LLM |
| Appium special cases | $0 LLM |
| 25 acceptance missions, once encoded | $0 LLM |
| Exploratory QA (Hercules) | cheap model |
| Failure triage | cheap model |
| Novel, reproducible failure | expensive model (Sol/Opus) |

The cheap bot does not execute the 25 missions. It creates/improves
deterministic tests, fuzzes the app after the deterministic run, reproduces
failures, and classifies evidence.

## Manifest schema

```yaml
id: M14
feature: M14-ride-continuity.feature
priority: P0                      # P0 = critical, P1, P2
executors:
  chromium: { kind: playwright, spec: tests/e2e/critical/foo.spec.ts }  # or null
  webkit:   { kind: playwright, spec: tests/e2e/critical/foo.spec.ts }  # or null
  iphone:   { kind: maestro, flow: .maestro/M14-resume-ride.yaml }       # or "planned"
  ipad:     { kind: maestro, flow: .maestro/M14-resume-ride.yaml }       # or "planned"
preflight:
  require_matching_sha: true      # lane must test the SHA the campaign claims
  require_real_device_session: true   # no desktop-browser fallback for mobile missions
  prohibit_desktop_fallback: true
evidence:
  screenshot: on_failure
  video: on_failure
  trace: on_failure
  console: always
  network_errors: always
exploratory:
  enabled: true                   # P0/P1 only
  model_tier: cheap
```

A lane with no executable target says `planned`, never green. A lane that did
not run says `not_run`, never green. `aggregate.mjs --validate` enforces all
of this in CI before any lane starts.

## Mission ↔ spec map

| Mission | Feature | P | Playwright spec | iOS flow |
|---|---|---|---|---|
| M01 | plan-first-route | P0 | first-route.spec.ts | planned |
| M02 | place-search | P1 | place-search.spec.ts | planned |
| M03 | stops | P1 | stops.spec.ts | planned |
| M04 | avoid-area | P1 | avoid-area.spec.ts | planned |
| M05 | draw | P2 | draw.spec.ts | planned |
| M06 | road-span | P2 | road-span.spec.ts | planned |
| M07 | ride-style | P1 | ride-style.spec.ts | planned |
| M08 | long-trip | P1 | long-trip.spec.ts | planned |
| M09 | advisor | P2 | advisor.spec.ts | planned |
| M10 | prepare | P1 | prepare.spec.ts | planned |
| M11 | plan-and-start | P0 | ride-focus.spec.ts | ✅ M11 |
| M12 | free-ride | P0 | free-ride.spec.ts | ✅ M12 |
| M13 | record | P0 | record.spec.ts | ✅ M13 |
| M14 | ride-continuity | P0 | — (new mission) | ✅ M14 |
| M15 | recovery | P0 | recovery.spec.ts | planned |
| M16 | offline-ride | P0 | offline.spec.ts | ✅ M16 |
| M17 | offline-basemap | P1 | offline-basemap.spec.ts | planned |
| M18 | map-resilience | P1 | map-resilience.spec.ts | planned |
| M19 | explore-catalog | P1 | explore-catalog.spec.ts | planned |
| M20 | explore-filters | P1 | explore.spec.ts | planned |
| M21 | import-export | P0 | import-export.spec.ts | planned |
| M22 | switchback-import | P2 | switchback-import.spec.ts | planned |
| M23 | share | P2 | share.spec.ts | planned |
| M24 | library | P1 | library.spec.ts | planned |
| M25 | settings | P2 | settings.spec.ts | planned |

Covered inside missions rather than as their own: `offline-routing` (M16),
`places` (M20), `ride-offers` (M12), `traffic`/`weather` readiness (M10),
`ride-spotify-web` contract (M25). Not in acceptance scope:
`compact-sheet`, `desktop-rail` (desktop responsive chrome — covered by the
existing e2e specs directly), `ride-spotify` native (needs the Spotify app +
App Remote; manual). M14 has no Playwright spec yet — it is a new mission
from the QA proposal; its web implementation is future work.

## What runs where (honest)

| Lane | This Linux host | CI |
|---|---|---|
| Playwright Chromium/WebKit | ✅ runs | ✅ ubuntu job |
| `aggregate.mjs --validate` | ✅ runs | ✅ every run |
| Gherkin parse check | ✅ runs (`npx -p @cucumber/gherkin` in scratch) | ✅ via validate |
| Maestro iOS flows | ❌ cannot run — Maestro iOS needs macOS + Xcode + iOS simulator | ✅ macos-14 job |
| Appium / XCUITest | ❌ cannot run — needs macOS/Xcode | macOS lane, reserved for special cases Maestro cannot exercise |
| Hercules exploratory | lane scaffold only, not wired to a model | future |

iOS flows are deterministic YAML left behind for CI; the bot discovers a flow
once, encodes it, and never clicks through the product again.

## Adding a mission

1. Write `acceptance/features/M26-<slug>.feature` — behavior, not clicks.
2. Add `acceptance/manifests/M26.yaml` following the schema above. Use
   `flow: planned` / `spec: null` for lanes that do not exist yet.
3. If it is ride-critical on iOS, add `.maestro/M26-<slug>.yaml` following the
   existing flows' style (`launchApp` with `clearState`, `extendedWaitUntil`
   with generous timeouts, `takeScreenshot` at key steps), flip the manifest
   to the flow path, and set the flow header's `properties.missionId`.
4. Run `node scripts/qa/aggregate.mjs --validate` and parse-check the feature
   with `@cucumber/gherkin` before opening the PR.

## Local runs

```sh
# validate contracts (no dependencies)
node scripts/qa/aggregate.mjs --validate

# web gate, chromium only (fixture mode per playwright.config.ts)
npx playwright test --project=critical-chromium

# web gate, both engines
OGV_E2E_WEBKIT=1 npx playwright test --project=critical-chromium --project=critical-webkit

# iOS flows (macOS only, booted simulator, app installed)
maestro test .maestro/ --format junit --output maestro-report.xml

# roll up a campaign from lane outputs
node scripts/qa/aggregate.mjs \
  --playwright playwright-chromium.json --playwright playwright-webkit.json \
  --maestro maestro-report.xml \
  --sha "$(git rev-parse HEAD)" --out qa-out/
```
