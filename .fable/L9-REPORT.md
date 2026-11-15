# L9 report: the library keeps itself current, and a bad listing goes the same day

Branch: `library/l9-current`. Nothing was pushed, merged or published. docker-stable was not touched.

## What a rider gets

- The library on production is rebuilt from the library folder four times a day. A pack is only
  published when its content actually changed.
- A bad listing can be taken down with two commands. Its old link answers **410 "This ride was
  removed from the library."** with the date and the reason, instead of a bare 404 — in the ride
  endpoint, the GPX endpoint, and the `/api/catalog/<id>` fallback.
- A record that disappears from the library folder without a note is also remembered at the next
  build, so old links still say it was removed. A big unexplained loss is still a quality-gate
  failure on purpose; a person looks and passes `--allow-drop` once.
- A ride that comes back is live again: history never blocks a returning record. A deliberate
  takedown stays down until its line is removed from `tombstones.json`.

## What was built

1. **Pack tombstones** (`src/application/route-library/tombstones.ts`, `pack-builder.ts`).
   `tombstones.json` in the library folder is the deliberate list. The build merges it with the
   previous pack's list and records cards that disappeared. The result lives in the pack's
   `tombstone` table and in the manifest as `removed`; the pack hashes it into its version, so
   clients pick up a removal.
2. **The 410 answer** (`src/server/route-library/pack.ts`, `http.ts`, `src/app/api/catalog/[id]`).
   Old packs without the table still serve normally (tested), so rolling the symlink back stays safe.
3. **The refresh** (`scripts/route-library/refresh-pack.ts`, `infra/route-library/refresh-pack.sh`).
   Rebuild → stop on a failed gate → compare version with the newest pack → do nothing if unchanged
   → otherwise publish when asked. One run at a time via a lock file (exit 75 when another run holds
   it; a lock older than two hours is taken over). Keeps the newest three built packs after each
   successful build. `OGV_ROUTE_LIBRARY_PUBLISH=0` is a kill switch that allows a scheduled build
   without switching production.
4. **The schedule** (`infra/route-library/ogv-route-library-refresh.{service,timer}`, `install.sh`).
   Four times a day at 03:30, 09:30, 15:30 and 21:30 UTC, with a randomised delay. The service runs
   the wrapper with `--publish`. The timer is not installed by this session; installation is the
   owner's step on docker-dev.

## Same-day takedown (the two commands)

On docker-dev, with the library at `/root/Vibe/og-route-library-national`:

```bash
node --import tsx scripts/route-library/takedown.ts <ride-id> \
  --library /root/Vibe/og-route-library-national \
  --reason "why it came down"

sudo systemctl start ogv-route-library-refresh.service   # or: infra/route-library/refresh-pack.sh --publish
```

The first command writes the ride id to `<library>/tombstones.json` atomically and refuses a bad id
or a malformed file rather than dropping its entries. The second rebuilds and publishes. The 6-hour
timer would publish it anyway; starting the service makes it immediate.

## Installing the schedule on docker-dev (owner step)

```bash
sudo infra/route-library/install.sh
systemctl list-timers ogv-route-library-refresh.timer --no-pager
```

Defaults: library `/root/Vibe/og-route-library-national`, built packs
`/root/Vibe/opengravel-data/route-library-build`. Override with `OGV_ROUTE_LIBRARY_DIR` and
`OGV_ROUTE_LIBRARY_OUT`. Pause with `sudo systemctl disable --now ogv-route-library-refresh.timer`.

## Proof run in this session

- `npm ci` — clean install.
- `npx tsc --noEmit` — pass.
- `npm run lint` — 0 errors (6 existing warnings in `.fable/phonefirst-shot.mjs`).
- `npx vitest run tests/unit/route-library` — **10 files, 112 tests pass**, including:
  - `tombstones.test.ts`: parsing, deliberate/carried/noticed merge rules, resurrection, stability,
    takedown upsert.
  - `tombstones-pack.test.ts`: a live record hidden by a tombstone; the drop gate not mistaking a
    takedown for a bad build; an unannounced disappearance recorded; same version on a quiet
    rebuild; a ride restored; removals carried; schema 2; malformed file fails loudly.
  - `refresh.test.ts`: first build, unchanged second run, takedown → new version → publisher called,
    build-only default, kill switch, failed gate and failed publish never publish, lock contention,
    stale lock takeover, pruning.
  - `takedown.test.ts`: file creation, replacement without loss, malformed file refused.
  - `http.test.ts`: 410 body/date/reason, no-store, 410 for GPX, no 304 for a removed ride, plain
    404 for a never-existing id, and a schema-1 pack without the table still serving.

End-to-end on a copy of the fixture library with the real wrapper (build-only, no publish):

```
first build:  version e4458dd57f16, 14 rides, 14 new
quiet rerun:  version e4458dd57f16, "Nothing to publish"
takedown nc-cherohala-skyway:
              version 3944b6fc981d, 13 rides, "Removed since the previous pack: nc-cherohala-skyway"
```

The committed fixture pack was rebuilt with the new schema and its deliberate test tombstone
(`pa-old-mill-road`, "The source withdrew this listing.") so the 410 path is tested without a build.

## Deliberate limits

- Nothing was published to production. `publish-pack.sh` was only read, never run.
- The full national library is not on this machine (only the older 1,375-record CT125 library is),
  so the full-size build and the schedule's first live run happen on docker-dev, where the library
  folder lives.
- The 2% drop gate still requires `--allow-drop` for a large *unexplained* loss. An intentional
  removal through `tombstones.json` does not need it; that is what makes same-day takedown quick
  while keeping an accidental mass loss visible.
- Removed rides leave the index, state line files and ride counts. The pack keeps their id, date and
  reason only; no track or rider text is retained for a removed listing.
