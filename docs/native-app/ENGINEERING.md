# OpenGravel iPhone: engineering rules and the worker contract

Every worker reads this file before starting a card. If a card and this file disagree, this file wins; raise it in a card comment instead of guessing.

Related: [PLAN.md](PLAN.md) (why), [SPEC.md](SPEC.md) (what the rider sees), [board/README.md](board/README.md) (how the Hermes board runs).

---

## 1. Worker contract (read this first)

1. **Read before you write:**
   - your card (`kanban_show`);
   - this file;
   - the SPEC.md sections your card names;
   - the parent cards' handoff summaries.
2. **Stay inside the card.** Only touch the files and folders the card lists, plus tests and fixtures. Anything else you think needs changing becomes a card comment, not an edit.
3. **One branch, one pull request.** Branch name `ogv/<CARD-ID>-<short-slug>` (the board pre-sets it), base `main`. Rebase on `main` before requesting review.
4. **Prove it runs.** Run the gates in section 6 and paste their results into the handoff. "It should work" is not evidence.
5. **No new dependencies** unless the card names them. Allowed licenses: MIT, BSD, Apache-2.0, ISC, zlib, MPL-2.0 (unmodified files only). **Never copy code from GPL or AGPL projects other than this repository**, including OsmAnd and Vela, and never from decompiled apps.
6. **No secrets in code, commits, logs or card comments.** Keys come from the build configuration or the server.
7. **Plain words for the rider.** Copy follows SPEC.md section 10. Never show "unknown" data as safe, open, legal or paved.
8. **Finish with exactly one board call:**
   - `kanban_request_review(reviewer="ogv-reviewer", ...)` for code or doc changes;
   - `kanban_block` with `kind=needs_input` when you need the owner;
   - `kanban_block` with `kind=dependency` when a parent is missing.

   Handoff metadata uses this shape:

   ```json
   {
     "published_pr": "https://github.com/OneBigHen/OpenGravel/pull/N",
     "changed_files": ["apps/iphone/..."],
     "verification": ["apps/iphone/scripts/gate.sh --ci: pass", "mac-gate ogv/X: pass (snapshots 12/12, ui 3/3)"],
     "screenshots": ["<attachment names>"],
     "residual_risk": ["what was not tested"]
   }
   ```
9. **Two strikes.** If the gates fail on the same problem twice after honest fixes, stop. Block with `kind=needs_input`, say what you tried and what you think is wrong. The lead re-scopes the card.
10. **Keep reports short.** The PR description has about 10 lines: what changed, how it was verified, screenshots. No essays, no build-state logs.

## 2. Repository layout

```
apps/iphone/                         ← the native app (new)
  project.yml                        XcodeGen spec; the .xcodeproj is generated and git-ignored
  OpenGravel/                        app target: App entry, RootView, AppEnvironment, Info.plist, entitlements, Assets
  OpenGravelLiveActivity/            widget extension (Live Activity, Dynamic Island)
  OpenGravelUITests/                 UI tests and accessibility audits
  Packages/
    OGCore/                          models, stores, persistence (SwiftData), location, settings, formatting
    OGDesign/                        design tokens, components, Gallery, snapshot helpers
    OGAPI/                           generated OpenAPI client plus the hand-written facade `OpenGravelAPI`
    OGMap/                           MapLibre wrapper, style loading, layers, camera
    OGFeatures/                      one folder per feature: Plan/, Explore/, Rides/, Ride/, Pairing/, Settings/
  fixtures/                          gpx/, api/ (recorded JSON responses), images/
  maestro/                           Maestro flows (one per screen plus smoke.yaml)
  scripts/gate.sh                    the single gate entry point (section 6)
  scripts/record-snapshots.sh        re-record snapshot references (Mac only)
apps/ios/OpenGravelNavigation/       existing Ferrostar package (kept; the app depends on it by path)
apps/ios/                            existing Capacitor shell (kept until native parity, then retired)
contracts/openapi/opengravel-app.yaml  the app↔server contract (section 5)
tests/contracts/app-openapi.test.ts    server-side contract test
```

Rules:

- **Never hand-edit `.xcodeproj` or `.pbxproj`.** Change `project.yml` and run `xcodegen generate`. The project file is git-ignored.
- Code goes into packages. The app target only wires things together.
- Dependencies point one way:

  ```
  OGFeatures → OGMap, OGDesign, OGAPI, OGCore
  OGMap → OGDesign, OGCore
  OGAPI → OGCore
  OGDesign → (nothing of ours)
  ```

  A package never imports a package that depends on it.
- New files go in the folder of their feature. No `Utils`, `Helpers` or `Misc` dumping grounds.

## 3. Platform and language

- iPhone only, iOS 18.0 minimum. Build with Xcode 26.4 (Swift 6 toolchain), Swift language mode 5, strict concurrency `targeted`. UI code is `@MainActor`.
- SwiftUI everywhere. UIKit only inside a `UIViewRepresentable` wrapper (the map, the QR scanner).
- State uses `@Observable` stores injected through the environment. No singletons except `AppEnvironment`, which is created once in `App` and passed down.
- Persistence: SwiftData in OGCore for rides, recordings and pairing. Settings use `@AppStorage`, wrapped in `SettingsStore`.
- Networking goes only through `OpenGravelAPI` in OGAPI. Features never build URLs.
- Location goes only through `LocationService` in OGCore, which has a simulated mode for GPX replay.
- Errors are typed (`enum ...Error: Error`). Every user-visible failure maps to a SPEC.md copy string, never a raw error message.
- Bundle ID `rodeo.henning.opengravel.native`, display name "OpenGravel". It moves to the main ID after parity.

### Limits enforced by SwiftLint (`apps/iphone/.swiftlint.yml`)

