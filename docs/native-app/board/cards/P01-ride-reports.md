---
id: P01
title: Ride report intake: checklist and notes to fix cards
assignee: ogv-builder
parents: [G2]
priority: 55
max_runtime: 2h
---
# P01 · From a real ride to fix cards

## Build
- `docs/native-app/RIDE-CHECKLIST.md`: 15 or fewer yes/no items the owner answers after a ride:
  - heat;
  - sunlight readability;
  - glove taps;
  - voice through the headset;
  - reroute behavior;
  - battery % per hour;
  - crashes;
  - "anything that annoyed you".
- A Hermes skill `ogv-ride-report` (in `tools/hermes-skills/ogv-ride-report/SKILL.md`, installed into the `default` profile by `tools/hermes-skills/install.sh`). When the owner sends ride notes (voice or text) to Hermes, it:
  1. asks the checklist questions that weren't answered (one message, not a quiz);
  2. creates one fix card per distinct problem on board `opengravel-ios`, assigned to `ogv-builder` (or `ogv-sol` for navigation and map problems), with SPEC section refs and reproduction steps, linked to the current gate if one is open;
  3. replies with the list of cards created.
- A fix-card template inside the skill, matching the card format in `docs/native-app/board/cards/`.

## Acceptance checks
- [ ] A dry run with sample notes (in the PR) produces the expected cards on a scratch board (`--board ogv-ios-sandbox`), then the scratch board is archived.
