# OpenGravel design — the locked rules

Status: **locked 2026-10-26**. Every UI change follows this file. Changing a rule here
needs the owner's yes; a worker who disagrees writes the proposal under "Open proposals"
and keeps building to the current rule. Do not re-ask the owner anything this file answers.

Read with it (still binding, this file wins on conflict):
- `docs/vnext/design/small-screen-v2.md` — phone layout, type scale, spacing, touch sizes.
- `docs/vnext/design/maps-for-riders.md` — what taps, holds and drags do on the map.
- `docs/vnext/design/token-inventory-2026-10-26.md` — what the stylesheets held before v3.

## 1. Who and where

A motorcyclist. Plans on a laptop or phone; rides with the phone mounted on the bars,
screen always on, often gloved, in sun, rain and dark. Primary device: iPhone Pro Max
(440 px wide) in Safari or added to the Home Screen. Must also hold up at 320 px, on
iPad and on a 1440 px desktop.

## 2. Direction: "trail instrument"

Premium technical-outdoors. Quiet, warm, exact — a good GPS unit and a paper map, not a
glossy app. The map is the hero; chrome is calm and solid.

- **Glass everywhere (v4, owner 2026-10-27).** Every surface that sits on the map or on a page
  is frosted glass: `--og-glass` for chrome (tab bar, top search, chips, map buttons),
  `--og-glass-dense` for sheets, cards and panels that hold sentences or ride numbers. One
  recipe: 1px `--og-glass-edge` border, the fill, `box-shadow: var(--og-glass-highlight),
  var(--og-glass-shadow)`, `backdrop-filter: var(--og-glass-blur)`. Nested blocks inside a glass
  card use `--og-glass-well` or hairlines, never a second blur. Non-map pages sit on the
  fixed topographic backdrop (`body::before/::after`, `public/textures/topo.svg`) so the glass
  has terrain to frost. Solid only when the browser has no backdrop blur or the rider asks for
  reduced transparency (tokens.css handles both). No glow, no gradients on controls.
- **No dead space.** The tab bar is docked (Google Maps layout, 2026-10-27) and the Plan
  sheet sits flush on it; lists are compact rows (Explore: 96px thumbnail rows); wide screens use their
  width (Settings in two columns, route page = 420px pane + full-height map); an empty or idle
  state sits at thumb height, never alone in the middle of a blank screen.
- One primary action colour (forest green). The chosen route is plum. Everything else is
  neutral. Colour means something or it is not used.
- Type does the hierarchy: few sizes, strong weights, tabular numbers for ride data.
- Hairlines inside sheets; a single soft shadow only on things that float over the map.

## 3. Themes: exactly two

`data-theme="day" | "night"` on `<html>` (Auto picks by phone setting and sun; already
built in `src/ui/appearance`). No third palette: the old base `:root`, the
`prefers-color-scheme: dark` block and the "glass" layer collapse into these two.

**Night means the whole screen is dark, map included.** Never a light basemap under Night
chrome. Night basemap: Mapbox `navigation-night-v1` (night-contrast) when a Mapbox token
is configured, otherwise OpenFreeMap `dark` (`https://tiles.openfreemap.org/styles/dark`).
The translucent night scrim is only a last-resort fallback for a basemap with no dark style.

## 4. Tokens — one file, one name per job

All tokens live in `src/app/tokens.css`. Stylesheets use `var(--og-…)` only: no literal
colours, radii, shadows or font sizes outside tokens.css (map style code in TS is exempt
but must use the same values).

Colour (semantic names; values per theme):

| token | job | Day | Night |
|---|---|---|---|
| `--og-bg` | app background behind pages | `#f4f3ee` | `#0b100e` |
| `--og-surface` | sheets, cards, tab bar | `#fdfcf9` | `#131a17` |
| `--og-surface-2` | wells, inputs, selected rows | `#ebede8` | `#1d2724` |
| `--og-ink` | primary text | `#0f1a15` | `#ecf1ee` |
| `--og-ink-2` | secondary text (≥4.5:1 on surface) | `#46524c` | `#a2aea8` |
| `--og-line` | hairlines | `rgb(15 26 21 / 12%)` | `rgb(255 255 255 / 9%)` |
| `--og-line-strong` | input borders, dividers that must show | `rgb(15 26 21 / 24%)` | `rgb(255 255 255 / 16%)` |
| `--og-primary` | primary buttons, active tab, selected control | `#13703f` | `#1c7f49` |
| `--og-on-primary` | text on primary | `#ffffff` | `#ffffff` |
| `--og-primary-text` | green used as text/icon | `#0a5c31` | `#6fe3a3` |
| `--og-route` | the chosen route line + its row tint | `#7b4fa0` | `#b48ae0` |
| `--og-route-alt` | alternative routes | `#7d8a84` | `#7d8a84` |
| `--og-record` | recording dot, live track | `#d65a36` | `#f0805c` |
| `--og-danger` | errors, destructive | `#b3261e` | `#f0937f` |
| `--og-warn` | warnings | `#8a6200` | `#e5c07a` |

