---
id: G0
title: GATE: foundations ready (Opus monitor)
blocked: true
parents: [F00, F01, F02, F03, F04, F05, F06, F07, F08]
priority: 60
---
# G0 · Foundations gate (Opus monitor completes this)

Check each item yourself, with commands, not by reading summaries:
- [ ] `mac-gate main --snapshots --ui --maestro` passes on current `main`.
- [ ] The `ios / build + unit tests` check is green on the latest `main` commit.
- [ ] The `npm test` contract test passes on `main`.
- [ ] The Mac has at least 60 GB free, a fixed address, and the watchdog is active.
- [ ] SERVER-AUDIT.md is read. Turn its recommended server cards into board cards, or note why not.

Complete with `hermes kanban --board opengravel-ios complete <id> --force --summary "G0 passed: ..."`. If anything fails, create fix cards, make them parents of this gate with `hermes kanban link <fix> <G0>`, and leave the gate blocked.
