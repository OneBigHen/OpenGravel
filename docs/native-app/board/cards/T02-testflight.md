---
id: T02
title: TestFlight upload pipeline from the Mac
assignee: ogv-builder
parents: [T01, G4]
priority: 50
max_runtime: 2h
---
# T02 · TestFlight

## Build
- `mac-gate --testflight <branch>`:
  - archive Release with automatic signing under the paid team;
  - build number = `git rev-list --count HEAD`;
  - export, then upload with `xcrun altool --upload-app` (or `notarytool`'s successor if Xcode 26 requires it) using the App Store Connect API key from `~/dev/secrets`.
- Add the internal testing group "Riders", plus the owner's Apple ID.
- Add the CarPlay navigation entitlement request to `docs/native-app/CARPLAY.md`: what to submit and the wording.
- Move the bundle id plan: when the owner says the native app replaces the Capacitor app, document the switch in INSTALL.md. Don't switch automatically.

## Acceptance checks
- [ ] A build appears in TestFlight. Attach a screenshot of App Store Connect and the upload log tail.
