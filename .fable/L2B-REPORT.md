# L2b report: facts exactly as the source said them, and gates that stop a bad pack

**Rider sentence:** "What the page says about a ride is exactly what the source said."

Branch `library/l2b-facts`, built on L1a. Nothing pushed, nothing deployed.

## What changed

- **`src/application/route-library/facts.ts` (new).** One module turns a record into the five facts the page
  shows: `{ value | null, quote, source }` for surface, legal status, difficulty, permits and season.
  - Surface reads the reviewed phrase table (`SURFACE_TABLE`, re-exported from L1a's `surface-phrases.ts`, 278
    rows): `paved`, `unpaved`, `mixed`, else `null`.
  - Legal reads only `public-roads`, `designated-ohv` and `mixed`; anything else is `null`.
  - Difficulty reads only the schema's words `easy`, `moderate`, `difficult`, `expert`; `unknown` and anything
    else is `null`.
  - Season and permits are not normalised: the source's own words are carried, and `unknown`, `none stated`
    and empty become `null`.
  - Rider wording helpers: "Paved, the source says", "Surface unknown", "Open to motorcycles, the source says",
    "Permit: <quote> (the source says)", nothing on the card and "Season not stated" on the page.
  - `parseSourceRating`: the structured `source_rating { value, scale, count }` field first; a malformed
    structured field is `null` rather than repaired; otherwise only the exact
    `rider rating N/5 (M reviews)` wording in `terms_provenance` or `scraper.notes`.
- **`src/application/route-library/track-flags.ts` (new).** `rough`, `old` and `mismatch` with named
  thresholds: 20 points per 30 mi, a 3 mi jump on a non-bundle, tracks from 2015 and earlier, a length more
  than 40% off the source's own figure.
- **`ride-detail.ts`.** Uses the fact module, carries `sourceRating`, and gained `pinFor`: the start of a line
  we serve, else the `location` the library supplied copied as it stands with its precision, else the middle of
  the source's own measured box; no location and no box stays `null`. Nothing is geocoded.
- **`pack-builder.ts` and `build-pack.ts`.** Ten named gates, each with its own row in `pack-report.md`; any
  failure exits non-zero. `--allow-drop` is the only override and is printed in the report. The builder writes
  `scripts/route-library/phrases.snapshot.json` and a "facts the source did not state" section in the report.
- **`scripts/route-library/phrases.snapshot.json` (new).** Every distinct phrasing this build saw for each
  fact, with its count and mapped value.
