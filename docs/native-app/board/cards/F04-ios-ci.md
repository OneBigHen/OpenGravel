---
id: F04
title: GitHub Actions: iOS build and unit tests on every PR
assignee: ogv-builder
parents: [F02]
priority: 85
max_runtime: 2h
---
# F04 · iOS CI

## Read first
ENGINEERING §6. Existing `.github/workflows/ci.yml` (web), which you must not change.

## Build
- `.github/workflows/ios.yml`:
  - on `pull_request` and `push` to `main`, path filter `apps/iphone/**`, `apps/ios/OpenGravelNavigation/**`, `contracts/**`, `.github/workflows/ios.yml`;
  - `runs-on: macos-26` (fall back to `macos-15` and select the newest installed Xcode with `sudo xcode-select`, writing which one in a step summary);
  - install XcodeGen and xcbeautify with brew, cache SPM (`~/Library/Caches/org.swift.swiftpm`, `apps/iphone/.build`);
  - run `apps/iphone/scripts/gate.sh --ci`, uploading `build/results.xcresult` on failure;
  - concurrency group per ref with cancel-in-progress, timeout 40 min, job name `ios / build + unit tests`.
- No secrets are needed: CI builds unsigned for the simulator (`CODE_SIGNING_ALLOWED=NO`).

## Acceptance checks
- [ ] The PR for this card shows the `ios / build + unit tests` check passing. Link the run.
- [ ] A throwaway commit that breaks a unit test makes the check fail. Revert it and link the failing run.
- [ ] A PR touching only web files does not trigger the job.