| Rule | Limit |
|---|---|
| file_length | warning 300, error 400 |
| type_body_length | warning 200, error 300 |
| function_body_length | warning 40, error 60 |
| cyclomatic_complexity | warning 10, error 15 |
| force_unwrapping, force_try, force_cast | error (tests excepted) |
| no `print(`; use `Logger` (OSLog) | error |

Do not raise a limit to make a file pass. Split the file.

## 4. Allowed dependencies (pinned exact versions in `project.yml` or `Package.swift`)

| Package | License | Used by |
|---|---|---|
| maplibre-gl-native-distribution (MapLibre iOS ≥ 6.10) | BSD-2 | OGMap |
| ferrostar (0.57.0, as already pinned) and its MapLibre SwiftUI DSL | BSD-3 | Ride via OpenGravelNavigation |
| swift-openapi-generator, swift-openapi-runtime, swift-openapi-urlsession | Apache-2.0 | OGAPI |
| swift-snapshot-testing (Point-Free) | MIT | tests only |
| SwiftLintPlugins (SimplyDanny) | MIT | build plugin |

Anything else needs a card that names it.

## 5. App↔server contract

- `contracts/openapi/opengravel-app.yaml` is the source of truth for every endpoint the app calls.
- OGAPI generates its client from that file at build time with the swift-openapi-generator plugin. Never hand-write request or response types.
- `tests/contracts/app-openapi.test.ts` runs the real Next.js route handlers on fixtures and validates their responses against the schema. A server change that breaks the app fails `npm test`.
- Changing an endpoint the app uses means a contract change in the same PR, plus a regenerated client.
- Recorded responses for Swift tests live in `apps/iphone/fixtures/api/` and are refreshed with `apps/iphone/scripts/record-fixtures.sh` against a local server.

Endpoints in v1:
- `route-plan`
- `geocode`, `geocode/reverse`
- `catalog`, `catalog/{id}`
- `places/along`
- `weather`
- `map-layers`, `map-layers/along`
- `elevation`
- `shares`, `shares/{shareId}`, `shares/resolve/{token}`
- `health`
- New in v1: `devices/pair`, `devices/pair/{code}`, `inbox`, `inbox/{itemId}`

## 6. Gates (the definition of done)

| Gate | Command | Where | Required for |
|---|---|---|---|
| Lint + build + unit tests | `apps/iphone/scripts/gate.sh --ci` | GitHub Actions macOS runner (`.github/workflows/ios.yml`), on every PR touching `apps/iphone/**`, `apps/ios/OpenGravelNavigation/**` or `contracts/**` | every Swift card |
| Snapshots + UI tests + accessibility audit | `mac-gate <branch> --snapshots --ui` | The Mac (one job at a time) | every card that changes a screen or component |
| Maestro flows | `mac-gate <branch> --maestro` | The Mac | every card that changes navigation between screens |
| GPX ride replay | `mac-gate <branch> --replay` | The Mac | every card that touches Ride, location or OGMap camera |
| Server | `npm run lint && npm run typecheck && npm test` | GitHub Actions `ci.yml` | every server card |

`mac-gate` is a script on Hermes: `~/bin/mac-gate`, built in card F03. It:
- pushes nothing;
- fetches your branch on the Mac into `~/dev/ogv-gate/<branch>`;
- takes the Mac lock;
- runs `scripts/gate.sh --mac <flags>`;
- copies results, failing-test diffs and screenshots back to `$HERMES_KANBAN_WORKSPACE/mac-gate/`.

Attach the screenshots to your review handoff.

Snapshot rules:
- Every screen and component has snapshot tests in four variants: light, dark, the largest accessibility text size (`.accessibility5`), and landscape. Use the `assertOGSnapshots(of:)` helper in OGDesign.
- References are recorded **only on the Mac** (iPhone 17 Pro simulator, iOS 26.4) with `scripts/record-snapshots.sh` and committed under `__Snapshots__/`.
- Never re-record to make a failing test pass without saying so in the handoff and attaching the before and after images.

## 7. Review (what the reviewer checks)

The `ogv-reviewer` profile runs the bundled `sdlc-review` skill on every card in review. It **approves only if all of these hold**:

1. The PR does what the card's acceptance checks say. Each check is ticked off with evidence.
2. The gates in section 6 required for this card passed on the PR's head commit. "Passed earlier" does not count.
3. The screenshots match SPEC.md and DESIGN-SYSTEM.md. If there's no screenshot, it isn't approved.
4. No file is outside the card's scope. No new dependency. No GPL code. No secrets.
5. The SwiftLint limits are intact, and no limit was raised.

On approval the reviewer squash-merges the PR, then calls `kanban_complete` with `published_pr`. Otherwise it calls `kanban_request_changes` with a numbered list of what to fix.

The Opus monitor reviews merged work at each phase gate and can open fix cards. A model's opinion is a pointer for where to look; the gates and screenshots are the evidence.

## 8. Machines

| Machine | Role | Notes |
|---|---|---|
| Hermes (CT124 on megaplex) | Runs the board and the workers. Git worktrees under `/mnt/hermes-bulk/ogv/OpenGravel/.worktrees/` | The root disk is 92 % full, so never write under `/home` beyond config. No Xcode: Swift is checked by CI and `mac-gate` |
| MacBook Pro 2019 (`ssh macbook`) | Snapshots, UI tests, Maestro, GPX replay, installs on the owner's iPhone | Intel, 16 GB. One job at a time through the lock. FileVault on, so a reboot needs the owner. Keep 40 GB free |
| GitHub Actions macOS runner | Lint, build and unit tests on every PR | Free for this public repository |
| docker-dev | Production web server (`ogv.service`) | Not a build machine for this work |
