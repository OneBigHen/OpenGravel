---
id: G1
title: GATE: owner picks the look and map style (Opus finalizes)
blocked: true
parents: [D02, D03, D04, D05]
priority: 60
---
# G1 · Design gate

1. Send the owner `design/looks/COMPARE.md` and `design/map-styles/COMPARE.md` (images inline).
2. The owner picks a look (A, B or C, or a mix, noted precisely) and a map style, and gives any notes.
3. The Opus monitor updates `DESIGN-SYSTEM.md` and `tokens.json` to the chosen direction, deletes the other directions' values, and records the decision at the top of DESIGN-SYSTEM.md. Then it moves the chosen style to `apps/iphone/Packages/OGMap/Resources/Styles/` (day and night) with tile URLs from D02. Do this in one PR.
4. Complete this gate with the choice in the summary.
