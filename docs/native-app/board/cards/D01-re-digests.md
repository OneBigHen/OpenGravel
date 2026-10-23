---
id: D01
title: Rider-app digests from the reverse-engineering study
assignee: ogv-builder
priority: 90
max_runtime: 2h
---
# D01 · What the 8 motorcycle apps teach us (UX only)

## Sources (on Hermes)
- `/mnt/hermes-bulk/re/kb/<app>.sqlite` and `kb/ledger.sqlite`, queried with `/mnt/hermes-bulk/re/bin/rekb`.
- JADX output under `/home/claw/reverse-engineering/projects/motorcycle-app-study/`.
- Prior benchmark cards on the default board: `t_34fd2522` and its attachments (`hermes kanban show t_34fd2522`).
- Public store pages and screenshots for each app (web search).

Apps: calimoto, kurviger, rever, gaia, onx-offroad, scenic, dmd2, beeline.

## Rules
- **UX and product behavior only:** screens, flows, wording, settings, map styling choices, routing options as the rider sees them.
- **Never copy code, assets, strings or icons.** Describe them in your own words. No new decompiling; the study is frozen.

## Output
- `docs/native-app/research/apps/<app>.md`, at most 1 page each:
  - what it does better than OpenGravel today;
  - its riding-screen layout;
  - how it presents curvy roads and route options;
  - what riders complain about in reviews (cite the source).
- `docs/native-app/research/PATTERNS.md`: the **top 20 patterns** worth adopting, ranked. Each has one line of what it is, the apps that do it, which SPEC section it affects, and whether it is already in SPEC. Then the **top 10 anti-patterns** to avoid.

## Acceptance checks
- [ ] 8 app pages plus PATTERNS.md, each claim traceable to a KB query, a store page or a review link.
- [ ] No code or asset copied (the reviewer spot-checks).
