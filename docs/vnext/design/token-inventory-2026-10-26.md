# DESIGN TOKEN INVENTORY — og-mobile

**Scope:** `src/app/globals.css` (14,721 lines), `src/app/theme-glass.css` (3,069), 15 files under `src/ui/**/*.css` + `src/app/share/[token]/share.module.css` (2,830 lines combined) = **20,620 CSS lines / 17 files**. Inline colours audited across 132 `src/**/*.tsx` files.

**Method (exact, not estimated):** `grep -ohP … | sort | uniq -c | sort -rn`; usage counts are `grep -oF "var(--token)" | wc -l` (occurrences, not lines). Checksum: **3,460** `var(--…)` references = 2,320 globals + 457 theme-glass + 683 ui, which equals the raw `var(--` occurrence count exactly.

**Theme columns:** **L** = `globals.css :root` (light base, line 5); **D** = `globals.css @media (prefers-color-scheme: dark) :root` (13,710); **G** = `theme-glass.css :root` (line 3 — the app's default Trail-Glass palette, `color-scheme: dark`); **Day** = `theme-glass.css :root[data-theme="day"]` (line 89). "—" = not authored in that block (inherits the previous cascade).

---

## 1. CSS custom properties

120 distinct tokens: **105 defined**, **114 referenced**, **15 referenced-but-never-defined in CSS** (13 of those are injected at runtime by TS — see §1.12), **6 defined-but-never-referenced from CSS**.

### 1.1 Colour — surfaces & text

| token | L | D | G | Day | uses (G ls / glass / ui = total) |
|---|---|---|---|---|---|
| `--og-ink` | `#161d1c` | `#ece7dc` | `#ecf1ee` | `#07100c` | 147/40/50 = **237** |
| `--og-paper` | `#fbf9f4` | `#19211f` | `#131a17` | `#ffffff` | 216/22/36 = **274** |
| `--og-canvas` | `#f4f0e7` | `#111716` | `#0b100e` | `#f3f5f2` | 57/8/7 = **72** |
| `--og-deep-spruce` | `#243a35` | `#a9c7bb` | `#cfe3d8` | `#10291f` | 65/0/8 = **73** |
| `--og-sandstone` | `#d8c8b7` | `#36423e` | `#2b3632` | `#c9d1cc` | 112/1/3 = **116** |
| `--og-slate` | `#68716f` | `#8e9794` | `#86938d` | `#4a5550` | 14/4/1 = **19** |
| `--og-slate-text` | `#5f6766` | `#a9b1ae` | `#a2aea8` | `#3a4540` | 134/30/37 = **201** |
| `--og-moss-text` | `#5b6954` | `#adbca3` | `#a9b9a6` | `#3f5238` | 34/1/1 = **36** |
| `--og-trail-moss` | `#65745d` | `#8d9c84` | `#8d9c84` | `#4d5c46` | 1/0/0 = **1** |
| `--og-topo-sage` | `#9da98f` | `#6f7c66` | `#6f7c66` | `#7d8a74` | 14/2/3 = **19** |
| `--og-trail-brown` | `#776353` | `#c4b3a3` | `#bfb2a4` | `#5e4a3b` | 22/0/0 = **22** |
| `--og-on-fill` | `#fbf9f4` | — | `#ffffff` | `#ffffff` | 6/7/6 = **19** |
| `--og-raised` | *(not defined)* | — | `#1a2320` | `#ffffff` | 1/12/3 = **16** |
| `--og-raised-dark` | `#1c2825` | — | — | — | 2/0/0 = **2** |
| `--og-border-dark` | `#3b4945` | — | — | — | 4/0/0 = **4** |
| `--og-well` | `color-mix(sandstone 28%, canvas)` | — | `#1d2724` | `#e7ebe8` | 15/7/11 = **33** |
| `--og-hairline` | `color-mix(ink 10%)` | — | `rgb(255 255 255 / 8%)` | `rgb(7 16 12 / 16%)` | 26/14/32 = **72** |
| `--og-hairline-strong` | `color-mix(ink 16%)` | — | `rgb(255 255 255 / 14%)` | `rgb(7 16 12 / 28%)` | 14/16/9 = **39** |
| `--og-sheet-bg` | — | — | `#111815` | `#ffffff` | 0/4/1 = **5** |
| `--og-hover-mix` | — | — | `white` | `black` | 0/2/0 = **2** |

### 1.2 Colour — accents & semantic

| token | L | D | G | Day | uses |
|---|---|---|---|---|---|
| `--og-ember` | `#d65a36` | — | — | — | 48/3/4 = **55** |
| `--og-ember-strong` | `#bf4829` | — | — | — | 17/0/2 = **19** |
| `--og-ember-text` | `#af4226` | `#f39c7a` | `#f39c7a` | `#a33a1c` | 16/1/4 = **21** |
| `--og-golden-hour` | `#c99a46` | — | — | — | 40/2/1 = **43** |
| `--og-golden-text` | `#7d5c1c` | `#e5c07a` | `#e5c07a` | `#6d4f12` | 4/2/3 = **9** |
| `--og-signal-blue` | `#397c96` | `#5ea9c6` | `#5aa9e6` | `#1463a6` | 13/1/6 = **20** |
| `--og-signal-strong` | `#2a6175` | `#82c3da` | `#8cc4f0` | `#0d4f87` | 15/2/4 = **21** |
| `--og-danger` | `#a83e32` | `#f0937f` | `#f0937f` | `#b3261e` | 36/2/10 = **48** |
| `--og-danger-light` | `#d67262` | — | — | — | 8/0/0 = **8** |
| `--og-success` | `#3e6b55` | `#8fcaa9` | `#6fe3a3` | `#0a6630` | 11/0/0 = **11** |
| `--og-go` | — | — | `#1c854b` | `#138641` | 4/24/3 = **31** |
| `--og-go-strong` | — | — | `#176e3e` | `#0c6e34` | 0/7/0 = **7** |
| `--og-go-soft` | — | — | `color-mix(#3ddc84 18%)` | `color-mix(#138641 14%, white)` | 0/7/4 = **11** |
| `--og-go-text` | — | — | `#6fe3a3` | `#0a6630` | 0/12/3 = **15** |
| `--og-route-plum` | `#7b4fa0` | — | — | — | 3/0/2 = **5** |
| `--og-route-plum-strong` | `#5e3a7c` | — | — | — | 0/0/0 = **0** *(read by JS `style.ts:92`)* |
| `--og-consideration-tone` | `var(--og-slate)` → success/golden/ember (1,791–1,818) | — | — | — | 1/0/0 = **1** |
| `--og-route-tint` | `var(--og-slate)` (5,439; 8,897) | — | — | — | 10/0/0 = **10** |
| `--og-layer-color` | `var(--og-trail-moss / slate / golden-hour)` (10,337–10,551) | — | — | — | 3/0/0 = **3** |
| `--og-glance-tint` | `var(--og-ember)` (12,241) | — | — | — | 1/0/0 = **1** |

### 1.3 Glass, focus, motion

| token | L | D | G | Day | uses |
|---|---|---|---|---|---|
| `--og-glass-bg` | `color-mix(paper 70%)` | `color-mix(paper 74%, transparent)` | `rgb(16 22 20 / 66%)` | `rgb(255 255 255 / 92%)` | 7/5/0 = **12** |
| `--og-glass-dense` | — | — | `rgb(14 20 18 / 88%)` | `rgb(255 255 255 / 97%)` | 2/7/0 = **9** |
| `--og-glass-blur` | `blur(20px) saturate(170%)` | — | `blur(22px) saturate(160%)` | — | 16/14/0 = **30** |
| `--og-glass-edge` | `rgb(255 255 255 / 62%)` | `rgb(255 255 255 / 9%)` | `rgb(255 255 255 / 10%)` | `rgb(7 16 12 / 18%)` | 6/10/0 = **16** |
| `--og-glass-shadow` | 3 layers, ink-tinted | — | 3 layers, black | 2 layers | 5/10/0 = **15** |
| `--og-focus-ring` | `var(--og-signal-blue)` | — | `#8cc4f0` | `#1463a6` | 45/6/17 = **68** |
| `--og-focus-width` | `2px` | — | — | — | 46/5/15 = **66** |
| `--og-focus-offset` | `2px` | — | — | — | 39/0/11 = **50** |
| `--og-ease` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | — | — | — | 20/1/0 = **21** |
| `--og-dur-fast` | `140ms` | — | — | — | 15/1/3 = **19** |
| `--og-dur-base` | `220ms` | — | — | — | 3/0/0 = **3** |

*(65 `transition:` and 34 `animation:` declarations exist; only 21 and 22 reference the motion tokens respectively.)*

### 1.4 Shadows

| token | L | D | G | Day | uses |
|---|---|---|---|---|---|
| `--og-shadow-1` | `0 1px 1px rgb(22 29 28 / 4%), 0 2px 6px rgb(22 29 28 / 5%)` | black-based | black-based | `rgb(7 16 12)`-based | 10/2/5 = **17** |
| `--og-shadow-2` | `0 1px 2px … 6%, 0 8px 24px … 9%` | black-based | black-based | `rgb(7 16 12)` | 12/1/8 = **21** |
| `--og-shadow-3` | `0 2px 4px … 8%, 0 24px 56px … 18%` | black-based | black-based | `rgb(7 16 12)` | 3/0/0 = **3** |
| `--og-shadow-float` | `var(--og-shadow-2)` (9,558) | — | — | — | 2/0/0 = **2** |

### 1.5 Radius

| token | L | D | G | Day | uses |
|---|---|---|---|---|---|
| `--og-radius-chip` | `8px` | — | **`999px`** | — | 27/0/4 = **31** |
| `--og-radius-control` | `12px` | — | **`14px`** | — | 54/9/21 = **84** |
| `--og-radius-object` | `16px` | — | `16px` | — | 36/6/13 = **55** |
| `--og-radius-panel` | `20px` | — | `20px` | — | 19/2/1 = **22** |
| `--og-radius-sheet` | `24px` | — | `24px` | — | 6/1/2 = **9** |

### 1.6 Type

| token | L | G | uses |
|---|---|---|---|
| `--og-font-body` | `ui-sans-serif` *(real family injected by `next/font` → Plus Jakarta Sans, `layout.tsx:22`)* | — | 19/1/2 = **22** |
| `--og-font-display` | `ui-sans-serif` *(→ Outfit, `layout.tsx:28`)* | — | 16/1/2 = **19** |
| `--og-text-title` | `28px` | `28px` | 17/3/0 = **20** |
| `--og-text-headline` | `20px` | `20px` | 47/3/12 = **62** |
| `--og-text-body` | `16px` | `16px` | 70/24/38 = **132** |
| `--og-text-meta` | `14px` | `14px` | 176/31/47 = **254** |
| `--og-text-caption` | `12px` | `12px` | 119/24/10 = **153** |
| `--og-text-eyebrow` | `var(--og-text-caption)` | same | 6/0/2 = **8** |
| `--og-text-page` | `var(--og-text-title)` | same | 0/0/0 = **0** — *dead alias* |

The same five sizes are restated a third time at `globals.css:14293` for `.og-explore, .og-library`, and a fourth time in `theme-glass.css:45-49`.

### 1.7 Spacing, safe areas, layout geometry

| token | value | uses |
|---|---|---|
| `--og-space-1` | `4px` | 17/2/18 = **37** |
| `--og-space-2` | `8px` | 27/4/58 = **89** |
| `--og-space-3` | `12px` | 20/4/38 = **62** |
| `--og-space-4` | `16px` | 19/3/22 = **44** |
| `--og-space-5` | `24px` | 7/1/4 = **12** |
| `--og-space-6` | `32px` | 0/0/0 = **0** — *dead token* |
| `--og-card-pad` | `16px` (glass 1,837) | 1/1/0 = **2** |
| `--og-safe-top` | `env(safe-area-inset-top, 0px)` | 18/4/4 = **26** |
| `--og-safe-right` | `env(…)` | 20/4/2 = **26** |
| `--og-safe-bottom` | `env(…)` | 17/8/10 = **35** |
| `--og-safe-left` | `env(…)` | 18/7/2 = **27** |
| `--og-tabbar-h` | `calc(measured | pill-h + gap)` (8,769; glass 2,879) | 8/3/15 = **26** |
| `--og-tabbar-pill-h` | `60px` L / `58px` G | 2/0/0 = **2** |
| `--og-tabbar-gap` | `max(10px, safe-bottom − 12px)` / G `max(8px, … − 14px)` | 2/0/0 = **2** |
| `--og-float-gap / -rail / -inspector / -left / -right` | `16px / 384px / 368px / calc(…4px) / 12px` (9,712–9,722) | 8 / 2 / 2 / 4 / 2 |
| `--og-elevation-gutter` | `0px` → `60px` (8,908; 8,918) | 4/0/0 = **4** |
| `--og-elevation-pin-half` | `34px` | 2/0/0 = **2** |
| `--og-offer-dx` | `0px` (13,777) | 2/0/0 = **2** |
| `--og-tablet-card-w` | `min(400px, calc(100vw − 32px − …))` | 0/2/0 = **2** |

### 1.8 Map / ride-context tokens

| token | value | uses |
|---|---|---|
| `--og-ride-surface` | `var(--og-raised-dark)` | 23/2/4 = **29** |
| `--og-ride-border` | `var(--og-border-dark)` | 33/3/6 = **42** |
| `--og-ride-muted` | `var(--og-topo-sage)` | 43/4/12 = **59** |
| `--og-ride-glass` | `color-mix(ink 84%)` / Day `rgb(255 255 255 / 96%)` (glass 939) | 6/0/2 = **8** |
| `--og-ride-gap` | `8px` → `6px` in landscape (6,260; 6,990) | 21/0/4 = **25** |
| `--og-ride-strip-h` | `68px` | 2/0/0 = **2** |
| `--og-ride-strip-live-h` | `calc(strip-h + 20px)` | 8/0/3 = **11** |
| `--og-ride-text-maneuver` | `34px` | 2/0/0 = **2** |
| `--og-ride-text-readout` | `24px` | 3/1/0 = **4** |
| `--og-ride-col` | `0px` | 0/0/0 = **0** — *dead token* |
| `--og-map-route-casing` | `#ffffff` (glass 1,734) | 0/0/0 = **0** *(JS `style.ts:93`)* |
| `--og-map-emphasis` | `1.4` (glass 1,735) | 0/0/0 = **0** *(JS `style.ts:94`)* |

### 1.9 z-index

**No custom properties exist.** 73 declarations, 24 distinct values, all literal (see §2.5).

### 1.10 Contextual re-declaration blocks (same token, different scope)

| block | file:line | tokens re-authored |
|---|---|---|
| `.og-map` (light cartography pin) | `theme-glass.css:143` | 8 (`ink/paper/canvas/slate/topo-sage/signal-blue/trail-brown/deep-spruce`) |
| `html .og-ride` (ride chrome is always light-on-dark) | `theme-glass.css:345` | 17 |
| same pin, inside the dark media query | `globals.css:13737` | 17 — **byte-identical duplicate** |
| `:root[data-theme="day"] .og-ride` (inverted) | `theme-glass.css:932` | 11 + `background` |
| `.og-ride .og-map` | `theme-glass.css:1733` | 2 (`map-route-casing`, `map-emphasis`) |
| `.og-explore, .og-library` | `globals.css:14291` | 6 type sizes — **identical to `:root`, no-op** |
| `--og-choice-tint` | `phone-plan.css:100` | 1 |

### 1.11 Defined but never referenced from CSS (6)

`--og-space-6`, `--og-ride-col`, `--og-text-page` — genuinely dead. `--og-route-plum-strong`, `--og-map-route-casing`, `--og-map-emphasis` — consumed by MapLibre `style.ts` via `getComputedStyle`, so live but invisible to `grep var(--)`.

### 1.12 Referenced but never declared in CSS (15)

Injected at runtime by TS (13, verified): `--og-bearing` (`MapControls.tsx:70`, `RideFocus.tsx:1218`), `--og-look-x` / `--og-look-top` (`PlannerMap.tsx:707-709`), `--og-tabbar-measured-h` (`PrimaryNav.tsx:100`), `--og-ride-top-h` (`RideFocus.tsx:391`), `--og-sheet-drag-h` (`Sheet.tsx:47,73`), `--og-sheet-head-height` (`PlannerWorkspaceDock.tsx:156`), `--og-point-drag-y` (`PointRow.tsx:180`), `--og-scale-width` + `--og-map-inset-bottom/-left` (`MapControls.tsx:181-183`), `--og-offer-lifetime` (`RideOfferCard.tsx:40`), `--og-elevation-pin-share` (`ElevationProfileChart.tsx:391`).

**Broken — declared nowhere at all (CSS or TS):** `--og-radius-card` (3 uses, `globals.css:3218, 3289, 7676`) and `--og-section-pad` (3 uses, `globals.css:13227, 13230`). Both resolve to the invalid-value fallback; `border-radius` silently becomes `0`.

---

## 2. Hard-coded values that bypass tokens

Totals: **165 distinct colour literals / 347 occurrences** (107 hex, 58 rgb/rgba, **0 hsl**) + **1** tsx literal; **15 distinct literal font-sizes** (18 occurrences out of 648 `font-size:` declarations); **31 distinct literal radii** (245 of 443 shorthand declarations); **71 distinct literal shadows** (120 of 176); **24 distinct z-indexes** (73 occurrences).

### 2.1 Colours — top 15 (hex ∪ rgb, by occurrence)

| # | value | count | example |
|---|---|---|---|
| 1 | `#ffffff` | 21 | `theme-glass.css:24` |
| 2 | `#07100c` | 12 | `globals.css:6467` |
| 3 | `rgb(0 0 0 / 30%)` | 10 | `globals.css:6339` |
| 4 | `rgb(22 29 28 / 16%)` | 8 | `globals.css:108` |
| 5 | `#fbf9f4` | 6 | `globals.css:13` |
| 6 | `rgb(0 0 0 / 28%)` | 6 | `ui/ride/ride-rail.css:24` |
| 7 | `rgb(22 29 28 / 8%)` | 6 | `globals.css:63` |
| 8 | `rgb(22 29 28 / 18%)` | 5 | `globals.css:63` |
| 9 | `rgb(22 29 28 / 6%)` | 5 | `globals.css:62` |
| 10 | `rgb(7 16 12 / 18%)` | 5 | `theme-glass.css:126` |
| 11 | `rgb(7 16 12 / 20%)` | 5 | `theme-glass.css:133` |
| 12 | `#161d1c` | 4 | `globals.css:6` |
| 13 | `#243a35` | 4 | `globals.css:7` |
| 14 | `#397c96` | 4 | `globals.css:19` |
| 15 | `#3a4540` | 4 | `theme-glass.css:100` |

Also at 4: `#68716f`, `#776353`, `#9da98f`, `#b3261e`, `#d65a36`, `#f4f0e7`, `#fff`, `rgb(22 29 28 / 10%)`, `rgb(22 29 28 / 22%)`, `rgb(7 16 12 / 16%)`.

**Token coverage of the top 10:** 9 of 10 already have an identically-valued `--og-*` token (`#ffffff` → 8 tokens; `#07100c` → ink/paper; `#fbf9f4` → on-fill/paper; `#161d1c` → ink; `#243a35` → deep-spruce; `#397c96` → signal-blue; `#3a4540` → ride-muted/slate-text/topo-sage; `#68716f`, `#776353`, `#9da98f` → one each). The `rgb(22 29 28 / N%)` family is `--og-ink` at alpha, i.e. `color-mix(in srgb, var(--og-ink) N%, transparent)` material.

### 2.2 Colours — tsx inline

Exactly **1** colour literal in 132 tsx files: `#e5534b` at `ui/planner/RideActions.tsx:226` (`<circle fill="#e5534b">`, the record dot). Zero rgb/hsl literals; 12 `style={{…}}` blocks total, all token-driven. (For contrast, `src/**/*.ts` holds 76 hex occurrences / 50 distinct — map style constants.)

### 2.3 Font sizes — all 15 literal values

| value | count | example |
|---|---|---|
| `inherit` | 3 | `theme-glass.css:262` |
| `0` | 2 | `globals.css:5354` |
| `1.25em` | 1 | `globals.css:1440` |
| `clamp(17px, 2.4vh, 21px)` | 1 | `globals.css:14188` |
| `clamp(1.8rem, 5vw, 3rem)` | 1 | `share.module.css:3` |
| `clamp(22px, 1.4vw + 16px, 30px)` | 1 | `globals.css:12825` |
| `clamp(24px, 4vw, 34px)` | 1 | `globals.css:1090` |
| `clamp(24px, 6vh, 40px)` | 1 | `globals.css:14169` |
| `clamp(24px, 7vh, 34px)` | 1 | `globals.css:14272` |
| `clamp(26px, 5vw, 34px)` | 1 | `globals.css:13325` |
| `clamp(30px, 7vh, 52px)` | 1 | `globals.css:14214` |
| `clamp(30px, 8vw, 48px)` | 1 | `globals.css:14147` |
| `clamp(44px, 16vh, 84px)` | 1 | `globals.css:14268` |
| `clamp(72px, 22vh, 160px)` | 1 | `globals.css:14162` |
| `max(16px, var(--og-text-body))` | 1 | `ui/ride/ride-stop-search.css:25` |

630/648 `font-size:` declarations use `var()` — this is the best-tokenised axis in the codebase.

### 2.4 Border radii — top 15

| value | count | example |
|---|---|---|
| `999px` | 71 | `ui/ride/ride-music.css:52` |
| `50%` | 38 | `ui/ride/ride-rail.css:21` |
| `0` | 25 | `ui/rides/rides-library.css:168` |
| `14px` | 22 | `globals.css:911` |
| `12px` | 16 | `ui/planner/phone-plan.css:12` |
| `10px` | 12 | `ui/planner/phone-plan.css:161` |
| `8px` | 8 | `ui/ride/ride-music.css:29` |
| `16px` | 6 | `globals.css:8570` |
| `2px` | 6 | `ui/sheet/sheet.css:45` |
| `18px` | 4 | `globals.css:6846` |
| `22px` | 4 | `globals.css:6801` |
| `4px` | 4 | `globals.css:9054` |
| `6px` | 3 | `globals.css:3413` |
| `inherit` | 3 | `globals.css:1232` |
| `20px` (tie at 2: `20px 20px 0 0`, `24px`, `3px`, `7px`, `9px`) | 2 | `globals.css:6335`, `phone-plan.css:27`, `globals.css:11472` |

Pill literals: 71 `999px` + 38 `50%`, plus 72 multi-value shorthands whose leading component is `999px`. Zero corner longhands — all rounding is shorthand.

### 2.5 Box shadows — top 15

| value | count | example |
|---|---|---|
| `none` | 29 | `ui/sheet/sheet.css:15` |
| `0 6px 18px rgb(0 0 0 / 30%)` | 3 | `globals.css:6705` |
| `0 6px 20px rgb(7 16 12 / 18%), 0 1px 3px rgb(7 16 12 / 20%)` | 3 | `theme-glass.css:950` |
| `inset 0 0 0 1px var(--og-ember)` | 3 | `globals.css:4666` |
| `0 0 0 2px var(--og-paper)` | 2 | `globals.css:4961` |
| `0 -10px 14px -10px color-mix(in srgb, var(--og-ink) 22%, transparent)` | 2 | `globals.css:5910` |
| `0 10px 28px rgb(0 0 0 / 30%)` | 2 | `globals.css:6339` |
| `0 12px 32px rgb(22 29 28 / 24%)` | 2 | `globals.css:8631` |
| `0 1px 0 rgb(22 29 28 / 6%), 0 6px 18px rgb(22 29 28 / 6%)` | 2 | `globals.css:9732` |
| `0 1px 2px rgb(22 29 28 / 8%), 0 16px 40px rgb(22 29 28 / 16%)` | 2 | `globals.css:9791` |
| `0 1px 6px rgb(22 29 28 / 16%)` | 2 | `globals.css:9941` |
| `0 2px 10px rgb(22 29 28 / 18%)` | 2 | `globals.css:8499` |
| `0 4px 14px rgb(0 0 0 / 28%)` | 2 | `ui/ride/ride-rail.css:24` |
| `0 5px 18px rgb(0 0 0 / 24%)` | 2 | `globals.css:7910` |
| `0 6px 18px rgb(0 0 0 / 25%)` | 2 | `ui/ride/ride-music.css:21` |

56 shadow declarations do reference a `var()`; 5 of the 15 above are *partially* tokenised (a literal shadow wrapping `var(--og-ember/paper/ink)`).

### 2.6 z-index — all 24 distinct values

| value | count | example |
|---|---|---|
| `2` | 12 | `ui/planner/phone-plan.css:195` |
| `1` | 10 | `ui/planner/phone-plan.css:133` |
| `3` | 6 | `ui/follow/follow.module.css:38` |
| `8` | 5 | `ui/ride/ride-music.css:17` |
| `4` | 4 | `globals.css:5769` |
| `5` | 4 | `globals.css:819` |
| `9` | 4 | `globals.css:6792` |
| `10` | 3 | `ui/place/search-home.css:21` |
| `20` | 3 | `ui/place/search-home.css:34` |
| `6` | 3 | `globals.css:7881` |
| `100` | 2 | `ui/place/search-home.css:17` |
| `30` | 2 | `ui/rides/rides-library.css:231` |
| `60` | 2 | `globals.css:11389` |
| `7` | 2 | `globals.css:6680` |
| `70` | 2 | `globals.css:14117` |

Remaining singles: `0`, `-1`, `12`, `24`, `40`, `59`, `69`, `200`, `1200`. Thirteen source files each invent their own local stack — the only global anchor is `1200` (share-sheet backdrop, `globals.css:3323`).

---

## 3. Near-duplicates that should collapse

### 3.1 Colours (max channel delta ≤ 10 unless noted)

| cluster | values | Δ (max ch.) | recommendation |
|---|---|---|---|
| pure white, 2 notations | `#fff` (4) / `#ffffff` (21) | 0 | normalise notation |
| same colour, alpha-suffix notation | `#d65a36` / `#d65a3633` | 0 | express as `color-mix` |
| dark surface trio | `#19211f` / `#1a2320` (Δ1) / `#1d2023` | 1–3 | one paper/raised pair |
| sheet vs paper, glass | `#131a17` / `#111815` | 2 | fold `--og-sheet-bg` into `--og-paper` |
| warm off-whites | `#ece7dc` / `#ece6d9` / `#ebe4d6` | 1–6 | one "warm paper" |
| dark border greys | `#3a4540` / `#36423e` / `#3b4945` | 1–5 | one hairline-strong |
| trail browns | `#bfb2a4` / `#c4b3a3` | 5 | one token (D vs L value drift) |
| muted sage text | `#a9b1ae` / `#a2aea8` ; `#a9b9a6` / `#adbca3` | 7 / 4 | one slate-text, one moss-text |
| dark danger vs ember | `#f0937f` / `#f39c7a` | 9 | keep — different semantics |
| swirl of greens | `#13703d` / `#176e3e` (Δ4), `#0c6e34` / `#0f6e3a` (Δ6), `#138641` / `#16874a` (Δ9) | 4–9 | collapse to `--og-go` / `--og-go-strong` |
| slate greys | `#86938d` / `#8e9794` | 8 | one `--og-slate` |
| glass sandstone vs spruce | `#2b3632` / `#243a35` | 7 | distinct roles, ok |
| ink alpha ladder | 16 distinct `rgb(22 29 28 / N%)` for N ∈ {4,5,6,8,9,10,12,14,16,18,20,22,24,28,45,50} | — | replace with 3–4 `color-mix` steps |
| kingfisher alpha ladder | 13 distinct `rgb(7 16 12 / N%)` for N ∈ {8,12,14,16,18,20,22,28} + `#07100c` | — | same |
| neutral blacks | `rgb(0 0 0 / 12…60%)` — 11 steps | — | one shadow-alpha ramp |

### 3.2 Font sizes (within 1px)

- `clamp(24px, 4vw, 34px)`, `clamp(24px, 7vh, 34px)`, `clamp(26px, 5vw, 34px)` — three fluid declarations sharing a **34px** ceiling.
- `clamp(30px, 7vh, 52px)` vs `clamp(30px, 8vw, 48px)` — same 30px floor.
- `clamp(22px, 1.4vw + 16px, 30px)` overlaps both 30px declarations.
- Token scale itself is clean (12/14/16/20/28) — the duplication is entirely in fluid editorial sizes at 1,090 / 12,825 / 13,325 / 14,147–14,272.

### 3.3 Radii (within 2px)

| cluster | values (counts) | note |
|---|---|---|
| chip role is two shapes | `--og-radius-chip` = `8px` (L) vs `999px` (G) | same token, 991px apart |
| control role is two values | `12px` (L) vs `14px` (G) | 2px drift between themes |
| literal 10px (12) | vs token `12px` (16) | Δ2 — should be `--og-radius-control` |
| literal 18px (4) | vs token `16px` (6) | Δ2 — should be `--og-radius-object` |
| literal 22px (4) | vs token `20px` (2) / `24px` (2) | Δ2 either side — orphan value |
| literal 7px (2) / 9px (2) | vs token `8px` (8) | Δ1 — collapse to chip |
| literal 3px (2) | vs `2px` (6) / `4px` (4) | Δ1 |
| pills | `999px` (71) + `50%` (38) | two spellings for one role |

### 3.4 Shadows

- `0 6px 18px rgb(0 0 0 / 24% / 25% / 28% / 30%)` — 4 distinct strings, 9 occurrences.
- `0 1px 2px rgb(22 29 28 / 8%)` also appears inside shadow-1 and inside two composite literals.
- `0 6px 20px rgb(7 16 12 / 18%), 0 1px 3px rgb(7 16 12 / 20%)` is `--og-shadow-2` for Day, written literally at `theme-glass.css:950` **and** `954`.
- 29 `none` declarations are mostly reduced-motion / override resets, not real shadows.

### 3.5 z-index

Consecutive integers `1,2,3` (28 uses), `4,5,6` (11), `7,8,9,10` (13), plus paired `59/60` and `69/70` — five ad-hoc local ladders with no shared scale.

---

## 4. Breakpoints

**170 `@media` occurrences / 39 distinct conditions** (globals 102, theme-glass 34, ui 34). `@supports`: 2 (both "no backdrop-filter" fallbacks, `theme-glass.css:330`, `globals.css` glass block). `@container`: **0**.

| condition | count | where |
|---|---|---|
| `(prefers-reduced-motion: reduce)` | **35** | all files |
| `(max-width: 760px)` | **31** | 15 globals, 11 glass, 5 ui |
| `(max-width: 1180px) and (not ((orientation: landscape) and (max-height: 500px) and (min-width: 560px)))` | **21** | 10 globals, 5 glass, 6 ui |
| `(min-width: 761px)` | **10** | 6 globals, 3 glass, 1 ui |
| `(orientation: landscape) and (max-height: 500px)` | **8** | 7 globals, 1 ui |
| `(min-width: 1181px)` | **8** | 5 globals, 2 glass, 1 ui |
| `(orientation: landscape) and (max-height: 500px) and (min-width: 560px)` | **6** | 5 globals, 1 ui |
| `(prefers-reduced-transparency: reduce)` | **5** | 2 globals, 3 glass |
| `(min-width: 1100px)` | 3 | globals |
| `(min-width: 700px)` | 3 | 2 globals, 1 ui |
| `(max-width: 480px)` | 3 | 2 globals, 1 ui |
| `(max-width: 479px)` | 3 | 2 globals, 1 ui |
| `(max-width: 1180px)` | 2 | glass 540, search-home 20 |
| `(min-width: 1181px) and (min-height: 600px)` | 2 | globals 5,652 / 9,710 |
| `(max-width: 420px)` | 2 | globals 775, offline-maps 204 |
| `(max-width: 520px)` | 2 | follow 170, routing-method-comparison 234 |
| `(max-width: 760px) and (prefers-reduced-motion: reduce)` | 2 | phone-plan 210, explore-rides 401 |
| `(max-width: 760px) and (not (…short landscape…))` | 2 | glass 2,202 / 2,874 |
| `(min-width: 1181px), (orientation: landscape) and (max-height: 500px) and (min-width: 560px)` | 2 | globals 5,576 / 9,582 |
| `(min-width: 761px) and (max-width: 1180px)` | 1 | globals 885 |
| `(min-width: 761px) and (max-width: 920px)` | 1 | globals 8,354 |
| `(min-width: 761px) and (max-height: 480px)` | 1 | globals 8,372 |
| `(min-width: 1181px) and (max-width: 1180px)…` variant (glass 2,219) | 1 | `(min-width:761px) and (max-width:1180px) and (not …)` |
| `(max-width: 1600px)`-class wide tier `(min-width: 1600px) and (min-height: 600px)` | 1 | globals 5,678 |
| `(min-width: 900px)` | 1 | globals 8,112 |
| `(min-width: 480px)` | 1 | glass 2,129 |
| `(max-width: 560px)` | 1 | globals 3,302 |
| `(max-width: 360px)` | 1 | ride-stop-search 160 |
| `(max-width: 359px)` | 1 | globals 12,461 |
| `(max-width: 760px) and (max-height: 700px) and (orientation: portrait)` | 1 | globals 2,376 |
| `(max-width: 760px) and (pointer: coarse)` | 1 | globals 14,715 |
| `(pointer: coarse), (max-width: 760px)` | 1 | globals 5,105 |
| `(hover: none)` | 1 | globals 13,141 |
| `(prefers-color-scheme: dark)` | 1 | globals 13,709 |
| `(prefers-reduced-motion: no-preference)` | 1 | globals 11,271 |
| `(orientation: landscape) and (max-height: 500px) and (min-width: 760px)` | 1 | globals 12,426 |
| `(orientation: landscape) and (max-height: 500px) and (min-width: 560px) and (max-width: 759px)` | 1 | globals 12,439 |
| `(min-width: 1181px), (min-width: 761px) and (orientation: landscape) and (max-height: 500px)` | 1 | globals 4,572 |
| `(max-width: 1180px) and (max-height: 720px) and (not …)` | 1 | sheet.css 31 |

**Distinct width stops in use:** 359, 360, 420, 479, 480, 520, 560, 700, 760/761, 900, 920, 1100, 1180/1181, 1600 — 14 stops, of which **760/761 and 1180/1181** are the only two that matter (83 of 170 queries). Heights: 480, 500, 600, 700, 720. The `not ((orientation: landscape) and (max-height: 500px) and (min-width: 560px))` clause is repeated verbatim 21 times — a prime candidate for a named container.

---

## 5. Font families and weights

**Families — 26 `font-family:` declarations, 6 distinct values:**

| value | count | example |
|---|---|---|
| `var(--og-font-display), var(--og-font-body), ui-sans-serif, sans-serif` | 14 | `globals.css:154` |
| `var(--og-font-body), ui-sans-serif, system-ui, sans-serif` | 4 | `globals.css:132` |
| `var(--og-font-display), var(--og-font-body), sans-serif` | 4 | `globals.css:853` |
| `inherit` | 2 | `theme-glass.css:1,956` |
| `ui-monospace, SFMono-Regular, Menlo, monospace` | 1 | `globals.css:3,414` (share-sheet JSON preview) |
| `var(--og-font-display)` (no fallback chain) | 1 | `globals.css:13,324` |

Actual typefaces come from `next/font/google` (`layout.tsx:3`): **Plus Jakarta Sans** → `--og-font-body`, **Outfit** → `--og-font-display`. The `:root` value `ui-sans-serif` is only the pre-hydration fallback. The fallback chain is inconsistent: 3 different tails (`ui-sans-serif, system-ui, sans-serif` / `ui-sans-serif, sans-serif` / `sans-serif`), and `globals.css:13,324` has none at all.

**Weights — 308 declarations, 9 distinct values (no 300, no 900):**

| weight | count | share | example |
|---|---|---|---|
| 600 | **139** | 45% | `globals.css:155` |
| 700 | **74** | 24% | `globals.css:297` |
| 650 | **42** | 14% | `globals.css:633` |
| 500 | **21** | 7% | `globals.css:404` |
| 750 | **14** | 5% | `globals.css:6,858` |
| 800 | **10** | 3% | `globals.css:6,471` |
| 400 | 5 | 2% | `globals.css:11,072` |
| `inherit` | 2 | <1% | `globals.css:12,271` |
| 550 | 1 | <1% | `ui/planner/advisor-conversation.css:64` |

The intermediate weights (550/650/750) depend on the variable-font axes of Plus Jakarta/Outfit; 650 alone is used 42 times, effectively a second "semibold". `theme-glass.css` uses 49 of the 308 and introduces the same ladder independently.

---

## 6. globals.css structure

**331 top-level banner comments** (`^/*`) across 14,721 lines — one every ~44 lines. Largest 10 spans between consecutive banners:

| # | span | lines | description |
|---|---|---|---|
| 1 | **465** | 5,684–6,149 | Compact tier ≤760px: map fills the viewport, composer becomes a bottom sheet |
| 2 | **401** | 1,788–2,189 | Long-trip considerations (severity dot, tone variants) through to the map-control column |
| 3 | **342** | 3,313–3,655 | Share sheet: privacy preview, monospace payload, link lifecycle |
| 4 | **333** | 3,756–4,089 | File drop zone / import flow, visually-hidden keyboard focus |
| 5 | **300** | 8,457–8,757 | Places on the planner map (sample places provider, Places pill) |
| 6 | **294** | 8,163–8,457 | Ride advisor inline in the planner sheet |
| 7 | **267** | 7,877–8,144 | Ride-time places as map chrome: pins, interest filter, coming-up chip |
| 8 | **223** | 10,554–10,777 | Places time/kind filter chips under the layers row |
| 9 | **210** | 1,102–1,312 | Provenance mechanics behind a disclosure (source/one-line truth) |
| 10 | **177** | 3,136–3,313 | Arrive-by: six choices in two rows of three (NV-09) |

Next tier: 7,138–7,299 (161), 6,986–7,138 (152), 13,550–13,701 (151), 14,365–14,509 (144), 5,191–5,334 (143).

### Dead / superseded / contradictory sections

The stylesheet carries almost no self-flagging: **7 comment lines total** match `legacy|deprecat|supersed|no longer|replaced|override|TODO|FIXME|hack|older|revised`, of which only 5 are substantive and **exactly one is a TODO** (`ui/planner/phone-plan.css:17`, "remove these phone hides when the parallel Layers work supplies…"). The rot is structural, not annotated:

1. **`globals.css:13,701-13,773` — the `og-dark:start … og-dark:end` block is superseded.** `theme-glass.css` is imported after `globals.css` (`layout.tsx:4,9`) and its `:root` sets the same tokens at the same specificity, so for every token both define, theme-glass wins. They disagree: ink `#ece7dc` vs `#ecf1ee`, paper `#19211f` vs `#131a17`, canvas `#111716` vs `#0b100e`, shadow-1/2/3 identical-or-near. Net effect: the visible "dark" theme is theme-glass's, and globals' dark palette only survives where theme-glass is silent.
2. **`globals.css:13,737-13,755` and `theme-glass.css:345-364` are the same 17-token block**, verbatim. theme-glass's own comment admits it ("the same pin the old og-dark block applied").
3. **`globals.css:14,291-14,299` `.og-explore, .og-library` re-declares the 6 type tokens with the same values as `:root`** — a no-op except for `--og-text-page: 28px`, which is itself a token with zero usages.
4. **`globals.css:6,273` `--og-ride-col: 0px` and line 91 `--og-space-6: 32px`** are defined and never read.
5. **`globals.css:3,218 / 3,289 / 7,676` use `var(--og-radius-card)`, declared nowhere**; **`globals.css:13,227-13,230` uses `var(--og-section-pad)`, declared nowhere** — silent `0` fallbacks.
6. **Triple/quadruple definition of the type scale:** `globals.css:74-82`, `theme-glass.css:45-51`, `globals.css:14293-14298`, plus `globals.css:14287` prose explaining that the v2 scale differs from the "compact chrome scale".
7. **Reduced-transparency handled 5 times** (`globals.css:12,000`, `theme-glass.css:323, 2,351, 2,475`) with overlapping `:root` assignments.
8. **Short-landscape condition re-implemented 6 ways** (2,366 / 6,154 / 7,002 / 8,122 / 9,300 / 12,426) instead of one container query, and the 21-fold `not(…)` exclusion in §4 is the mechanical consequence.
9. **`globals.css` still carries two complete dark palettes' worth of one-off hexes** (43 of the 107 distinct hexes appear exactly once) — most are theme-palette values written directly at `globals.css:13,712-13,754` rather than referencing the token they duplicate.
10. **`theme-glass.css:895-921` + `926-1000`**: the Day ride variant pins 11 tokens, then eight separate `:root[data-theme="day"] .og-ride…` rules immediately override colours the tokens just set (`#26302c` ×3, `#000000`), so the token pin and the following rules fight over the same properties.

**Biggest wins, in order:** (a) delete the `og-dark` block and the duplicated `.og-ride` pin; (b) delete `--og-text-page`, `--og-space-6`, `--og-ride-col`, and *define or remove* `--og-radius-card` / `--og-section-pad`; (c) unify the 165 literal colours onto the 4 alpha ladders (`ink`/`kingfisher`/`black`/`white`) via `color-mix`; (d) collapse 14 breakpoint stops to 3 (760, 1180, short-landscape) and the 31 `max-width:760px` blocks into one; (e) add a `--og-z-*` scale — the only axis with **zero** tokens.
