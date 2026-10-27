# Design v3 — handoff for a fresh Claude session (2026-10-26)

## The job

Make the OpenGravel UI materially, visibly better: award-quality, on the owner's iPhone Pro
Max, on small phones, iPad and desktop, in Day and Night. **You (Claude Opus) do the design
and the CSS yourself.** No Terra or Codex delegation for this work, and no new tooling
projects. The owner does not read code; he judges screens. He is tired of patch rounds and
of being asked the same questions, so don't ask: decide within DESIGN.md and build.

The core of the job is the stylesheet. `src/app/globals.css` is 14,721 lines and
`src/app/theme-glass.css` is 3,069 lines, with 15 more files under `src/ui/**`. Together
they hold four competing palettes (base light `:root`, a `prefers-color-scheme: dark`
block at globals.css ~13,710, the "glass" default `:root` in theme-glass.css, and
`[data-theme="day"]`), 165 literal colours, 71 distinct shadows, 31 radii, 24 z-indexes
and 39 distinct `@media` conditions. Every past round appended overrides. That is the root
cause of the churn. Replace it with a small, owned system; don't patch it again.

## Where things are

- Worktree: `/root/Vibe/wt/.wt/og-mobile-og-shots`, branch `dlg/og-shots`, which sits on
  top of `integ/mobile-20261026`. Work on a new branch from here, e.g.
  `git switch -c design/v3`. Not pushed. Production is https://opengravel.henning.rodeo.
  Don't deploy: the owner approves first.
- **Read first:** `DESIGN.md` (repo root). It holds the locked direction, tokens, themes,
  breakpoints and screen rules. Then `docs/vnext/design/small-screen-v2.md` (phone layout
  and type scale), `docs/vnext/design/maps-for-riders.md` (map gesture contract: don't
  break it) and `docs/vnext/design/token-inventory-2026-10-26.md` (an exact audit of every
  token, literal, breakpoint and large section, with line numbers).
- CSS imports: `src/app/layout.tsx` lines 4–13 (globals, theme-glass, planner, phone-plan,
  search-home, sheet …). Fonts are Plus Jakarta Sans (body) and Outfit (display) via
  next/font in layout.tsx.
- Theme: `src/ui/appearance/appearance.ts` sets `data-theme="day"|"night"` on `<html>`
  before paint. Auto follows the phone and the sun.
- Night map:
  - `src/infrastructure/map/basemap.ts`: modes are mapbox, openfreemap, osm and empty.
    OpenFreeMap Liberty is the token-free default.
  - `src/infrastructure/map/night-contrast-style.ts`: Mapbox navigation-night-v1, used
    only with a Mapbox token.
  - `src/infrastructure/map/maplibre/style.ts` ~line 951 `nightScrimLayer()`: a 38%
    dimmer used when there is no dark style.
  - **Bug:** in today's Night screenshots the map was fully light, with no scrim visible.
    OpenFreeMap has a free dark style at `https://tiles.openfreemap.org/styles/dark`
    (returns 200). DESIGN.md §3 says Night = dark basemap, always.
- Other known UI defects:
  - The planner-error message overlaps the sheet's grab handle on phone.
  - The fixture route line is nearly invisible: it's 0.8 mi, which is a test artefact.
  - Earlier owner complaints (in `.qa/owner-*.jpeg` in `/root/Vibe/wt/og-mobile`):
    - The "Undo clear" home sheet has orphan pin buttons, stacked Loop/Record/Free Ride
      boxes and an Undo chip over the grab bar.
    - The place card has big dead space.

## Plan of attack (suggested; your call on order)

1. **Tokens.** Create `src/app/tokens.css` exactly per DESIGN.md §4: semantic colours for
   Day and Night, type, space, radius, two shadows. Import it first. Alias the old names
   (`--og-paper`, `--og-go`, `--og-ember` …) to the new semantic ones so nothing breaks.
2. **Two themes only.** Fold the glass palette and the dark media-query palette into
   `[data-theme="night"]`, and the base `:root` into Day. Remove backdrop-filter glass from
   sheets and controls (solid surfaces).
3. **Night is dark.** Wire the OpenFreeMap dark style (and night-contrast with a token) for
   Night, and find why the scrim didn't show. Check that route, pins and labels read on it.
   A theme switch must not reload or lose the route.
4. **Rewrite, don't patch.** Go screen by screen: Plan (idle, search, route choices, sheet
   expanded, error), Ride, Explore, My rides, Settings, place card, layers. For each,
   rewrite its CSS as one coherent block using only tokens, delete the superseded rules
   (the inventory lists them), and collapse breakpoints to phone <761 / tablet 761–1180 /
   desktop ≥1181 / landscape max-height 500. Moving screen CSS next to its component in
   `src/ui/<area>/*.css` is fine and preferred.
5. **Make it beautiful, not just consistent.** Hierarchy, rhythm, restraint, real
   typography, a calm solid sheet, a dark map at night, generous ride numbers. The quality
   bar is Apple Maps / onX. Use the `impeccable` skill for critique and polish passes.
6. **Report counts** before and after: CSS lines, literal colours, @media conditions,
   shadows and radii.

## How to check your work (light, not a project)

- `npm run shots -- --devices iphone17,desktop --map real --themes light,dark` captures
  every main screen on real iPhone Safari (Mac simulator over `ssh macbook`) and desktop
  Chromium into `shots-out/<time>-<sha>/index.html`. Run it before you start (keep the
  "before" dir) and after each big step, and **look at the PNGs**. Add `iphone17promax`
  for the owner's size. Its README is `scripts/og-shots/README.md`. It's a camera, nothing
  more.
- Gates before calling it done: `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`
  (5,664 tests passed at a7d3c482), `npm run test:architecture`,
  `npm run test:e2e:critical`. Update a test that pins an old visual only when the new
  visual follows DESIGN.md, and say which.
- Send the owner before/after images (SendUserFile) when a screen is done, not only at the
  end.

## Rules of the house

- docker-dev has 8 GB and 4 CPU and was force-restarted today by two concurrent builds.
  Run one build/test/server at a time, with `nice -n 10` and
  `NODE_OPTIONS=--max-old-space-size=3072`. Check `free -m` first. Kill only PIDs you
  started, and never touch ports 3200 or 3360.
- Safari WebDriver on the Mac allows one session at a time. The Mac has ~34 GB disk free.
- Don't use a bare `git stash`. Commit in logical steps, each message ending with the
  session's attribution lines.
- Don't push or deploy without the owner's yes. Never `rm` with wildcards.
- Another session's work: `/root/Vibe/wt/.wt/og-mobile-plan-screens` (branch
  `dlg/plan-screens`, uncommitted Plan-screen CSS fixes) will conflict. Leave it alone and
  mention it in the final report.
- Codex quota was exhausted on 2026-10-26 (it resets at about 20:19 local time).

## Done means

The owner opens the before/after images on his phone and the app looks like one designed
product in every screen and both themes:
- no light map at night;
- no clipping or overlap at 320–440 px;
- the stylesheet is a fraction of its size, built from one token file;
- all gates are green.
