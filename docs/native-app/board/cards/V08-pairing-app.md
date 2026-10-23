---
id: V08
title: App: scan to connect laptop, inbox under Rides
assignee: ogv-builder
parents: [V04, V06]
priority: 60
max_runtime: 2h
---
# V08 · Phone side

## Build
- Rides → "Connect laptop": VisionKit `DataScannerViewController` (QR only) or manual 8-character entry. It also handles the `opengravel://pair/{code}` deep link.
- The `phoneToken` is stored in the Keychain. Pair state lives in the Settings row (Connected to *X* / Unpair).
- Inbox fetch on launch, on foreground and on pull-to-refresh. A "From laptop" section with a badge on the Rides tab. Opening an item imports it as a `SavedRide` (source laptop), then acknowledges it.
- Copy per SPEC §4.6, including the expired-code message.

## Acceptance checks
- [ ] A UI test with a stubbed server: pair by manual code, inbox shows 1 item, opening it imports it and clears the badge.
- [ ] Snapshots of: the scanner screen placeholder (the simulator has no camera, so show the manual entry), the inbox list, the expired code. `mac-gate --snapshots --ui` passes.
