# Design picks, decided 2026-11-10

Owner handed the call over ("they all look good, give me a world class app"). These three are
decided. Opus builds to them; the log entries in section 6 go into `DESIGN.md` as written.

Shots judged: `picks/sbs/p1-*.png`, `picks2/sbs-rothrock.png`, `picks2/sbs-statecollege.png`,
`picks/sbs/p3-*.png`. No product code was touched.

## 1. Selected buttons: C (B, with a stronger "selected" mark)

**Why.** In A the desktop rail shows five green blocks and the one button that matters ("Create
ride") is the quietest thing on the panel; on the phone "Loop from start", "2 h", "Any" and "Make
my loop" all shout the same. B fixes that: one green thing per screen, and it is the thing you
press. But B as mocked is too faint at night (the selected "2 h" is a dark pill with a dark ring),
which fails a gloved glance in the dark. So: B's idea, with a ring you can see.

**Rule to lock.**
- Green fill (`--og-primary` + `--og-on-primary`) is allowed on exactly these: the one primary
  action of a screen or sheet (Make my loop, Create ride, Start, Save), the ride maneuver card,
  a switch in its on position, and the Loop pill on the chromeless home. Nothing else.
- Green as text or icon (`--og-primary-text`) is allowed on: the active tab (with its existing
  soft tint), text links such as "Connect", and the location puck ring.
- Every "one of several" choice (segmented controls, time and direction chips, Ride / Things,
  Day / Night, layer options, filter chips when on) uses the selected style, never green:
  - fill `--og-selected`, text `--og-ink`, weight 700, ring `box-shadow: 0 0 0 1.5px var(--og-selected-ring)`
  - unselected stays as today: no ring, `--og-ink` text at weight 600 on the `--og-surface-2` track
- New tokens in `src/app/tokens.css`:

  | token | Day | Night |
  |---|---|---|
  | `--og-selected` | `#fdfcf9` | `#2b3833` |
  | `--og-selected-ring` | `#0f1a15` | `rgb(236 241 238 / 60%)` |

- `--og-primary` job in the token table changes from "primary buttons, active tab, selected
  control" to "the primary action, switches on, maneuver card".
- Test: add the ring to `tests/unit/ui/contrast-tokens.test.ts`; ring against the track must be
  3:1 or better in both themes.
- A disabled primary action is never a grey slab. Either it is live, or it is green at 45%
  opacity with the reason in one line under it.
- Define it once as the segmented and chip primitives in `src/app/controls.css`; the five
  selectors in `.fable/picks.mjs` (P1) are the list of places to migrate, plus the Explore
  Ride / Things switch and the Settings segments, which the mock did not reach.

## 2. Night map: B (our own dark terrain)

**Why.** Over Rothrock, A is an empty dark rectangle with a few orange squiggles: no ridges, no
forest, no sense of where the good riding is. B shows the ridge-and-valley grain, the forest
and the contours, which is the whole reason someone opens this instead of Google Maps. Around
town the two are equal, so nothing is lost. REVER and Gaia both go flat at night; this is where
we can be visibly better.

**Rule to lock.** Night basemap is OpenGravel's own "Night terrain" style, built on Mapbox
Outdoors sources, as a real style file (not a runtime recolour). `navigation-night-v1` is
retired. With no Mapbox token, OpenFreeMap `dark` stays the fallback. Build in
`src/infrastructure/map/night-contrast-style.ts` and `src/infrastructure/map/basemap.ts`; map
colours come from the same values as tokens.

### Night terrain spec

The mock reads charcoal grey and paints every road the same white. The real style is green-black
(hue about 155, matching `--og-bg`) and ranks roads by how much a rider cares.

| layer | must show | colour target |
|---|---|---|
| land | base | `#0f1512` |
| forest / wood / public land fill | from zoom 7 | `#15251c` (clearly greener than land, not brighter than roads) |
| state forest, game land boundary | from zoom 9 | `#3f6b52` at 50%, 1px dashed, name label in `#8fb8a0` |
| hillshade | always, this is the hero | shadow `#04070a` at 55%, highlight `#3a4d43` at 30%, light from NW |
| contours | from zoom 11; index lines from zoom 10 | `#4a5c53` at 35%; index `#5f7268` at 55% with elevation labels |
| water | always | fill `#0c1c26`, lines `#1d3a4a`, labels `#6f9bb3` italic |
| built-up area | from zoom 9 | `#171c1a` (a faint warm lift so towns read as towns) |
| motorway / trunk | always | `#8e9994`, dark casing `#0b100e`; never pure white |
| primary / secondary paved | from zoom 8 | `#b9c2bd` |
| minor paved | from zoom 11 | `#7a857f`, thin |
| gravel / unpaved road | from zoom 10 | `#d6a862`, solid, same width as minor paved plus 0.5px |
| track / forest road | from zoom 11 | `#d6a862`, dashed 3-2 |
| surface unknown | from zoom 11 | `#7a857f`, dotted. Never drawn as paved or as gravel |
| path / trail | from zoom 13 | `#6d7a73`, dotted, thinner than any road |
| place labels | by rank | `#dfe6e2`, halo `#0b100e` 1.5px; towns weight 600 |
| road names, shields | from zoom 12; shields from 8 | `#aab4ae`; shields dark fill `#1d2724`, text `#ecf1ee` (no white lozenges) |
| peaks, POI | from zoom 11 | icon `#a2aea8`; no coloured dots except the ones a layer turns on |

Checks the build must pass:
- The chosen route (`--og-route` night `#b48ae0`, 5px with a 1.5px `#0b100e` casing) is 4.5:1 or
  better against land, forest and the motorway grey. Alternatives `#7d8a84` at 3px.
- Recording track `#f0805c` and the gravel tan `#d6a862` are told apart by width and casing, not
  hue alone: gravel has no casing, the track is 4px with casing.
- Gravel and unknown look different from each other and from paved at zoom 11 at arm's length
  (core invariant: unknown is never shown as paved or clear).
- Brightest thing on the map with no route is a town label, not a road. No pure white anywhere.
- Shots: Rothrock and State College, wide and close, phone and desktop, added to the og-shots
  gallery as fixed baselines.

## 3. Glass: B (glass only over the map)

**Why.** Put A and B side by side on Explore and Settings and you cannot tell them apart: there
is no map behind those cards, so the frosting has nothing to frost. It costs 97 blur blocks and
battery on a bar-mounted phone for no visible gain. Over the live map the glass is the nicest
thing in the app and stays.

**Rule to lock.**
- Glass (`--og-glass` / `--og-glass-dense`, edge, highlight, shadow, blur) only on things that
  sit directly on a live map: top search, chip row, map buttons, home pills, the plan sheet and
  desktop rail, the Layers sheet, the From / To card, ride-screen cards.
- Everything on a page with no live map behind it is solid: `--og-surface` fill, 1px `--og-line`
  border, `--og-radius-card`, no blur, no highlight, and a shadow only if it truly floats.
  That covers Explore rows and filters, My rides, Settings, route-detail text pane, dialogs.
- The docked tab bar is solid everywhere (already the owner's 2026-10-27 call for the bottom edge).
- The topo backdrop stays on non-map pages, as the page background.
- Two classes in `src/app/controls.css` (`og-glass`, `og-solid`) own the recipe. No other file
  may write `backdrop-filter`. Budget in `css:budget`: 12 or fewer declarations.

## 4. Three more things between "pretty good" and world class (ranked)

1. **Explore at night shows daytime pictures.** Every route thumbnail and the overview map are
   bright green day tiles under dark chrome, which breaks the "no light map under Night" rule
   and is the single ugliest thing in the set. The overview's 105 routes also merge into one
   grey blob. Fix: theme-aware static maps (use the Night terrain style) and draw overview
   routes in `--og-route-alt` thin with clustering or a count bubble at state zoom.
   Files: `src/application/map/static-map.ts`, `src/ui/explore/ExplorePanel.tsx`,
   `src/ui/explore/TrailMedia.tsx`.
2. **The desktop rail ends in a dead button and cut-off text.** "Create ride" is a grey slab and
   the helper line under it is sliced by the panel edge in every desktop shot. Build the
   ROUND-PLAN section 2 rail: fixed 72px foot with a live green action, two option groups,
   the rest under "More options", no "No plan yet" header. Files: `src/ui/planner/`,
   `src/app/controls.css`.
3. **Colour that means nothing in the chip row.** Gas is teal, Lodging pink, Food orange, Coffee
   brown, and the phone home sheet covers half the map (the rule says the map keeps 60%).
   Make chip icons `--og-ink-2`, and cap the Loop sheet at the 46% half detent with "Which
   way?" folded behind the summary row. Files: `src/ui/places/`, `src/ui/sheet/`.

All three stay outside frozen areas (hiking untouched).

## 5. First-minute wow

Owner's added requirement: a new rider should think "I want to use this" inside a minute. Five
moments, in the order a rider meets them, all built on data the app already holds. Nothing here
invents a number: every figure on screen is measured from the route or the atlas, and anything
not known is shown as unknown. Competitor claims are from my knowledge of REVER and Gaia GPS,
not checked today; confirm before using them in marketing copy.

| # | Moment | Rider sentence | What the screen shows | Why it beats REVER / Gaia | Touches | Size |
|---|---|---|---|---|---|---|
| W1 | Cold open | "It already knows where the good roads are." | The map opens on the rider's area with gravel in tan and the three twisty grades in line weight already drawn, plus one small legend chip bottom-left. No panel, no tutorial. | REVER keeps its best-roads maps (Butler) behind Pro and shows nothing about surface; Gaia shows terrain but has no idea which road is fun on a motorcycle. | ROUND-PLAN package 3 and layers 1, 2 (`src/ui/layers/*`, `src/application/map-layers/catalog.ts`); default set in `src/ui/map/` | S |
| W2 | First tap | "One tap and I have a real loop from my driveway." | Loop pill, then a 2 h loop drawn within about 5 seconds, built from named gravel and curvy roads, sheet at peek with name, time and Start. | Neither app builds a loop for you; both make you draw it or pick someone else's. | ROUND-PLAN package 4 (3 taps to a route), ROUTING-PLAN steps 5 and 6 (`loop-skeletons.ts`, `ride-search.ts`) | L |
| W3 | Route preview | "It tells me the truth about the surface." | Under the hero: "62 mi · 41% gravel · 3 mi unknown" and a full-width surface bar (paved grey, gravel tan, unknown hatched); the route line on the map carries the same colours; tapping the bar jumps the map to that stretch. | REVER gives distance and time only; Gaia gives elevation. Nobody says how much is dirt, and nobody admits what they do not know. | Plan sheet hero in `src/ui/planner/plan-sheet.css` and its component, surface data from `src/server/roads/gravel-atlas.ts`; ROUND-PLAN section 2 phone sheet | S |
| W4 | Route preview | "It checked whether I can actually ride it today." | One line under the surface bar: "Open today: 2 forest roads checked, 1 gate not confirmed", green / grey, never green for unknown; tap opens the "Is it open?" set on the route. | Both leave seasonal gates and closures to the rider to find out at the gate. | Layers 3 and 4 (`mvum`, `src/server/planning/road-authority.ts`), ROUND-PLAN package 6 | M |
| W5 | Cold open, zoomed out | "Real rides near me, picked by people who ride here." | The curated PA adventure rides as thin plum lines on the map; tap one for name, miles, gravel share and "Ride this". | REVER discovery is an unsorted pile of strangers' tracks; Gaia has none for motorcycles. | Layer 5 (`data/catalog/routes.json.gz`, new layer in `src/server/map-layers/providers.ts`), ROUND-PLAN package 6. Read the licence note in PLAN risk 5 first | M |

The Night terrain map (pick 2) is the sixth: open the app at dusk and the ridges are still there.
It is already in the round, so it is not ranked again here.

**Pass/fail for each.**
- W1: shot `cold-open` at 440 px, both themes, shows tan and twisty lines plus the legend chip
  with zero taps; browser test: map is usable within 3 s on the fixture and the home screen
  still has only search, Loop and Ride as controls (the 2026-11-10 front-door rule).
- W2: critical browser test: cold load to a drawn loop in 3 taps or fewer; scorecard loop rides
  per ROUTING-PLAN step 5; average planning 5 s to first answer per step 6.
- W3: shot `loop-planned` shows the fact line and bar; unit test: the three shares add up to the
  route length, and a route with unknown surface never reports 0 unknown.
- W4: unit test on the summary line: unknown and unavailable never count as open; shot
  `route-choices` with a fixture holding one closed and one unconfirmed road.
- W5: shot `cold-open-wide` shows plum lines; browser test: tap a line, tap "Ride this", the
  catalog route is on the map and nothing changed before the second tap.

**Rank by wow per effort:** W3, W1, W5, W4, W2.
**Build first: W3**, the honest surface line and bar. It is small, the data is already there, it
is the clearest thing no competitor shows, and it restates the product's core promise ("trust
it") on the one screen every rider sees. W1 goes next and rides along with package 3. W2 is the
biggest wow of all but it is the routing work already planned; do not start a second copy of it.

## 6. Decision-log entries (paste into `DESIGN.md` under "Decision log")

```
- 2026-11-10 Owner ("they all look good, provide me a world class app"; three picks decided by the
  design lead, `.fable/DESIGN-PICKS.md`): selected controls are neutral. Green fill is only the one
  primary action of a screen, a switch that is on, the maneuver card and the home Loop pill; every
  one-of-several choice uses `--og-selected` fill, `--og-ink` text at 700 and a 1.5px
  `--og-selected-ring` (Day `#fdfcf9` / `#0f1a15`, Night `#2b3833` / `rgb(236 241 238 / 60%)`).
  A disabled primary action is never a grey slab. Supersedes the `--og-primary` job "selected control".
- 2026-11-10 Owner (same hand-off): Night basemap is OpenGravel's own "Night terrain" style on
  Mapbox Outdoors sources: green-black land, forest tint, hillshade, contours, gravel in tan,
  unknown surface dotted, no pure white. OpenFreeMap `dark` stays the no-token fallback.
  Supersedes §3's `navigation-night-v1`. Spec: `.fable/DESIGN-PICKS.md` section 2.
- 2026-11-10 Owner (same hand-off): glass only on chrome and sheets that sit on a live map. Pages
  with no map behind them (Explore, My rides, Settings, route text pane, dialogs) and the docked
  tab bar use solid `--og-surface` cards with a `--og-line` border on the topo backdrop.
  `backdrop-filter` lives only in `src/app/controls.css`. Supersedes v4's "glass everywhere" (§2).
```

Also edit the body so it matches the log: §2 first bullet (glass), §2 third bullet (add "selected
is neutral"), §3 night basemap sentence, and the `--og-primary` row plus two new rows in the §4
token table.
