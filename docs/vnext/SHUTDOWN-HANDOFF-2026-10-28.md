# Shutdown handoff — 2026-10-28 ~17:30 EDT

The owner is shutting every node down to move them. This file says exactly where
things stand and what to do first when they come back up. The full work list is
`docs/vnext/IN-FLIGHT-2026-10-28.md`.

## Live before shutdown
- Production (docker-stable CT109, `ogv.service` on :3200, Cloudflare tunnel):
  `main@5dbb7df` (#195). Everything from #193, #194 and #195 is live and verified.
- `OGV_HIKES_PATH=/var/lib/opengravel/trails/2026-10-28/hikes.json` (the old catalog, still active).
- Hike router: `og-graphhopper-hike.service` on docker-stable :8995 (graph v3).

## Unfinished: rich trail catalog (do this first)
- Branch **`build/hike-rich` @ `d0c3970`** on OneBigHen/OpenGravel, **not merged, no PR yet**.
  It holds Codex Sol's enrichment (10 commits: OSM features + Waterfall/Views
  filters, park/town/exertion, official DCNR/NPS/USFS/NJDEP trails, Wikipedia
  text + Commons photos, New Jersey), a merge of main, and my **split-catalog
  memory fix** (`infra/trails/split-catalog.ts`, `src/server/hikes/catalog-split.ts`):
  the server keeps a 56 MB summary in memory and reads trail detail and geometry
  by offset. Measured with the full catalog: 420 MB RSS (vs ~1 GB unsplit).
- Gates: Codex's run passed (typecheck, eslint, build, 6,427 vitest, 8 Explore
  specs). **My full powerplex gate run was interrupted by the shutdown**, so it
  has not passed on `d0c3970` yet.
- Catalog files are **already on docker-stable**:
  `/var/lib/opengravel/trails/2026-10-28-rich/` (hikes.json, hikes.summary.json,
  hikes.details.jsonl, trails.index.json, trails.features.jsonl, report.json,
  SHA256SUMS). Source copy: powerplex `/mnt/wsl/ogv-data/trails/2026-10-28-rich/`.
- PR text is ready at the bottom of this file.

**To finish:**
1. `bash ~/ogv-verify/pp-clean-gates.sh build/hike-rich d0c39701f7fb5b4dd4b60717341bad246402a703` on powerplex
   (it kills a stray :3410 server first; `critical` needs `build` in the same run).
2. Open PR from `build/hike-rich`, squash-merge.
3. On docker-stable: `cp /etc/opengravel/ogv.env /etc/opengravel/ogv.env.bak-20261028-rich`, set
   `OGV_HIKES_PATH=/var/lib/opengravel/trails/2026-10-28-rich/hikes.json`, then
   `cd /root/Vibe/wt/og-public && git fetch -q && git merge --ff-only origin/main && bash infra/deploy/release.sh origin/main`.
4. Live check near Hawk Mountain, Ricketts Glen and Water Gap on a 393 px phone, Day and Night: list, filters, trail page photos/features. Then watch `ogv` memory (`ps -o rss= -p $(systemctl show -p MainPID --value ogv)`); swap was full (2/2 GB) before shutdown.
   Rollback: restore the ogv.env backup and `infra/deploy/rollback.sh`.

## Owner-only items
- MacBook: log in once (login keychain is locked) so the Live Activity widget can be signed and installed.
- Device checks: press-and-hold menu (#188), 3D sun lighting at dusk, wind arrows on a windy day.
- Decide: delete ~60 merged remote branches; close old PRs #165 #98 #97 #99 #46 #4.

## Bring-up order after the move
1. Proxmox hosts → docker-stable CT109 (prod: check `systemctl is-active ogv og-graphhopper-hike`, `curl -s localhost:3200/api/health`, Cloudflare tunnel container `legacy-shared-services-cloudflared-1`).
2. docker-dev (work + Claude session).
3. megaplex github-ci CT125 (spare gate runner).
4. powerplex: Windows PC, WSL; `~/ogv-verify` gates; `/mnt/wsl/ogv-data` symlinks to D:.
5. MacBook (`macbook-wake` skill) if iOS work is next.

## Next work after the rich catalog (from IN-FLIGHT)
Hike router road detours (Jim Thorpe, Lehigh Gorge 38 km, Water Gap) → offline hike
routing download → hike loop finder → per-piece elevation profiles → split `HikeExplore.tsx`.

## Ready PR text
## Rich trail catalog (open data only)
Finishes the trail enrichment that stalled this morning (Codex Sol on powerplex; code reviewed, merged with main, plus a server memory fix).

**What hikers get**
- **27,594 PA + NJ trails** with source and licence on every record. Sources: OSM 23,489 · NJDEP 2,678 · NPS 964 · PA DCNR 656 · USFS 272 (overlaps merged by reciprocal geometry overlap).
- **Along the trail:** 66,526 mapped features within 100 m (464 waterfalls, 2,454 viewpoints, summits, shelters, water…), each with its mile marker. New **Waterfall** and **Views** filters.
- **Park, nearest town and estimated exertion** (documented formula, used only when there is no official or OSM rating). Search covers trail, park and town names.
- **Credited Wikipedia text** on 42.5% of trails. **Wikimedia Commons thumbnails** (author and licence, thumbnails only) on 24.5%.
- Attribution files for DCNR / NJDEP / NPS / USFS under `public/data-attribution/trails/`, plus the NJDEP disclaimer on its trails.
- Trail page access note reworded: OSM general access "no" says walkers may still be allowed. Links use app colours.

**Server memory (new):** the rich catalog is ~1 GB once parsed. `infra/trails/split-catalog.ts` writes `hikes.summary.json` (list fields only, held in memory) plus `hikes.details.jsonl` / `trails.features.jsonl` with offset indexes, read one trail at a time. Measured with the full rich catalog: server RSS **420 MB** (prod today 368 MB); list 0.02 s warm, detail 5 ms, geometry 16 ms. Unsplit catalogs still work as before (unit-tested).

## Evidence
- powerplex gates (see comment). Codex's own run: typecheck, ESLint, build, 6,427 vitest, 8 Explore/filter specs, 26 Day/Night screenshots at 393×852 (Hawk Mountain, Ricketts Glen, Delaware Water Gap).
- No AllTrails or proprietary data. Gaps: the DCNR release is partial and simplified; some agency codes are untranslated; Commons/Wikidata coverage is partial; no Mapillary token.

**Deploy:** catalog in `/var/lib/opengravel/trails/2026-10-28-rich/` on docker-stable; switch `OGV_HIKES_PATH` there (backup of ogv.env kept).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_013crtypq2MoLnzAiyBWraTj
