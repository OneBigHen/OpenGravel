---
id: F02
title: Scaffold apps/iphone (XcodeGen, packages, SwiftLint, gate.sh)
assignee: ogv-sol
priority: 95
max_runtime: 3h
---
# F02 · Scaffold the native app

## Read first
ENGINEERING §2, §3, §4, §6. Look at `apps/ios/OpenGravelNavigation/Package.swift` (Ferrostar pinned at 0.57.0).

## Goal
An empty but correctly structured SwiftUI app that builds, launches to a placeholder map-colored screen, and passes `scripts/gate.sh --ci` on the Mac.

## Build
- `apps/iphone/project.yml` (XcodeGen):
  - app target `OpenGravel` (iOS 18.0, iPhone only, portrait and landscape, bundle id `rodeo.henning.opengravel.native`);
  - UI test target `OpenGravelUITests`;
  - local packages: `Packages/OGCore`, `OGDesign`, `OGAPI`, `OGMap`, `OGFeatures`, and `../ios/OpenGravelNavigation`.

  Signing: automatic, team from an `xcconfig` the owner's machine provides (`Signing.local.xcconfig`, git-ignored, with an example file committed).
- Each package has `Package.swift`, one placeholder source file, one test, and the dependency direction from ENGINEERING §2. OGDesign has no dependencies. Add `swift-snapshot-testing` to the test targets only.
- SwiftLint via the `SimplyDanny/SwiftLintPlugins` build-tool plugin on every package and the app, with `apps/iphone/.swiftlint.yml` holding exactly the limits in ENGINEERING §3.
- `apps/iphone/scripts/gate.sh`:
  - `--ci`: `xcodegen generate`, then build-for-testing on the iPhone 17 Pro simulator, then unit tests for every package, then lint (fail on any error).
  - `--mac [--snapshots] [--ui] [--maestro] [--replay]`: the same plus the selected extras. The extras stub out with a clear "not configured yet" exit 0 until F05 and S06 fill them in.

  Output goes through `xcbeautify` when present, with the result bundle in `build/results.xcresult`. Exit non-zero on any failure.
- `.gitignore`: `*.xcodeproj`, `build/`, `Signing.local.xcconfig`, `DerivedData`.
- `apps/iphone/README.md` (under 50 lines): how to generate, build, run, and run the gates.

## Acceptance checks
- [ ] On the Mac: `cd apps/iphone && scripts/gate.sh --ci` passes. Paste the tail.
- [ ] The app launches in the simulator. Attach a screenshot (`xcrun simctl io booted screenshot`).
- [ ] `git ls-files apps/iphone | grep -c pbxproj` is 0.
- [ ] A deliberately long file (401 lines) fails lint. Show it, then remove it.

## Out of scope
Real UI, networking, map. Do not touch `apps/ios/` except to reference the navigation package.