Existing token names (`--og-paper`, `--og-go`, `--og-ember`, …) become aliases of these
while code is migrated, then are deleted. Contrast: body text ≥ 4.5:1, ride numbers ≥ 7:1
in both themes, checked by test.

Type: Plus Jakarta Sans (body), Outfit (display titles, ride numbers). The five sizes of
small-screen-v2 §1 plus the ride scale of §5. Numbers use `font-variant-numeric: tabular-nums`.

Space: 4 · 8 · 12 · 16 · 24 · 32. Radius: `--og-radius-control` 12, `--og-radius-card` 16,
`--og-radius-sheet` 20, `--og-radius-pill` 999. Shadow: `--og-shadow-float` (map controls,
floating cards) and `--og-shadow-sheet`. Nothing else.

Breakpoints (only these): phone `< 761px`, tablet `761–1180px`, desktop `≥ 1181px`, plus
`(max-height: 500px)` for landscape phones.

## 5. Screens

Phone layout: small-screen-v2 §2–§6 (map ≥ 60 % while planning, ≥ 80 % riding; one sheet
with peek/half/full; ≤ 2 floating map controls; glass tab bar docked to the bottom edge,
hidden while riding and while a route is on the map).

Navigation (phones and tablets): the tab bar holds three places, **Map · Explore · My rides**.
Settings and the Day / Night switch live behind a named **Menu** button (AppMenu) in the
top bar of every page: beside the search on the map, at the end of the title row on Explore
and My rides. Desktop and landscape phones keep Settings in their top bar.

Home (nothing planned): no sheet slab. Loop (green), Record and Free Ride float as three glass
pills just above the tab bar; the map runs behind them.

Route preview: the chosen ride is a hero — its name as a plum eyebrow, the time large in
green, distance beside it, the measured reason under; other candidates are quiet rows under
it, one tap to switch. Start is a full-width green pill.

Desktop (≥ 1181px): left planning rail 400px, map fills the rest, the same sheet content
lives in the rail; tab destinations are a top bar. Tablet: phone layout with a wider sheet
(max 560px) anchored left in landscape.

Ride screen: maneuver card at top (primary green in both themes), map, one slim strip
(speed · distance left · arrival), one right-edge column of 56px controls. Night ride
screen is fully dark.

Status and errors: one line inside the sheet, never over the grab handle, never covering
the primary button.

## 6. Proof — "done" means the gallery says so

`npm run shots -- --devices iphone17promax,iphone17,desktop --map real --themes light,dark`
(scripts/og-shots) is the visual gate. A change is done when:
1. the gallery shows the change on every affected screen, both themes, no clipping/overlap,
   no light map under Night;
2. `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`, and the affected
   `test:e2e:critical` specs pass;
3. once the owner approves v3, screenshot baselines are recorded and any unapproved visual
   change fails the gate.

## Decision log

- 2026-10-25 Small-screen v2 rules; maps-for-riders interaction contract.
- 2026-10-26 This file. Direction "trail instrument". Two themes only; glass layer retired.
  Night = dark basemap. Single tokens.css. Visual gate = og-shots gallery.
- 2026-10-26 Night `--og-primary` #1f8a4f → #1c7f49: white on #1f8a4f is 4.37:1, under this
  file's own 4.5:1 text rule; #1c7f49 is 5.0:1 (tests/unit/ui/contrast-tokens.test.ts).
- 2026-10-26 Owner: glass for floating map chrome to give the map more of the screen.
  `--og-glass` (surface at 82% Day / 78% Night, blur 20–22px); solid when the browser has
  no backdrop blur or the rider asks for reduced transparency. Sheets and the ride screen
  stay solid.

- 2026-10-27 Owner: "better than Gaia GPS; tons of dead space, ugly, no glass theme, not space
  efficient". v4 = glass everywhere (§2), topo backdrop, floating tab bar and sheet, compact
  Explore rows, map-first route page, two-column Settings on wide screens. Supersedes v3's
  "solid sheets and cards" and small-screen-v2's docked tab bar.

- 2026-10-27 Owner: Google Maps layout — tab bar docked to the bottom edge, Plan sheet flush on
  it, From / To card while a route is on the map (#162, #163). Supersedes v4's floating tab bar.
- 2026-10-27 Owner (mobile UX handoff, PR #165, "full authority, make a sleek gorgeous routing
  app"): three-tab bar (Map · Explore · My rides), Settings + Day / Night behind a named Menu on
  every page, chromeless home with floating Loop / Record / Free Ride pills, route-preview hero,
  ride Menu sheet as one grouped list. The concept images were direction, not specs: their
  floating tab bar was not adopted (the owner's own docked choice stands) and no ride control
  was removed. "Ride this" keeps the catalog line across reloads until the rider edits it.

## Open proposals

(none)
