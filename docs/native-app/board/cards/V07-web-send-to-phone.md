---
id: V07
title: Web planner: Connect your phone and Send to phone
assignee: ogv-builder
parents: [V06]
priority: 60
max_runtime: 2h
---
# V07 · Laptop side

## Read first
SPEC §4.6. The web planner's Settings and ride actions (`src/ui/**`). Web is frozen except for this, so keep the change minimal and match existing components.

## Build
- Settings → "Connect your phone": shows the QR code (an MIT QR library already in the repo, or a small one; name it) plus the 8-character code and a countdown. It lists paired phones with an Unpair button.
- On planned and saved rides: a "Send to phone" action, enabled when at least one phone is paired, with a toast "Sent to *Phone name*".
- The browser's `laptopToken` lives in localStorage, and is registered with the existing clear-all-data control.

## Acceptance checks
- [ ] A Playwright e2e test in the existing critical suite style: pair (mock the phone call), send, assert the toast. `npm run test:e2e:critical` passes on the CI runner per repo rules.
- [ ] Screenshots of the pairing panel and the send toast at 1440×900.