- **Tests:** `tests/unit/route-library/facts.test.ts` and `gates.test.ts` (new). The existing L1a tests and
  the committed 14-ride fixture pack still pass unchanged (the pack's version hash did not move).

## Commands run

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 6 warnings, all pre-existing in `.fable/*.mjs` |
| `npx vitest run tests/unit/route-library --maxWorkers=2` | 8 files, 114 tests, all pass |
| `node --import tsx scripts/route-library/build-pack.ts --library tests/fixtures/route-library/source --out <tmp> --name pack.sqlite` | exit 0, PASS, 111 MB peak |

No browser tests and no `next build` were run, as the brief asks.

## The real build's gate table (14-ride fixture pack; the full 5,815-ride build runs on the coordinator)

```
PASS version 13b5073d70bd: 14 rides, 12 located, 11 with a line
```

| Check | Result | Detail |
|---|---|---|
| id-collision | pass | no library id collides with a curated catalog id (112 curated ids checked) |
| duplicate-id | pass | every library id appears once |
| validator-errors | pass | 0 validator errors in 14 shipped records (0 records skipped and listed below) |
| credit | pass | every one of 14 rides has a credit line and a source address |
| ride-points | pass | the longest ride is 274 points (cap 20000) |
| index-size | pass | index 1.6 KB gzipped (cap 400.0 KB) |
| state-line-size | pass | 9 state line files; largest is PA at 1.1 KB (cap 200.0 KB) |
| pack-size | pass | pack 0.07 MB (cap 60 MB) |
| null-facts | pass | no null fact is rendered as a value; 36 facts are null and say so (listed below) |
| ride-count-drop | pass | no earlier pack in the output folder to compare |

Records per flag (fixture pack): line 11, gpx 11, old 8, loop 3, stops 2, notes 1, rough 1.

## Null facts stay null (the grep proof shape)

13 of the 14 fixture rides have at least one fact the source did not state. Ten of them, copied from the ride
detail JSON as stored in the pack (gzip decompressed, unchanged apart from the wrapping):

```
al-the-heart-run {"difficulty":{"value":null,"quote":null,"source":null},"permits":{"value":null,"quote":null,"source":null},"season":{"value":null,"quote":null,"source":null}}
ca-fort-bragg-to-medford {"difficulty":{"value":null,"quote":null,"source":null},"permits":{"value":null,"quote":null,"source":null},"season":{"value":null,"quote":null,"source":null}}
mi-orv-route-slc {"difficulty":{"value":null,"quote":null,"source":null},"season":{"value":null,"quote":null,"source":null}}
nc-cherohala-skyway {"permits":{"value":null,"quote":null,"source":null}}
nc-diamondback-loop {"difficulty":{"value":null,"quote":null,"source":null},"permits":{"value":null,"quote":null,"source":null},"season":{"value":null,"quote":null,"source":null}}
ne-desoto-trail {"difficulty":{"value":null,"quote":null,"source":null},"permits":{"value":null,"quote":null,"source":null},"season":{"value":null,"quote":null,"source":null}}
ny-us-6-bear-mountain-bridge-road-peekskill {"difficulty":{"value":null,"quote":null,"source":null},"permits":{"value":null,"quote":null,"source":null},"season":{"value":null,"quote":null,"source":null}}
ok-white-water-orv-area {"difficulty":{"value":null,"quote":null,"source":null},"permits":{"value":null,"quote":null,"source":null},"season":{"value":null,"quote":null,"source":null}}
pa-lancaster-county-loop-tour-ephrata-parkesburg-holtwood-marietta {"difficulty":{"value":null,"quote":null,"source":null},"permits":{"value":null,"quote":null,"source":null},"season":{"value":null,"quote":null,"source":null}}
pa-pa-151-south-heights-hookstown {"difficulty":{"value":null,"quote":null,"source":null},"permits":{"value":null,"quote":null,"source":null},"season":{"value":null,"quote":null,"source":null}}
```

`tx-lovelady-loop` is the one record that states a surface in words the table cannot classify:
`"surface":{"value":null,"quote":"back roads with sand sections","source":"Thread post by Tourmeister, Nov 14 2025"}`.
The value is `null` and its index `sf` is `null`; the page may repeat the words but must not call it a surface.

## Judgement calls a reviewer should see

1. **The "not stated" test.** The brief says no phrase containing "unknown", "not stated", "varies" or "?"
   may map to a value. Four of the reviewed surface phrases contain "not stated", and three of them *do* state
   a surface: "mostly dirt/gravel forest roads with paved connectors — exact mix not stated" (the source only
   declined to give percentages), "dirt/gravel OHV trails (mileage not stated)" (mileage, not surface). A
   substring rule would have forced those to `null` and thrown away a true claim. The gate and the test
   therefore treat a field as a non-answer when the whole field *is* one ("unknown", "none stated", "varies",
   "?", ...) or contains "?" — and they still catch every real non-answer in the snapshot.
2. **Difficulty words.** `route-record.schema.json` is not in this repo and the full library is not on this
   machine. From the records themselves the difficulty wording is `easy`, `moderate`, `difficult`, `expert`,
   `unknown`; "unknown" is read and dropped. Anything else is `null`. If the schema uses a different fifth
   word, add its row in `facts.ts`; nothing guesses it today.
3. **Legal words are exact.** Only `public-roads`, `designated-ohv`, `mixed`. A record that wrote
   "public roads" with a space would read `null`; the phrase snapshot will show it as `tableRow: false`, so
   the next full build is the place to spot it.
4. **The surface table stayed in `surface-phrases.ts`.** It is L1a's 278-row, tested artefact; `facts.ts`
   re-exports it as `SURFACE_TABLE` so one module lists every table. The snapshot file is the single place a
   reviewer reads the whole mapping.
5. **The committed `phrases.snapshot.json` is the fixture build.** The full 5,815-ride library is not on this
   machine, so counts are for the 14 fixture records (surface 7 phrasings, legal 2, difficulty 3, permits 3,
   season 3). The coordinator's full build regenerates it in place; a test fails if the committed file stops
   matching a fresh fixture build, so the file cannot quietly drift.
6. **Two gates cannot fail by construction.** `validator-errors` and `credit` are structural: a record that
   fails the record check is skipped and listed (plan 5.1 stage 1), and a credit line is always written from
   the author and site name when the source gave none, so a shipped record cannot lack one. Their tests prove
   the zero and the skip listing, and every other gate has a crafted-input test that fails and names the
   record, state file or pack.

## What the coordinator does next

1. Run the full build as before (the CLI's default snapshot path is the repo file):

   ```
   node --max-old-space-size=320 --import tsx scripts/route-library/build-pack.ts \
     --library /root/Vibe/og-route-library-national --out <dir>
   ```

   It rewrites `scripts/route-library/phrases.snapshot.json` with the whole library's phrasings (the 272
   surface phrasings, 326 season phrasings and the permit texts), and prints the gate table. Commit the
   snapshot with the pack: it is the mapping review.
2. Read the snapshot rows for legal and difficulty first. Any row with `"tableRow": false` is a phrasing the
   tables do not know; it is `null`, which is honest, and is where a new row may belong.
3. Expect `null-facts` to pass: every value must have a quote and a source. If it fails, the named record's
   record is missing `surface_claim_source` (or `difficulty_source` where difficulty came from elsewhere).
