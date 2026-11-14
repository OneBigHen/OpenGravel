# L2a: One road, one card

**Rider sentence:** "One road is one card, with everyone credited."
**Worker:** Opus (or Codex Sol: `delegate sol --wt og-lib-dedupe`). **Size:** M. **Needs:** L1a merged.
Rules: `.fable/briefs/lib-0-rules.md`. Method: `.fable/LIBRARY-PLAN.md` sections 3.4 and 5.3.

## Why
The same road arrives from several sites under different names (19 "Dragon" records; Rune Stone Ride on both
Dennis Kirk and MotorcycleRoads.com). A scan of the tracks on disk found 37 same-road groups and 678 pairs where
a short road sits inside a longer ride. Three sets overlap: the 112 curated PA/NJ rides
(`data/catalog/routes.json.gz`), the national library, and the older library (1,375 routes; on CT125 at
`/root/work/og-route-library`, fields `kind`, `license.status`, `computed.*`; ask the coordinator to copy it to
`/root/Vibe/og-route-library/` before you start, the local copy holds only prompts).

## Build
1. `src/application/route-library/dedupe.ts`, pure and tested: resample every 200 m, 300 m cells, same-road and
   part-of rules exactly as section 5.3, name rule for records with no line, transitive groups capped at 12,
   primary choice in the stated order. Deterministic: same input, same groups, same primary.
2. `scripts/route-library/old-library-adapter.ts`: an old-library record as a national record (`kind` to lane by
   a table in the file; `license.status` open or free-download to `host`, link-only to `link`; `computed` to
   stats; credit from `author` and `sourceName`; basis string unchanged). Unmappable `kind` fails loudly.
3. Builder: `--old-library <dir>` and `--curated data/catalog/routes.json.gz`. Curated rides are never rows of
   the pack (they stay in the live catalog) but they are primaries: a library record on the same road becomes an
   alias of the curated id and adds its credit to that ride's "Also on" (served through
   `GET /api/route-library/rides/<curated id>` as a small `alsoOn` record the ride page can read).
4. Pack: `alias` filled; index rows only for primaries with flag 128 when merged; detail gets `alsoOn`,
   `partOf`, `includes` (ids and names, at most 8 each, best first). The `rides/<id>` endpoint follows aliases
   and answers with `canonicalId`; `/explore/<merged id>` lands on the primary.
5. `pack-report.md` gains: groups by size, the 30 largest groups with member names and sources for a human read,
   every group that crossed a state line, counts of old-library records merged against added.

## Files
`src/application/route-library/dedupe.ts`, `scripts/route-library/build-pack.ts`,
`scripts/route-library/old-library-adapter.ts`, `src/server/route-library/pack.ts`,
`src/app/api/route-library/rides/[id]/route.ts`, `tests/unit/route-library/dedupe.test.ts`, fixture additions
(two fixture records on the same road from two sources; one short road inside the fixture loop).

## Pass/fail
- `npx vitest run tests/unit/route-library` passes, with cases: two tracks of one road recorded in opposite
  directions merge; a road and a loop that contains it give part-of, not a merge; two parallel roads 500 m apart
  do not merge; a 12-plus group fails the build; primary order; an alias resolves; credits of every member
  survive in `alsoOn` with their source URLs; no member's credit line is dropped (count in equals count out).
- Real build: paste the report. A human-readable check in the PR: list the members of the Tail of the Dragon,
  Cherohala Skyway and Blue Ridge Parkway groups and say in one line each whether the grouping is right.
- No record disappears: rows + aliases + skipped (with reasons) equals records read, asserted by the builder.
- The curated 112 are untouched: `/api/catalog` returns the same 112 ids as before.
- `npm run typecheck`, `npm run lint` pass. Builder still under 3 minutes and 800 MB on the real library.
