---
id: D02
title: Free basemap and terrain tiles (PMTiles) and hosting
assignee: ogv-sol
priority: 90
max_runtime: 4h
---
# D02 · Tiles we own

## Read first
SPEC §5. PLAN §6. F00's summary for the hosting decision; if F00 isn't done, assume "server".

## Goal
Vector basemap tiles and terrain tiles for the US Northeast, as PMTiles files, served over HTTPS with range requests, with a repeatable build script.

## Build
- **Basemap:**
  - build a PMTiles vector basemap with the Protomaps basemap toolchain (planetiler-based, BSD/Apache) or the OpenMapTiles-schema planetiler profile (pick one and justify it in two sentences: label quality, road classes incl. `surface`/`tracktype` for unpaved);
  - region: PA, NJ, NY, DE, MD, VA, WV, OH, from a Geofabrik extract;
  - **unpaved road attributes must be preserved** (`surface`, `tracktype`, `highway=track`), because the style depends on them.
- **Terrain:** free DEM tiles (Mapterhorn or AWS Terrain Tiles, Terrarium encoding) for the same bounds, z0–12, as PMTiles. Record the license and attribution text.
- **Build where the heavy lifting fits:**
  - Planetiler needs RAM, so build on the Windows PC (`ssh windows-zac`, WSL, `/mnt/d/ogv-tiles`) if Hermes lacks memory;
  - don't build on docker-dev or the Mac.
- **Host:**
  - if F00 says R2: upload to bucket `ogv-tiles` with credentials from `~/.hermes/secrets/r2-ogv-tiles.env`, public via an R2 custom domain or `r2.dev` URL;
  - otherwise: an HTTPS static path on the OpenGravel server with range requests and long cache headers. Inspect the running deployment first, per the repo's CLAUDE.md "Production" rules, and propose the exact change in the PR instead of applying it to production yourself.
- `tools/tiles/build.sh` and `tools/tiles/README.md`: reproducible build, sizes, update cadence (monthly), licenses (ODbL attribution for OSM).

## Acceptance checks
- [ ] `curl -sI -H 'Range: bytes=0-16383' <url>/basemap-ne.pmtiles` returns 206. Same for terrain.
- [ ] `npx pmtiles show <url>` shows the expected bounds and layers, including the unpaved attributes. Paste it.
- [ ] File sizes and build time are recorded in the README.
- [ ] Attribution strings are listed for SPEC §4.10 and §5.1.
