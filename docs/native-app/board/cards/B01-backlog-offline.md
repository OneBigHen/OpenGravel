---
id: B01
title: BACKLOG v1.1: offline region downloads and on-phone rerouting
blocked: true
priority: 10
---
# B01 · v1.1 offline (backlog; do not start)

Notes for the future card set:
- The server already has `/api/offline/regions/*` (basemap, manifest, tiles); see SERVER-AUDIT.md item 4.
- The same PMTiles files from D02 serve offline: download the region PMTiles to the device and point the style at `pmtiles://file://...`.
- On-phone rerouting: valhalla-mobile (MIT) with region tiles, used only to rejoin the planned route, never to re-plan the ride's character.
