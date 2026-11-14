# L7 + L8 report: big trips and trail areas on the ride page

**Rider sentences:** "A BDR or a long trip reads as days and sections, with fuel and camps." /
"A trail system is a place the rider can ride to, with its permit and season."

Branch `library/l7-l8-trips-trails`. Nothing pushed, merged or deployed.

## What changed

### A trip reads as days and sections (L7)

- **`src/application/route-library/trip-sections.ts` (new).** Reads the source's own section names
  ("Section 1: Mexico border to Benson (128 mi)") into `{ day, label, miles }`; adds up only the
  distances the source stated; reads a day count only when the source wrote one ("4-6 days").
  A single track name ("FortBraggt") is the file's name, not a section, and a repeated name is one
  track split into segments, so neither is shown as a section.
- **`ride-detail.ts`.** `sections` is now set only for a trip whose source published more than one
  named track (or one name worded as a section). This stops a 300-mile road with one track from
  appearing as a one-section trip.
- **`src/ui/explore/LibraryRideSections.tsx` (new).** The ride page gains:
  - **Days and sections** — the source's day count when it wrote one, then one row per section
    ("Day 1 · Mexico border to Benson · 128 mi") and the stated section miles added up.
  - **Fuel and camps** — every stop the source lists, with its own source link, and a plain
    "The source lists no fuel stops / no camps" when the source lists none.
  - **Good to know** — access, permit, season and surface in the source's words.

### A trail system is a place to ride to (L8)

- **`place` on the ride detail** (contract addition to `.fable/LIBRARY-PLAN.md` §6): the index pin
  with its precision (`start` | `area` | `town`), so a trail area has a place without a line.
- **`src/application/explore/directions.ts` (new).** "Ride to the trailhead" for a trailhead pin,
  "Directions to the area" / "Directions to the town" by how exact the source's pin is; Apple Maps
  on Apple devices, Google Maps elsewhere. The destination is the source's point; we do not draw a
  route to it.
- **The area ride page** now draws the place on a map with a pin (`RoadLocationMap`) instead of a
  missing line, offers the one directions action, hides the line-only truth lines, and shows a
  **Ride here** block with access, permit and season — permit and season always said, even as
  "not stated". The header credit still links the source.
- **`src/application/route-library/fact-wording.ts` (new).** The four wording helpers moved out of
  `facts.ts`, so the ride page does not carry the 278-row surface phrase table into its bundle.
  `facts.ts` re-exports them, so nothing else changed.

### Data honesty

No fact was invented or upgraded. Every section, mileage, day count, stop, permit and season on
these pages is copied from the pack; a silence stays a silence. Fuel and camps come only from the
record's `ancillary` stops (the fixture has real ones on the Cherohala and Lovelady records). A
trip whose source lists none says so. A trail area with no coordinates (White Water ORV Area) gets
no pin and no directions action; the source link is the way on.

## Checks run

| Command | Result |
|---|---|
| `npm ci` | installed |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 6 warnings (pre-existing, `.fable/*.mjs`) |
| `npx vitest run tests/unit/ui tests/unit/explore tests/unit/application/ride-credits.test.tsx tests/unit/route-library` | 132 files, 1527 tests, all pass |
| `npx vitest run --project architecture` | 15 files, 179 tests, all pass |
| `npm run css:budget` | ok; no change to `scripts/qa/css-budget.json` (19941 lines now vs 20195 budget) |
| `npm run build` | success |
| `npx playwright test tests/e2e/critical/library-trip-and-area.spec.ts --project=critical-chromium` | 4 passed (390x844 and 320x568, trip and area) |
| fixture pack rebuild (`build-pack.ts --library tests/fixtures/route-library/source`) | PASS, version `6484592570bf`, 14 rides, all gates pass |

The committed `pack.sqlite` and `dedupe-pack.sqlite` were rebuilt because the ride detail gained
`place` and the section rule; both fixture tests compare the committed pack's version to a fresh
build.

## Screenshots

`.fable/shots/l7-l8/` — trip and area, 390x844 and 320x568, Day and Night, plus the area's map and
pin at 390 in both themes. The pages hold at 320 without sideways scrolling (the critical spec
asserts it).

## Contract change

`.fable/LIBRARY-PLAN.md` §6 ride detail now lists `place` and states that `sections` holds only a
trip's published multi-section names. No endpoint path or response envelope changed.

## Not done

No push, merge or deploy. BDR and MotorcycleRoads.com remain link-only; no track was fetched.
