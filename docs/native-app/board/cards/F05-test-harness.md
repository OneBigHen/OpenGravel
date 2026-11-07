---
id: F05
title: Test harness: snapshots, accessibility audit, Maestro smoke
assignee: ogv-builder
parents: [F03, F04]
priority: 85
max_runtime: 2h
---
# F05 · Test harness

## Read first
ENGINEERING §6, SPEC §8.

## Build
- **OGDesign, `Testing/OGSnapshot.swift`** (test-support target `OGDesignTestSupport`):
  - `assertOGSnapshots(of view: some View, named: String, file:line:)` records four images: light, dark, `.accessibility5` Dynamic Type, landscape;
  - iPhone 17 Pro size, `perceptualPrecision: 0.98`;
  - fails with a clear message if run on a simulator other than iPhone 17 Pro on iOS 26.x, since references come from the Mac only.
- `scripts/record-snapshots.sh` sets the record flag through the environment and runs the snapshot tests.
- **`OpenGravelUITests/AccessibilityAuditTests.swift`:** launches the app with `-ogvUITest 1` and runs `performAccessibilityAudit()` on the launch screen. Add a helper `auditCurrentScreen()` for later cards.
- **Maestro:** `apps/iphone/maestro/smoke.yaml` (launch, see the main screen, take a screenshot), plus `maestro/README.md` explaining how flows are named.
- Wire `gate.sh --mac --snapshots --ui --maestro` to run these. Screenshots go to `build/screenshots/`.
- One example snapshot test on the placeholder screen, with references recorded on the Mac via `mac-gate --record-snapshots` and committed.

## Acceptance checks
- [ ] `mac-gate <branch> --snapshots --ui --maestro` passes. Paste the summary and attach the four snapshot images and the Maestro screenshot.
- [ ] Changing the placeholder's background color makes the snapshot test fail with a diff image. Show it, then revert.
