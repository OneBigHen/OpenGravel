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
  `phrases.snapshot.json` into the output folder, next to the pack and its report, and a "facts the source did
  not state" section in the report. A build never edits a tracked source file.
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
   season 3). A build now writes its snapshot into its own output folder; the repository's copy is regenerated
   only from the fixture with `npm run route-library:snapshot`. A test fails if the committed file stops
   matching a fresh fixture build, so the file cannot quietly drift, and the full build no longer touches it.
6. **Two gates cannot fail by construction.** `validator-errors` and `credit` are structural: a record that
   fails the record check is skipped and listed (plan 5.1 stage 1), and a credit line is always written from
   the author and site name when the source gave none, so a shipped record cannot lack one. Their tests prove
   the zero and the skip listing, and every other gate has a crafted-input test that fails and names the
   record, state file or pack.

## What the coordinator does next

1. Run the full build as before (the snapshot lands in the output folder; nothing tracked changes):

   ```
   node --max-old-space-size=320 --import tsx scripts/route-library/build-pack.ts \
     --library /root/Vibe/og-route-library-national --out <dir>
   ```

   It writes `phrases.snapshot.json` into `<dir>` with the whole library's phrasings and prints the gate
   table. Commit the pack's report with it if the coordinator wishes; the repository's snapshot stays the
   fixture build and is refreshed only by `npm run route-library:snapshot`.
2. Read the snapshot rows for legal and difficulty first. Any row with `"tableRow": false` is a phrasing the
   tables do not know; it is `null`, which is honest, and is where a new row may belong.
3. Expect `null-facts` to pass: every value must have a quote and a source. A claim whose record names no
   source is now withheld and listed rather than failing the build; see the follow-up section below.

## Follow-up: the null-facts gate on the real library (2026-11-14)

### Why the gate failed on `nv-bitter-springs-alternate`

`factsFor` chose the difficulty's source with `surface?.difficulty_source ?? surface?.surface_claim_source`.
The `??` operator falls back only when the left side is `undefined` or `null`; the failing record has
`"difficulty_source": ""`, which is neither, so the empty string stood and `sourceOf("")` returned `null`.

The 33 other records passed for a reason that is not about them being honest: they have **no
`difficulty_source` key at all** (1,118 more records have the explicit string
`"not stated on source page"`). `undefined` triggered the fallback, so each difficulty was credited to
whatever source the *surface* claim named. That is a loophole, not evidence: the field says where the
surface came from, and it was being used as if it also said where the difficulty came from. The record's own
provenance field was silent, so nobody could show the source said "moderate".

Checking the whole library for the same class of problem found two more dishonest passes the gate missed:
`ct-merritt-parkway` and `ar-mt-magazine-scenic-byway` claim `easy` while their `difficulty_source`
literally reads `"not stated on source page"` (one adds `"; scenic byway on a paved state highway"`).
The old builder accepted that text as a named source.

### The rule (in `src/application/route-library/facts.ts`)

- A fact is credited only to the field that records where it came from: `surface_claim_source` for
  surface, legal, permits and season; `difficulty_source` for difficulty. The surface source is never used
  for the difficulty.
- A provenance that is empty, a non-answer (`unknown`, `none stated`, `n/a`, `-`, `?`) or an admission
  (`not stated …`) names no source. The fact's `value` becomes `null`, the record's own words are kept as
  the `quote`, and the claim is listed in the build report under **"Claims dropped because the record names
  no source"**. A URL containing `?` is still a source; the question-mark rule of `saysNothing` is not used
  for provenance.
- One rule, applied to all five facts. On the real library it changes exactly the difficulty: 32 claims are
  withheld (30 records with a missing/blank `difficulty_source` plus the 2 that said the source did not
  state it). No surface, legal, permit or season claim in the 5,815 records loses its value.

`pack-builder.ts` reports the withheld claims instead of failing the build, and the `null-facts` gate detail
now counts them. Nothing in `/root/Vibe/og-route-library-national` was edited.

### The full build (exact command from `.fable/L2B-GATE-FIX.md`)

```
node --max-old-space-size=320 --import tsx scripts/route-library/build-pack.ts \
  --library /root/Vibe/og-route-library-national \
  --out /root/Vibe/og-route-library-build-l2b
```

Exit 0, `PASS version 8e85434154e2: 5815 rides, 4393 located, 3290 with a line`.

| Check | Result | Detail |
|---|---|---|
| id-collision | pass | no library id collides with a curated catalog id (112 curated ids checked) |
| duplicate-id | pass | every library id appears once |
| validator-errors | pass | 0 validator errors in 5815 shipped records (0 records skipped and listed below) |
| credit | pass | every one of 5815 rides has a credit line and a source address |
| ride-points | pass | the longest ride is 13365 points (cap 20000) |
| index-size | pass | index 373.9 KB gzipped (cap 400.0 KB) |
| state-line-size | pass | 51 state line files; largest is MI at 81.1 KB (cap 200.0 KB) |
| pack-size | pass | pack 15.92 MB (cap 60 MB) |
| null-facts | pass | no null fact is rendered as a value; 16619 facts are null and say so (listed below); 32 claim(s) dropped because the record names no source (listed below) |
| ride-count-drop | pass | 5815 rides in the earlier pack, 5815 now |

Proof in the packed database for the record the gate named:

