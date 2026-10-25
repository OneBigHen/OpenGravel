# Small-screen design system v2 (2026-10-25)

The app is used on an iPhone mounted on motorcycle bars, often gloved, in sun or rain.
Design for **375 × 667 first** (iPhone SE / mini), check **320 × 640**, then let larger
screens breathe. Every rule below is a hard rule for phone widths (< 761 px) unless it says
otherwise. Desktop (≥ 1181 px) keeps its current rails but adopts the same type and spacing scale.

Reference screenshots of the problems: Plan has 9 floating map controls (Edit, Places pill +
filter, map style, layers, zoom +, zoom −, locate, fullscreen) scattered over the top third;
a floating summary pill duplicates the route card; sheet + floating tab bar leave the map < 50 %
of the screen; Explore cards clip their badges at 320 px; layer tiles truncate their subtitles;
the stylesheet uses 27 font sizes.

## 1. Tokens (add to `:root` in `src/app/globals.css`, then use them; never add a new raw size)

Type — five sizes only, line-height in brackets:

| token | size | use |
| --- | --- | --- |
| `--og-text-title` | 28px (1.15), weight 700 | page titles (Explore, My rides, Settings) |
| `--og-text-headline` | 20px (1.25), weight 700 | sheet headline, the ride's time · distance, maneuver street |
| `--og-text-body` | 16px (1.4), weight 500 | rows, buttons, inputs (inputs MUST be ≥ 16px: iOS zooms otherwise) |
| `--og-text-meta` | 14px (1.35), weight 500 | secondary line under a row |
| `--og-text-caption` | 12px (1.3), weight 600 | rare: credits, axis labels. Never for anything a rider must read while riding |

Nothing below 12px. Ride screen numbers are their own scale (see §5).

Spacing — 4 · 8 · 12 · 16 · 24 · 32 (`--og-space-1…6`). Screen gutter 16px. Gap between
sections 24px. Inside a card 12–16px.

Touch — every tappable thing ≥ 48 × 48 px hit area (ride screen ≥ 56), ≥ 8px apart.

Shape — buttons/inputs radius 12, cards 16, sheet top 20, chips/pills fully round. One
shadow for floating map controls (`--og-shadow-2`), none on in-sheet content (use a hairline).

Colour — keep the existing palette variables; one primary action colour (the green), one
accent for the chosen route (plum). Status colours only for real warnings.

## 2. App shell (phone)

- **Tab bar**: docked to the bottom edge, full width, solid paper background with a top
  hairline, 56px + safe-area inset, icons 24px + 12px labels. Not a floating glass pill.
  Hidden while riding.
- Pages scroll under a plain top area; titles left-aligned at `--og-text-title`, 16px gutter.
- No horizontal page scroll at 320px, ever. Chip rows may scroll horizontally *inside* their
  row, with the last chip partly visible as the affordance.

## 3. Plan screen (phone)

Goal: the map gets ≥ 60 % of the screen in every state; one obvious next action.

Map chrome — **at most two floating controls**, both in one right-edge column, 16px from the
edge, below the safe area:
1. Layers (opens the layer sheet; the sheet also holds map style — satellite/terrain — and
   the Places / Gas-and-food overlay that the "Places" pill controls today).
2. Locate me.
Zoom buttons are not shown on touch phones (pinch); keep them on desktop. Fullscreen: drop on
phone. "Edit": becomes an action inside the sheet once a ride exists ("Edit route"), not a map
button. The compass appears only when the map is rotated.

Bottom sheet — three detents: **peek** (≈ 30 % height), **half**, **full**. Drag handle is a
48px-tall hit area. The sheet must actually drag (currently it does not move on a drag).
- *No ride yet* (peek): "Where to?" search field (16px text, 48px tall) and one row of
  three equal secondary actions (Loop · Record · Free Ride). Nothing else.
- *Ride planned* (peek): one summary block — `53 min · 33 mi` at headline size, one meta
  line (`Curvy 3 mi · 3% gravel · ↗ 2,850 ft`), the full-width primary **Start ride**
  button (52px), and a single line of weather if it matters. "Compare rides (3)" is a quiet
  text button that switches the block into a vertical list of the options — one 64px row
  each, with the colour of that option's line on the map, its role, `53 min · 33 mi`, one
  character word it earns (Twistiest · Quickest · Most dirt) and what it costs against the
  quickest (`+3 min`); the chosen row carries a tick and a tint, and tapping a row selects
  it and highlights its line. Nothing scrolls sideways, nothing is covered by the next
  option. **Remove the floating summary pill over the map** when the sheet shows this block.
- *Half/full*: directly under the summary (and under the options list while comparing), one
  row of one-tap ride style — Roads `Fast · Balanced · Curvy · Backroads` and Surface
  `Paved · Mixed · Dirt OK` — editing the same ride style as the full controls and re-planning
  with it. Then stops, ride style, along this ride, briefing — as plain grouped rows, not
  cards inside cards.
- Route labels on the map ("Best Ride · 53 min") stay small (14px) and never cover the line's
  start/finish markers.

## 4. Lists (Explore, My rides) — phone

Ride card, phone (< 480px): **vertical**: full-width map image (16:9, radius 16), then the
title (`--og-text-body`, 600, max 2 lines), then **one** meta line in `--og-text-meta`:
`70 mi · 8 mi away · 4 mi of curves · 5 mi gravel`. No pill badges that can clip; no "Est.";
the source/community credit is one caption line or lives on the detail page. ≥ 480px may use
the horizontal card.

Explore top: title + Ride/Things switch on one line; search + Filters on the next; one chip
row. Then rides.

## 5. Ride screen

Keep the direction from "Ride mode minimal": map ≥ 80 %, one maneuver card, one slim strip.
Numbers: maneuver distance 34px/700, street 20px, strip numbers 24px tabular with 12px unit
labels; never truncated. Floating controls in one right column, 56px.

## 6. Sheets & panels (Layers, filters, settings rows)

Rows, not tiles, on phones: 56px rows with a 24px icon, a title in body size and an optional
one-line meta that **wraps** rather than truncating. Two-column tile grids only ≥ 480px.

## 7. Copy

Labels explain themselves; at most one short hint line where something is genuinely
non-obvious. No status badges (Ready, Fresh, Active, Unknown, Est.), no provenance sentences,
no developer words.

## 8. Done means

Screenshot at 320 × 640, 375 × 667 and 390 × 844 in Day and Night; nothing clipped,
overlapping or under 12px; every tap target ≥ 48px; `prefers-reduced-motion` respected.
