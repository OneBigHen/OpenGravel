---
id: D04
title: Three look directions: key screens as phone mockups
assignee: ogv-builder
parents: [D01]
priority: 85
max_runtime: 3h
skills: [frontend-design]
---
# D04 · Look directions

## Read first
SPEC §2–§4 and §10, PATTERNS.md from D01, and the root rules in ENGINEERING §1 (no copying other apps' assets).

## Goal
Three clearly different visual directions for the app, shown on the same five screens, so the owner can choose one.

## Build
- Static HTML/CSS mockups in `design/looks/<A|B|C>/`, rendered with Playwright to 1170×2532 PNGs (portrait) and 2532×1170 (landscape, riding screen only). Use realistic Pennsylvania ride content, no lorem ipsum, and put a map image from D03 behind (or a neutral map screenshot if D03 is not merged yet).
- **Screens per direction:**
  1. Plan composer (peek and half sheet);
  2. Route choices with 3 cards and evidence chips;
  3. Riding screen portrait;
  4. Riding screen landscape;
  5. Explore list.
- **Directions:**
  - **A, "Instrument":** dark-first, cockpit-like, big numerals;
  - **B, "Field guide":** light, paper-and-ink, editorial type;
  - **C, "Trail":** bold color accents, chunky glove-sized controls.
- **Type:** pick from Outfit, Manrope, Sora, Plus Jakarta Sans or DM Sans for display and numerals. The system font (SF Pro) is allowed for body text. Never Inter, Roboto, Arial or Space Grotesk. Colors are defined as HSL variables.
- **Riding screens must meet SPEC §4.5 sizes:** maneuver glyph at least 64 pt, buttons at least 60 pt, distance as the largest text.
- `design/looks/COMPARE.md`: a grid plus 3 lines per direction on why it suits riders.

## Acceptance checks
- [ ] 3 directions × 5 screens (plus landscape) as PNGs in COMPARE.md.
- [ ] A measured check that every riding-screen button is at least 60 pt (180 px at 3×). List them.
- [ ] Contrast of primary text against its background is at least 4.5:1, computed in a small script. Show the output.