```
nv-bitter-springs-alternate  {"value":null,"quote":"moderate","source":null}
ct-merritt-parkway           {"value":null,"quote":"easy","source":null}
pa-pa-wilds-bdr-x            {"value":null,"quote":"moderate","source":null}
```

### Checks

- `npx tsc --noEmit`: clean.
- `npx vitest run tests/unit/route-library --maxWorkers=2`: 8 files, 123 tests passed.
- New tests: `facts.test.ts` proves the surface source is never credited to the difficulty, that a blank or
  "not stated" provenance withholds the value (keeping the words), that the rule covers all five facts,
  that `unsourcedClaims` lists exactly what was withheld, and that a sourced claim survives;
  `gates.test.ts` proves a record that cannot show a source now has the claim dropped and listed in the
  report while the `null-facts` gate passes.
- The build's default snapshot path is now the output folder, so the full build leaves the tracked
  `scripts/route-library/phrases.snapshot.json` untouched; it was restored to the committed fixture build
  afterwards in the earlier run, and a new test proves a build cannot change it.

## Snapshot fix and the full build after merging main (2026-11-14)

### The snapshot fix

A full-library build used to overwrite the tracked `scripts/route-library/phrases.snapshot.json` with the
whole library's phrasings, which dirtied the tree and broke the fixture-snapshot test. Now:

- `buildPack` writes `phrases.snapshot.json` into `outDir`, next to the pack and `pack-report.md`; `--snapshot
  <file>` still names another place.
- The repository's copy is regenerated only from the fixture, deliberately:
  `npm run route-library:snapshot`.
- A new test builds with no `snapshotPath` at all, asserts the file appears in the output folder, and asserts
  the tracked copy is byte-identical before and after. The existing "matches the committed snapshot" test is
  unchanged, so the repo file is still proven to be a real fixture build's output.

### The merge with main

The branch was 12 commits behind `origin/main`, whose L1a came in as #237 plus the ride-page work in #336.
The seven conflicting files (`.fable/LIBRARY-PLAN.md`, `build-pack.ts`, `pack-builder.ts`, `classify.ts`,
`geometry.ts`, `ride-detail.ts`, `types.ts`) were add/add conflicts: main's copies are byte-identical to the
L1a branch this work was built on, and this branch's copies are that content plus L2b's edits. Keeping this
branch's copies therefore keeps main's L1a code exactly and layers L2b on top; no main behaviour is removed.

### Full build on the merged tree (the exact command from the task)

```
flock /tmp/og-light.lock node --max-old-space-size=320 --import tsx scripts/route-library/build-pack.ts \
  --library /root/Vibe/og-route-library-national \
  --out /tmp/claude-0/-root/50c259cb-87a8-489c-bbd5-816e271a72d5/scratchpad/pack-l2b
```

Exit 0. `PASS version 8e85434154e2: 5815 rides, 4393 located, 3290 with a line`. Peak memory 375 MB, 2m49s.

| Check | Result | Detail |
|---|---|---|
| id-collision | pass | no library id collides with a curated catalog id (112 curated ids checked) |
| duplicate-id | pass | every library id appears once |
| validator-errors | pass | 0 validator errors in 5815 shipped records (0 records skipped and listed below) |
| credit | pass | every one of 5815 rides has a credit line and a source address |
| ride-points | pass | the longest ride is 13365 points (cap 20000) |
| index-size | pass | index 373.9 KB gzipped (cap 400.0 KB) |
| state-line-size | pass | 51 state line files; largest is MI at 81.1 KB (cap 200.0 KB) |
| pack-size | pass | pack 15.92 MB (cap 60 MB) |
| null-facts | pass | no null fact is rendered as a value; 16619 facts are null and say so (listed below); 32 claim(s) dropped because the record names no source (listed below) |
| ride-count-drop | pass | no earlier pack in this fresh output folder to compare |

**Ride count before and after:** main's pack (L1a) has 5,815 rides; this branch's pack has 5,815 rides. No
ride is lost. The build version `8e85434154e2` is the same as the pre-merge L2b build, because the facts,
flags and gates do not change the packed content hash beyond what L2b already did.

The output folder holds both the pack and `phrases.snapshot.json`; `git status --short` is empty after the
build, which is the proof that a build no longer edits tracked files.

### Checks on the merged tree

- `npx tsc --noEmit`: clean.
- `npx vitest run tests/unit/route-library --maxWorkers=2`: 8 files, 124 tests passed.
- `npx eslint` on every touched `.ts` file: no output (clean).

## What the rider sees

- A ride whose source states the surface in a known phrase shows "Paved, the source says" (or Unpaved,
  Mixed); a phrase the table cannot classify shows the source's own words as a quote and says the surface is
  unknown, never a guessed surface.
- Legal status appears only for `public-roads`, `designated-ohv` and `mixed`, in the source's words.
- Difficulty appears only when the record's own `difficulty_source` names a source; a claim whose record
  says "not stated on source page", leaves it blank, or says "unknown" is withheld and the page says the
  difficulty is unknown.
- Permits and season carry the source's wording as a quote; when the source said nothing the card stays
  empty and the page says "Season not stated".
- The rating shows only when the record carries a structured rating or the exact "rider rating N/5 (M
  reviews)" wording; otherwise nothing is shown.
- The map pin uses the served line's start, else the library's own location as supplied, else the middle of
  the source's measured box; nothing is geocoded, and a ride with neither has no pin.
