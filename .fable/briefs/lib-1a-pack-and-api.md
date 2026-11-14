# L1a: The library pack and its endpoints

**Rider sentence:** "Every ride in the country is one tap from loading."
**Worker:** Sonnet. **Size:** about 5 hours. **Lane:** data and server. Unblocks L1b after its first 90 minutes.
Rules: `.fable/briefs/lib-0-rules.md`. Contract: `.fable/LIBRARY-PLAN.md` sections 5.1 (stages 1 to 6 and 9) and 6.

## Why
The library is 5,815 route records and 548 MB of GPX in `/root/Vibe/og-route-library-national/routes/<ST>/`.
Measured: all of it encodes to about 6 MB of lines and a 248 KB index. Today's catalog code
(`src/server/explore/catalog-data.ts`) loads every point into memory at start; that must not happen for this set.

## Build, in this order
1. **Fixture first (push within 90 minutes so L1b can start).** `tests/fixtures/route-library/source/`: 14 small
   records copied from the real library with their GPX trimmed to under 300 points each, covering: a Standout
   twisty road in TN/NC (multi-state), a scenic road, a dirt road with rider notes and stops, a loop, a trail
   bundle with 3 segments, a no-track OHV riding area with no coordinates, a link-only road, a BDR (link-only,
   lane `bdr`), a 300-mile trip, an old-track (2010) road, a rough track (8 points over 60 mi), three PA rides.
   Commit the built `tests/fixtures/route-library/pack.sqlite` (under 300 KB).
2. **Builder** `scripts/route-library/build-pack.ts`, run as
   `node --import tsx scripts/route-library/build-pack.ts --library <dir> --out <dir>`. Stages 1 to 6 and 9 of
   plan section 5.1 (dedupe and locate are L2: write `alias` empty and group fields absent). Reuse, do not
   rewrite: the GPX reader in `src/application/import`, `encodeCatalogPolyline` / `decodeCatalogPolyline` in
   `src/application/explore/catalog-build.ts`. Pure functions live in `src/application/route-library/`
   (`classify.ts`, `geometry.ts`, `index-row.ts`, `surface-claim.ts`) so the app and the builder share types.
   Read one GPX at a time; never hold more than one file's points. Writes `route-library-<version>.sqlite`
   and `pack-report.md`.
3. **Policy file** `scripts/route-library/sources-policy.json`: default `{ "mode": "host", "basis":
   "owner-confirmed permission 2026-11-13" }`, plus explicit `link` entries for "ridebdr.com", "Backcountry
   Discovery Routes", "Backcountry Discovery Routes (ridebdr.com)", "MotorcycleRoads.com" and "MotorcycleRoads"
   with `"note": "tracks not on disk; fetch waits for the owner to name this source"`. `hide` removes a source.
4. **Server reader** `src/server/route-library/pack.ts` (`server-only`): opens `OGV_ROUTE_LIBRARY_PACK` with
   `node:sqlite` read-only (the pattern in `src/server/community-routes/store.ts`), lazily, and reopens when the
   file's mtime changes. No pack or no file: every function returns `null`.
5. **Endpoints** under `src/app/api/route-library/` exactly as the plan's table: `manifest`, `[version]/index.json`,
   `[version]/lines/[state]`, `rides/[id]`, `rides/[id]/gpx`. Stored gzip bodies are sent as they are with
   `content-encoding: gzip`; a wrong `version` in the path answers 404. GPX is written from the stored line with
   the credit sentence (`creditDescription` in `src/domain/ride/credit.ts`) in its metadata.
6. **Adapter** `src/server/route-library/as-catalog-entry.ts`: a library ride as a `CatalogEntry` (`source:
   "catalog"`, `credit`, `provenance` = source name, `provenanceDetail` = "Source track from <source>
   (<year or 'undated'>). Not checked against today's roads, closures or surface.", `surfaceSummary` only
   "Paved" when the surface claim is `paved`, otherwise absent). `src/app/api/catalog/[id]/route.ts` and the
   metadata lookup in `src/app/explore/[id]/page.tsx` fall back to it when the id is not in the live catalog.
   A rough track or a ride with no line returns an entry with empty geometry. Add one optional field to
   `CatalogEntry`, `referenceTrack?: true` (read in `parseCatalogEntry`), and set it on every library ride.
7. **Publish script** `infra/route-library/publish-pack.sh <pack>`: copy to docker-stable under
   `/root/Vibe/opengravel-data/route-library/`, verify the checksum, switch `current.sqlite`, keep one previous
   pack, curl the manifest. Write it and its `--dry-run`; do not run it for real.
8. `.env.example` gains `OGV_ROUTE_LIBRARY_PACK=`; `infra/deploy/README.md` lists it under persistent paths.

## Files
New: `scripts/route-library/*`, `src/application/route-library/*`, `src/server/route-library/*`,
`src/app/api/route-library/**`, `infra/route-library/publish-pack.sh`, `tests/fixtures/route-library/**`,
`tests/unit/route-library/*`. Touched: `src/app/api/catalog/[id]/route.ts`, `src/app/explore/[id]/page.tsx`,
`.env.example`, `infra/deploy/README.md`.

## Pass/fail
- `npx vitest run tests/unit/route-library` passes, with cases: lane to type and kind table; 20,000-point cap
  (feed a 30,000-point line); a loop is flagged only when its ends are within 150 m; every distinct `surface.mix`
  phrase in the real library maps through the table and anything not listed is `null` (snapshot the phrase list
  into the test); a `null` season, permit or surface never becomes a value in the detail JSON; the index row of
  the no-coordinate record has `p: null`; rebuilding the fixture twice gives the same `version`; a `link` source
  has no line in its state file and its GPX endpoint answers 403 with the source URL; `hide` removes the source.
- Run the builder on the real library on docker-dev: exit 0, finishes in under 3 minutes, peak memory under
  600 MB (`/usr/bin/time -v`). Paste `pack-report.md` in the PR. Gates: index at most 400 KB gzipped, every
  state line file at most 200 KB gzipped, pack at most 60 MB, no ride over 20,000 points, 0 records without a
  credit line and source URL.
- With `OGV_ROUTE_LIBRARY_PACK` pointing at the real pack and `npm run dev`: `curl` the manifest, the index, the
  PA line file, one ride and its GPX; each answers 200 with the right `content-type` and cache header; the GPX
  opens in the app's own importer. The process's memory after 200 ride requests is within 30 MB of before
  (print `process.memoryUsage().rss` from a tiny script that hits a dev server, or reason from a heap snapshot).
- With the variable unset: manifest 404, `/api/catalog` and Explore unchanged, `tests/unit` for explore still pass.
- `/explore/<a library id>` in dev shows the existing ride page with the line, the credit and the source link.
- `npm run typecheck`, `npm run lint` pass.
