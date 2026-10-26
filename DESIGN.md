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

- Solid surfaces. No frosted-glass panels, no glow, no gradients on controls.
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
| `--og-primary` | primary buttons, active tab, selected control | `#13703f` | `#1f8a4f` |
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
with peek/half/full; ≤ 2 floating map controls; docked tab bar hidden while riding).

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

## Open proposals

(none)
