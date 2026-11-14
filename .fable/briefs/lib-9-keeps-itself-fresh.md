# L9: The library stays current, and a bad listing is gone the same day

**Rider sentence:** "The library stays current and a bad listing is gone the same day."
**Worker:** DeepSeek V4.1 Flash. **Size:** S. **Needs:** L1a merged (L2 for the diff to be meaningful).
Rules: `.fable/briefs/lib-0-rules.md`. Plan sections 5.2, 6 and 8 (risks 1 and 8).

## Why
Another session keeps adding and fixing records; `catalogue.json` was 400 records behind the folder on
2026-11-13. Permission rests on the owner's word, so removal has to be quick and boring: flip one line, rebuild,
publish. And the app should be able to say which library it is serving.

## Build
1. `scripts/route-library/refresh.sh`: run `validate.py` on the library, run the builder against the previous
   pack's report, write `pack-diff.md` (records added, removed, changed, by state and source; every removed id;
   size changes against budgets). Exit non-zero on any gate. It builds only; it never publishes.
2. `infra/route-library/publish-pack.sh` (from L1a) gains `--rollback` (repoint `current.sqlite` to the previous
   pack) and prints the manifest before and after. Publishing still needs the owner's go; say so in its help.
3. **Takedown path.** `sources-policy.json` accepts `hide` for a source and a top-level `hiddenRides: [id]` for
   single records. A hidden ride's page answers "This ride was removed at the source's request." (410), its
   alias and "Also on" entries disappear, and the report lists it. Document the three-step removal (edit, run
   `refresh.sh`, publish) in the script's header, not in a new document.
4. `/api/health` includes `routeLibrary: { version, builtAt, rides } | "off"`; `infra/deploy/smoke.sh` checks the
   manifest answers 200 when the variable is set and that `rides` is above 1,000.
5. **Dead source links.** `scripts/route-library/check-links.ts`: HEAD each distinct source page at most once a
   week, one request per second per host, generic user agent, writing `link-report.md` (dead, redirected). It
   changes nothing by itself; a dead source link is reported for a human.
6. A Paseo schedule entry (text in the PR, not created by you): weekly `refresh.sh` on the box that holds the
   library, posting the diff summary to the coordinator.

## Files
`scripts/route-library/refresh.sh`, `check-links.ts`, `sources-policy.json`, `build-pack.ts` (hidden rides,
previous-report compare), `infra/route-library/publish-pack.sh`, `infra/deploy/smoke.sh`,
`src/app/api/health/route.ts`, `src/app/api/route-library/rides/[id]/route.ts` (410).

## Pass/fail
- `npx vitest run tests/unit/route-library tests/unit/server` passes, with cases: a hidden ride is absent from
  the index, the line file and every `alsoOn`, and its endpoint answers 410; hiding a source removes all of its
  rides and nothing else; health reports "off" with no pack.
- `bash scripts/route-library/refresh.sh` on the real library: paste `pack-diff.md` (first run compares against
  the L1a pack). Run it twice: the second diff is empty and the version is unchanged.
- `infra/route-library/publish-pack.sh --dry-run` and `--rollback --dry-run` print the exact commands they would
  run on docker-stable. Do not run them for real.
- `check-links.ts --limit 50` on 50 sources: attach the report; confirm the one-per-second pacing from its log.
- `npm run typecheck`, `npm run lint` pass.
