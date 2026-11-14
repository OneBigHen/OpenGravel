# The national ride library: plan (2026-11-13)

Owner: "sites ok with it all push it we want excellent proof of concept make it all excellent i want top tier
organization layout and setup this could be huge and make way better than REVER once we get everything covered
and fixed."

Checked against `origin/main` e18b697c (#229), the library folder `/root/Vibe/og-route-library-national/`
(measured, not read from its reports) and the older library on CT125. Briefs: `.fable/briefs/lib-*.md`.

## 1. Verdict in ten lines

1. **The library is small enough to serve from one file.** 548 MB of GPX becomes about 8 MB of route lines and
   16 MB of ride text. The whole country ships to production as one 30 to 45 MB SQLite "pack" in the data folder.
   No object storage, nothing in git, nothing in the JS bundle, no extra RAM on the 8 GB box.
2. **The phone gets a 250 KB index once and then never waits.** Search, filters, "near me" and the map bubbles
   all run on the phone. That is the main thing REVER cannot match: its discovery is a server round trip behind
   a login.
3. **Three kinds of thing, not one list.** 5,800 records are really *roads and routes* (a line you follow),
   *trails and riding areas* (a place you go: OHV parks, trail systems; about 900) and *big trips* (BDRs, TAT
   sections, 250 mi and up; about 170). Mixing them is what makes other directories feel like a junk drawer.
4. **A quarter of the library has no place on the map yet.** 1,422 records carry no coordinates (RiderPlanet
   riding areas, state byway lists). They appear in state lists and search from day one and get a map pin once
   located (package L2).
5. **Duplicates are rarer than feared but matter on famous roads.** Among tracks on disk: 37 same-road groups,
   but 678 "this road is part of that longer ride" pairs and 19 Dragon variants. One road becomes one card that
   keeps every site's credit.
6. **The proof of concept reuses the ride page that already exists.** A library ride is handed to the current
   route page through a small adapter, so day one needs only the pack, four endpoints and the Explore map.
7. **The library track is a reference, never a verified route.** "Follow this track" shows the source line and
   says how old it is. "Ride this" (L5) has our router, or the labelled basic router outside coverage, build the
   ride along it and states how much of the track it matched.
8. **Unknown stays unknown.** 761 records say surface unknown, 5,232 difficulty unknown, 4,703 season unknown.
   Source claims are worded "source says". Only a fact we measured is stated flat.
9. **The library is still moving.** `catalogue.json` says 5,415; the folder already holds 5,815 (another session
   is enriching it). Everything here is a rerunnable build with a count report, never a one-off import.
10. **One thing for the owner to confirm by name:** BDR (29 records) and MotorcycleRoads.com (1,057) publish
    terms that forbid re-hosting. The plan follows the owner's word ("every site agreed") for everything already
    on disk; those two sources' tracks are link-outs today because the files were never copied, and fetching them
    waits for a one-line yes naming those two. Nothing else is blocked on it.

## 2. What is in the library (measured 2026-11-13)

| Fact | Number |
|---|---|
| Records in `catalogue.json` / on disk now | 5,415 / 5,815, 51 state folders |
| With a track on disk | 2,925 (catalogue) / 3,290 (disk); 4.09 M points, median 678, 16 over 20,000 (11 are trail bundles) |
| Link-only (track seen and measured, file not kept) | 1,184, of which 1,040 MotorcycleRoads.com |
| No track | 1,306: RiderPlanet 453, MN DNR 58, state byway programs |
| Have a box on the map (track or measured link) | 4,393 of 5,815; 1,422 have no coordinates |
| Type | paved-twisty 2,789, scenic 1,522, dual-sport 693, single-track 240, adv 108, bdr 17, bdr-x 12, gravel 17, mixed 17 |
| Our score | 5: 363, 4: 1,951, 3: 2,997, 2: 104 |
| Length (3,999 measured) | under 16 mi 648, 16 to 31 mi 879, 31 to 62 mi 983, 62 to 124 mi 870, 124 to 250 mi 485, 250 mi and up 134; median 42 mi |
| Loops (ends meet) | about 180 |
| Multi-state | 604 (517 two-state, 80 three-state, 7 more) |
| Trail bundles (`is_bundle`) | 186 |
| Legal status | public roads 4,499, designated OHV 842, mixed 37, unknown 36 |
| Surface as the source words it | "paved" family about 3,800, unknown 761, 272 distinct phrasings |
| Track age | 713 from 2010, about 1,400 from 2010 to 2013; 1,901 undated |
| Rider comments / stops | 364 records / 114 records (fuel 129, POIs 132, camping 19, lodging 6) |
| Photos and video | 0 (not collected yet) |
| Source rider rating buried in text | about 1,490 records |
| Older library on CT125 | 1,375 routes, 2,017 GPX, 129 MB, different field names (`kind`, `license.status`, `computed`) |

Sizes measured by encoding every track on disk (`polyline5`, the format the app already uses):

| Piece | Size |
|---|---|
| Index for all records (id, name, type, score, miles, states, start, box, flags) | 1.0 MB, **248 KB gzipped** |
| Full lines, all tracks on disk | 13.0 MB as recorded; **about 6 MB** after 5 m simplification (keeps 38% of points) |
| 64-point map lines, all tracks | 0.92 MB total; per state median 16 KB, largest TX 124 KB |
| Ride text (summary, credit, notes, stops), all records | 16.4 MB, 5.2 MB gzipped |
| Build time on docker-dev (parse every GPX, encode, dedupe scan) | 28 seconds, under 300 MB RAM |

## 3. The rider experience

Names in rider words: **Twisty** (paved-twisty), **Scenic** (scenic), **Dirt** (dual-sport, adv, gravel, mixed,
bdr, bdr-x), **Trails** (single-track, trail bundles, OHV riding areas), **Big trips** (a flag on top: BDR and
BDR-X, TAT sections, anything 250 mi or longer). Quality is two words, never stars: **Standout** (score 5) and
**Great ride** (score 4); 3 and 2 say nothing. Stars are kept for a real rider rating from the source
("4.6 of 5 from 23 riders on MotorcycleRoads.com").

### 3.1 How 5,800 rides are browsed

| Way in | What the rider does | How it works |
|---|---|---|
| By place | Pans the Explore map: state counts, then bubbles, then lines | Index on the phone; lines per state on demand |
| Near me | Taps "Near me": best rides starting within 75 mi, best first | Score, then distance; grows to the nearest 20 if fewer than 5 |
| By type | One chip row: Twisty, Scenic, Dirt, Trails, Big trips | Filters list and map together |
| By quality | "Standout only" switch; lists are always best-first | Score 5, then 4 |
| By length | Under 30 mi, 30 to 90, 90 to 250, 250+ | The three existing buckets plus one |
| By state | "Browse by state" grid with counts; multi-state rides show in each state | `states` on the index |
| By name or town | One search box: ride names and states at once; a town or zip becomes "Rides near Asheville" | Names on the phone; places through the existing geocoder |
| On my way | With a route planned: "3 great roads near your route" | Ride starts within 15 mi of the planned line (L6) |
| Big trips | BDRs and long routes as trip pages with sections, fuel gaps, camping | L7 |
| Trails and riding areas | Places, not lines: permit, season, fees, "Ride to the trailhead" | L8 |
| Famous roads | A short hand-kept list: Dragon, Cherohala, Beartooth, Blue Ridge Parkway, PCH | A 40-id list in the repo |

### 3.2 Phone layouts (390 x 844; every one must hold at 320 x 568)

Explore keeps one tab. On a phone it has two views and one floating pill that switches them. Tablet and desktop
show both side by side (list 420 px, map the rest), which `ExplorePanel` already supports.

**Explore, list view** (solid cards on the topo backdrop, as DESIGN.md says for pages without a map):

```
+--------------------------------------+
| Explore                       [Menu] |
| [ Search rides, towns, states      ] |
| (Near me)(Twisty)(Scenic)(Dirt)(Trails)(Big trips) >   one row, scrolls sideways
|                                      |
| Near you                    See all  |
| +------+---------------------------+ |
| | line | Cherohala Skyway          | |   96 px row; thumbnail = the ride's own line
| | shape| Standout · Twisty         | |
| |      | 43 mi · about 1 h 30      | |
| |      | 12 mi away · Route by ... | |   credit line, caption size, one line
| +------+---------------------------+ |
|   (4 more rows)                      |
| Best in Pennsylvania        See all  |
| Famous roads                See all  |
| Big trips                   See all  |
| Browse by state                      |
|  [PA 381] [TX 367] [NC 244] ...      |   3 across at 390, 2 across at 320
| Trails and riding areas     See all  |
|               ( Map )                |   floating pill, 48 px, above the tab bar
+--------------------------------------+
|   Map        Explore       My rides  |
+--------------------------------------+
```

"See all" and every chip open the same filtered list (rows only, count in the title: "Twisty in North Carolina,
212 rides"), with the pill still offering the map of exactly that set.

**Explore, map view** (glass chrome over a live map):

```
+--------------------------------------+
| [ Search rides, towns, states ][Menu]|   glass
| (Twisty)(Scenic)(Dirt)(Trails)(Big trips) >
|                                      |
|      (381)                 (62)      |   zoomed out: one count per state
|             (48)   (12)              |   closer: count bubbles; tap = zoom in
|        ~~~~\      /~~~~~             |   closer still: thin plum lines,
|             \~~~~/    - - - -        |   dashed where the type is Dirt or Trails
|                  o                   |   o = a ride with a place but no line
|                               [Loc]  |   one map button (the rule allows two)
| +----------------------------------+ |
| | Tail of the Dragon      Standout | |   one glass card for the tapped ride
| | 11 mi · Twisty · TN, NC          | |
| | Route by ... · BestBikingRoads   | |
| | [ Open ride ]            1 of 3 >| |   overlapping lines: swipe between them
| +----------------------------------+ |
|        ( 214 rides here · List )     |   pill: the list of exactly what is in view
+--------------------------------------+
|   Map        Explore       My rides  |
+--------------------------------------+
```

At 320 x 568 the card drops the credit line to the ride page and the chip row stays one line; the map never
falls under 55% of the screen with a card open.

**Ride page** (the existing map-first route page, extended in L3):

```
+--------------------------------------+
| [<]        map with the line         |   line in plum; start and end marked
|                                      |
+--------------------------------------+
| STANDOUT · TWISTY                    |   eyebrow
| Tail of the Dragon                   |
| 11 mi   about 30 min                 |   Outfit numbers
| Paved, the source says               |   truth lines: claim / unknown / measured
| Track from 2011. Check roads first.  |
| Rain after 3 pm at the start         |   weather line; a warning is never hidden
| [ Follow this track ]                |   primary (becomes "Ride this" in L5)
| [ Save ] [ Share ] [ GPX ]           |
| About this ride ...                  |
| Riders say (3) ...                   |   quoted, named, dated, linked
| Stops: fuel 2 · camping 1            |
| Good to know: season, permit, access |   each "the source says", or "not stated"
| Also on: MotorcycleRoads.com, ...    |   every site's credit and link kept
| Part of: Dragon and Cherohala loop   |
| Route by ... · BestBikingRoads       |   credit footer with the source link
| Report a problem with this ride      |
+--------------------------------------+
```

### 3.3 Cards, lines and credit rules

- **Card facts, in this order:** quality word (if any) and type; miles and estimated time (28 mph rule already in
  `route-facts.ts`); distance from the rider when known; credit line. A fact we do not have is left off the card.
- **Thumbnail:** the ride's own line shape, plum on `--og-surface-2`, from the index. No map image request per
  card: 5,800 cards on the Mapbox static-image API would break the "$0 a month" bar.
- **Lines on the map:** thin plum (the 2026-11-10 "Rider-picked rides" decision), dashed for Dirt and Trails,
  the tapped one drawn as the chosen-route plum at full weight. Count bubbles are neutral `--og-glass-dense`
  with ink numbers. No new colours.
- **Credit:** unchanged rule from 2026-11-12, "Route by <author> · <source>" with the source linked. A merged
  card shows the primary source on the card and all of them on the ride page.
- **Honesty wording:** a source claim reads "Paved, the source says"; nothing known reads "Surface unknown";
  a fact measured on our road data (in coverage, L5) reads flat, "92% paved · 3.1 mi gravel". Old tracks carry
  "Track from 2011. Check roads first." Designated OHV areas say "Open to motorcycles, the source says" and
  carry the permit line; legality is never stated as our own finding.

### 3.4 The same road from several sites

One card per road. The build groups records whose lines cover the same ground (section 5.3), picks a primary
(track on disk first, then score, then rider notes, then newest track) and keeps the rest as "Also on" with
their own credit lines and links. A short road that sits inside longer rides gets "Part of" links, and the long
ride gets "Includes". The 112 hand-curated PA/NJ rides always win as primary. Nothing is deleted: every source
record stays in the pack under its own id, and an old link to a merged id opens the primary card.

### 3.5 Why this beats REVER's discovery

| | REVER | OpenGravel library |
|---|---|---|
| Getting in | Account first; Butler maps, twisty routing and offline are PRO ($39.99/yr, per `.fable/ROUND-PLAN.md`) | No account, free, GPX included |
| What you browse | A community feed: the same road many times, uneven quality | One road, one card, every site credited, every ride scored and typed |
| Speed | Server search per pan | Index on the phone: filters under 50 ms, works with weak signal |
| Trust | Rider-entered, unlabelled | Track age, "the source says", unknown said as unknown, permits and seasons quoted |
| Kinds of riding | Road rides first | Twisty, scenic, dirt, trail systems and OHV areas, big trips with sections |
| From finding to riding | Open a track | Router-built ride with turns, bike-aware in coverage, weather warnings on the page |
| While planning | Separate screens | "Great roads near your route", one tap to add |

Proof numbers to publish with the round: index under 350 KB; first bubbles on the map under 2 s on a 4G profile;
filter changes under 50 ms on 6,000 records; ride page under 60 KB over the wire.

## 4. Design decisions to record (owner delegated look-and-feel; add to the DESIGN.md decision log in the L1 PR)

> 2026-11-13 Owner ("top tier organization layout and setup... way better than REVER"; picks by Opus and Fable,
> `.fable/LIBRARY-PLAN.md`): Explore covers the whole country. On a phone it has a list view (solid cards on the
> topo backdrop) and a map view (glass chrome on the live map), switched by one floating pill above the tab bar;
> tablet and desktop show both. The map shows a count per state, then count bubbles, then the rides as thin plum
> lines, dashed where the ride is dirt or trail, with neutral glass bubbles and no new colour. Ride types read
> Twisty, Scenic, Dirt, Trails and Big trips. Our own quality is the words "Standout" and "Great ride", never
> stars; stars appear only for a rating a source's riders gave, named as theirs. A library ride's list thumbnail
> is its own line shape, not a map image. A fact a source claims reads "the source says"; a track's year is
> shown; unknown reads unknown. A library ride offers "Follow this track" (the source line as drawn) and, once
> the router has built it, "Ride this"; a route from the basic router outside our coverage is labelled
> "Basic route".

Also add one row to `docs/PLAN.md` section 3 (milestone 14, lane L: "National ride library: find a great ride
anywhere in the country and follow it") so the freeze rules know this work is sanctioned. Do not touch the
frozen `src/application/long-trip` code: "Big trips" here are library records, not that planner.

## 5. Data pipeline

One command, rerunnable, no network: `node --import tsx scripts/route-library/build-pack.ts --library <dir>
[--old-library <dir>] --out <dir>`. It writes the pack, `pack-report.md` and exits non-zero when a gate fails.
Originals (the 548 MB) stay in the library folder on docker-dev and CT125 and are never copied to production.

### 5.1 Stages

1. **Read and gate.** Every `routes/<ST>/<id>.json` must parse against `route-record.schema.json` fields the
   pack uses. Records failing `validate.py` errors are skipped and listed. Ids are frozen; an id that collides
   with a curated catalog id fails the build.
2. **Policy.** `scripts/route-library/sources-policy.json`: one line per source, `mode: host | link | hide`,
   `basis: "owner-confirmed permission 2026-11-13"`. `host` serves the line and GPX; `link` shows the card and
   sends the rider to the source for the file; `hide` drops the source (the takedown switch). Default `host`;
   a source with no file on disk is `link` by nature. Credit line and source URL are required for every mode.
3. **Geometry.** Parse with the app's own GPX reader (`src/application/import`), track points first, route points
   as fallback; keep bundle segments separate; simplify at 5 m; raise the tolerance until the line is 20,000
   points or fewer (the app's public-ride cap); encode `polyline5`. Derive start, end, box, measured miles,
   loop (ends within 150 m, the app's existing rule), 64-point map line, 24-point card line.
4. **Track sanity flags** (flags, not deletions): `rough` when a track has fewer than 20 points per 30 mi or a
   jump over 3 mi between points on a non-bundle; `old` when the track year is 2015 or earlier; `mismatch` when
   measured miles differ from the source's stated miles by more than 40% (the Twisted Sisters case). A rough
   track is drawn but offers neither "Follow this track" nor "Ride this", only the source link and GPX.
5. **Classify.** Type from lane (section 3). Kind: `area` when `is_bundle` or (no track and legal status
   designated OHV); `trip` when lane is bdr or bdr-x, miles are 250 or more, or the name is on the trip list
   (TAT, Continental Divide, BDR-X); otherwise `road`.
6. **Facts, never upgraded.** Surface claim from a fixed phrase table: `paved`, `unpaved`, `mixed`, else `null`
   (272 phrasings today; anything not in the table is unknown). Season, permits, difficulty and legal status are
   carried as quote plus source, or `null`. No stage may turn `null` or "unknown" into a value; a unit test feeds
   every distinct phrase in the library through the table and fails on any phrase mapped without a table row.
7. **Dedupe and relations** (L2; section 5.3).
8. **Locate** (L2). A record with no coordinates gets `location` from the library record when the library
   session supplies it; otherwise it stays list-only. The build never guesses a pin.
9. **Write** the pack, then the report: counts by state, type, kind, mode, flags, groups, skipped records with
   reasons, and the size of every asset against its budget.

### 5.2 Quality gates (build fails)

Validator errors above zero in shipped records; any record without credit line or source URL; index over 400 KB
gzipped; any state line file over 200 KB gzipped; any ride over 20,000 points; any `null` fact rendered as a
value in the fixture snapshot; ride count dropping more than 2% against the previous pack without `--allow-drop`.

### 5.3 Dedupe

- Resample each non-bundle line every 200 m and mark the 300 m grid cells it touches.
- **Same road:** two lines share 80% or more of the shorter one's cells and their lengths are within 30%.
  Also, for records with no line: same state, name tokens 80% alike. Groups are joined transitively and capped
  at 12 members; a larger group fails the build for a human look.
- **Part of:** the shorter line has 80% of its cells inside a line more than 30% longer.
- Primary: curated catalog ride, else track on disk, else higher score, else rider notes, else newer track.
- Inputs compared together: the 112 curated rides, the national library, the older CT125 library (read through
  an adapter: `kind` to lane, `license.status` to policy, `computed` to stats). An old-library route whose road
  is already present only adds its credit; one that is new comes in as its own record.
- Expect roughly: 40 to 150 same-road groups once link-only tracks are fetched, about 700 part-of pairs.

### 5.4 Asks for the session that owns the library

1. `location { lat, lon, precision: "trailhead" | "town" | "area", source }` on all 1,422 records without one.
2. `source_rating { value, scale, count }` as fields (about 1,490 have it only inside a text note).
3. `claimed_distance_km` from the source page.
4. Fetch the link-only tracks into `hosted` now that permission is confirmed; hold BDR and MotorcycleRoads.com
   until the owner names them.
5. Photos with credit and licence, and whether each may be hosted or only linked (0 collected today).
6. Never rename an id; removed records go in `tombstones.json` so old links can say "this ride was removed".
7. Rebuild `catalogue.json` after each batch (it is 400 records behind the folder).

## 6. Serving architecture

```
library folder (docker-dev / CT125, 548 MB originals, never deployed)
        |  build-pack.ts  (28 s, < 300 MB RAM)
        v
route-library-<version>.sqlite  (30-45 MB)   +  pack-report.md
        |  infra/route-library/publish-pack.sh  (rsync, checksum, switch symlink, smoke)
        v
docker-stable:/root/Vibe/opengravel-data/route-library/current.sqlite   <- OGV_ROUTE_LIBRARY_PACK
        |  node:sqlite, read-only, opened lazily, reopened when the file changes
        v
Next route handlers  ->  Cloudflare  ->  phone (index kept in the browser cache)
```

**The pack (one SQLite file).**

| Table | Holds |
|---|---|
| `meta(key, value)` | `schema`, `version` (first 12 hex of the content hash), `built_at`, counts |
| `ride(id PRIMARY KEY, detail BLOB, line TEXT, points INTEGER)` | `detail` is gzipped JSON; `line` is `polyline5`, bundle segments joined with `;` |
| `asset(key PRIMARY KEY, body BLOB, content_type)` | gzipped, ready to send: `index`, `lines/PA` ... `lines/WY` |
| `alias(id PRIMARY KEY, primary_id)` | merged and old ids pointing at their primary card |

**Endpoints** (code name `route-library`; `library` in this codebase already means the rider's own My rides).

| Route | Returns | Cache |
|---|---|---|
| `GET /api/route-library/manifest` | `{ version, builtAt, rides, located, withLine, states: { PA: 381, ... } }`; 404 when no pack is configured | 5 min |
| `GET /api/route-library/<version>/index.json` | the index (below), sent gzipped as stored | one year, immutable |
| `GET /api/route-library/<version>/lines/<ST>.json` | `{ state, lines: [[id, polyline64], ...] }` | one year, immutable |
| `GET /api/route-library/rides/<id>` | the ride (below); follows `alias` | 1 hour, ETag = version |
| `GET /api/route-library/rides/<id>/gpx` | GPX written from the stored line with the credit in its metadata; 403 with the source link when the policy is `link` | 1 hour |
| `GET /api/catalog/<id>` (existing) | unchanged for curated rides; falls back to the library ride reshaped as a `CatalogEntry` | as today |

**Index row** (one per card; merged members are not rows):

```json
{ "id": "tn-tail-of-the-dragon", "n": "Tail of the Dragon", "k": "road", "t": "twisty", "q": 5,
  "mi": 11.2, "st": ["TN", "NC"], "p": [35.4663, -83.9193], "pp": "start",
  "bb": [-83.99, 35.46, -83.91, 35.52], "f": 7, "s": 3, "c": "~polyline of 24 points~", "sf": "p" }
```

`k` kind (`road`, `area`, `trip`), `t` type (`twisty`, `scenic`, `dirt`, `trail`), `q` score, `mi` measured
miles or `null`, `p` start point or `null`, `pp` how exact the point is (`start`, `area`, `town`), `f` flags
(1 has line, 2 loop, 4 GPX allowed, 8 old track, 16 rough, 32 rider notes, 64 stops, 128 merged from several
sites), `s` index into the top-level `sources` name list, `c` card line, `sf` surface claim (`p`, `u`, `m`,
`null`). The file's top level also carries `version`, `sources` and `stateCounts`.

**Ride detail** (`/rides/<id>`): `id, name, kind, type, score, scoreReason, states, summary, miles, loop, start,
bounds, line | segments, points, track { availability, year, old, rough, gpxAllowed, sourceDownloadUrl },
facts { surface, legal, difficulty, permits, season } each { value | null, quote, source }, credit { author |
null, sourceName, sourceUrl, creditLine }, alsoOn [credit...], partOf [id, name], includes [id, name],
sourceRating | null, notes [{ author, text, date, url }], stops { fuel, camping, lodging, pois }, alternates,
sections (trips), provenance { basis, scrapedAt, lastVerified }`.

**Numbers.**

| Item | Budget | Expected |
|---|---|---|
| Pack on disk (keep current + previous) | 100 MB of the 5.8 GB free | 60 to 90 MB for two |
| Server memory | no growth beyond 30 MB with the pack open | SQLite page cache only; no ride is held in memory, unlike `serverCatalogEntries` today |
| First Explore load on a phone | index 350 KB gzipped | 250 to 300 KB once, then cached for a year per version |
| Looking at one state | one line file, 200 KB cap | median 16 KB, TX 124 KB |
| One ride page | 60 KB | median about 4 KB; the 20,000-point worst case about 70 KB raw, 45 KB gzipped |
| Phone work per filter change | 50 ms on 6,000 rows | array filter plus MapLibre source update |
| Requests per map session | manifest + index + 3 to 6 state files | all cacheable at Cloudflare (`.json` paths) |

**Why not the alternatives.** Loading the library into `data/catalog/routes.json.gz` would hold about 4 million
points as objects in the Node process (hundreds of MB on a box whose swap is already full) and put 30 MB into
git on every refresh. Object storage adds an account and a bill for 40 MB. Vector tiles (PMTiles, already a
dependency) are the right move past roughly 25,000 lines or if 320 px phones stutter; until then GeoJSON from
state files is simpler and needs no tile tooling. That switch is a later package only if the numbers demand it.

**Rollout switch.** No `OGV_ROUTE_LIBRARY_PACK`, or a missing file, means the manifest returns 404 and Explore
behaves exactly as it does today. Rollback of data is repointing the symlink; it never needs a code release.

**Precompute, decided.** In the pack build: simplified lines, map and card lines, start, box, miles, loop, type,
kind, flags, surface claim, dedupe groups and relations. In L5: router match share and, inside coverage, measured
surface. Not now: elevation gain (33 records have it; our elevation service can fill it later), rendered map
thumbnails (line-shape thumbnails cost nothing; revisit only if the owner asks after seeing them), twistiness
from old sparse tracks (a 100 m-spaced 2011 track cannot support a bend count; twistiness comes from our own
road data when a ride is router-built).

## 7. Work packages

Order matters; L1's two lanes run side by side against the contract in section 6. Work-in-progress limit stays
at 3 open PRs. One browser and one heavy job at a time on docker-dev; send long shot runs out with
`fleet run auto`. Every screen PR attaches shots at 390 x 844 and 320 x 568, Day and Night.

| # | Rider sentence | Brief | Worker | Size | Needs |
|---|---|---|---|---|---|
| L1a | "Every ride in the country is one tap from loading." | `lib-1a-pack-and-api.md` | Sonnet | 5 h | none |
| L1b | "I open Explore, see rides across the whole country, and open one." | `lib-1b-explore-country.md` | Sonnet | 7 h | L1a's fixture pack (first 90 min of L1a) |
| L2a | "One road is one card, with everyone credited." | `lib-2a-one-road-one-card.md` | Opus (or Codex Sol) | M | L1a |
| L2b | "What the page says about a ride is exactly what the source said." | `lib-2b-facts-and-gates.md` | DeepSeek | M | L1a |
| L3 | "The ride page tells me if this ride is worth the trip." | `lib-3-ride-page.md` | Sonnet | M | L1 |
| L4 | "I find a good ride in three taps: near me, by state, by type, by name." | `lib-4-find-it-fast.md` | Sonnet | M | L1, better after L2 |
| L5 | "I tap Ride this and get turns, anywhere in the country." | `lib-5-ride-it.md` | Opus (or Codex Sol) | L | L1; `routing/valhalla-outside` merged for outside PA/NJ |
| L6 | "Great roads show up on my map and along the route I just planned." | `lib-6-on-my-way.md` | Sonnet | M | L1, L4 |
| L7 | "A BDR or a long trip reads as days and sections, with fuel and camps." | `lib-7-big-trips.md` | Sonnet, DeepSeek for the section table | M | L3 |
| L8 | "A trail system is a place I can ride to, with its permit and season." | `lib-8-trails-and-areas.md` | Sonnet | M | L2b, L3 |
| L9 | "The library stays current and a bad listing is gone the same day." | `lib-9-keeps-itself-fresh.md` | DeepSeek | S | L1a |
| L10 | "I see what the road looks like before I go." (parked until photos exist) | `lib-10-photos.md` | Sonnet | S | library session delivers media |

**L1 is the proof of concept: one day, two workers.** When it is done the owner can open Explore on a phone, see
381 on Pennsylvania and 367 on Texas, pinch into the Smokies, tap a line, read who made it, follow the track
and download the GPX. Shipping it to production is one `publish-pack.sh` and one normal release, each on the
owner's go.

Suggested calendar: day 1 L1a + L1b; day 2 L2a + L2b + L3; day 3 L4; days 4 to 5 L5; then L6, L8, L7, L9.

## 8. Risks and what not to build

1. **Permission lives only in a sentence.** Mitigation: the per-source policy file with the basis string, the
   `hide` switch, "Report a problem" on every page, same-day removal by pack rebuild (L9). Ask the owner to name
   BDR and MotorcycleRoads.com before their tracks are fetched.
2. **Old tracks.** A third of dated tracks are from 2010 to 2013; roads close and gates appear. Every old track
   says its year; inside coverage "Ride this" runs the same closure and bike checks as any planned ride.
3. **OHV legality.** 842 records are "designated OHV" on the source's word. Always worded as the source's claim,
   with the permit line; never part of router eligibility.
4. **Breadth creep.** The 90-day plan froze breadth. This round is three screens (list, map, ride page) and one
   pipeline; trips and trail pages are the same ride page with extra sections. No social feed, no ratings of our
   own, no uploads, no accounts.
5. **CSS budget.** `css:budget` is at its cap (20,023 lines). The round may add at most 500 lines in total, each
   raise stated in the PR next to the decision-log line; L4 pays some back by removing the old Explore filters.
6. **Production memory and disk.** Budgets in section 6 are checks in L1a, not hopes.
7. **Router coverage.** Outside PA/NJ the ride is a followed line until the basic router lands; the page says
   so. L5 does not start outside-coverage work before `routing/valhalla-outside` is on main.
8. **A moving library.** The other session keeps adding records. The pack build is the only door in; nothing is
   hand-copied.

Not building: accounts, comments of our own, ride uploads into the national set, our own star ratings, a second
tab, map thumbnails rendered per ride, vector tiles (until the numbers ask), anything in the frozen areas.
