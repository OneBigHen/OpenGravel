# Lane B report: map colours and stray blocks (QA-05, QA-10, QA-15, QA-17 part)

Branch `fix/qa-map-colours`, worktree `/root/Vibe/wt/og-qa-b`. Nothing merged, nothing deployed.
Evidence gathered on a real browser (Windows PC), numbers only, no "it looks fine".

## QA-05: Day theme turned event labels into dark boxes with dark text

**Cause.** The place/event pill is a map *image* (its rounded paper) with the label text painted on
top. The pills are drawn once, from the theme's colours at the moment the map opens. Switching to Day
repainted the **text** from the Day palette (Ink `#161d1c`) but MapLibre keeps the image it already
holds under an id, so the pill kept the **Night** paper (`#131a17`). On a midnight floor that is ink
on night paper: **1.03:1**, invisible — the "black box with no text" in the screenshot.

Proven in a test that boots the host on Night tokens, switches to Day and reads the pixels the host
actually handed the map: before the fix the pill's fill stays `[19,26,23]` (night paper); after, it is
`[251,249,244]` (day paper), **16.27:1** against the Day ink.

**Fix.** `src/infrastructure/map/maplibre/host.ts`: the pill, rider-arrow and wind-band images are now
rebuilt from the palette whenever the look changes (`refreshThemeColours`), written onto the live map
(`updateImage`, or remove+add on a renderer without it), and the two place-label layers' paint
(text colour, opacities) is re-applied from the same palette. A style reset already re-added images;
it now re-adds the current theme's set.

Second, smaller find on the same path: a "quiet" venue pin painted its text at 72% opacity, which is
**2.83:1** on Day paper. It keeps its quiet colour (slate) and faded dot, but full-strength text:
**4.77:1**.

**Tests.**
- `tests/integration/maplibre-host.test.ts` → "redraws the place pills in the new theme's colours when
  Day and Night switch (QA-05)". Fails on `origin/main` (fill stays night paper), passes now.
- `tests/unit/infrastructure/maplibre/style-places.test.ts` → "place pill text contrast … (day/night)":
  every pill's painted text clears 4.5:1 against the fill it sits on, in both themes. Fails on
  `origin/main` for the quiet Day pin, passes now.

## QA-10: paved and unknown were the same grey, bar and legend disagreed

**Cause.** The surface strip painted "paved" with `--og-route-alt` (the *alternative route line's*
grey) and "unknown" as a 12%-ink hatch over the well — both read grey. The legend had rules for
paved, gravel and dirt but **none for unknown**, so its dot fell back to the same grey as paved. And
the surface line above the bar wore the amber "warn" dot for "some of this was not measured", which is
the gravel swatch's own colour: the words, the bar and the dot named three different things.

**Fix.**
- `src/app/tokens.css`: two job-named tokens, `--og-surface-paved` (solid green: `#2f6b50` Day /
  `#74c79b` Night) and `--og-surface-unknown` (neutral grey `#6f7a75` / `#8a958f`, always drawn as a
  diagonal hatch, never a solid).
- `src/ui/planner/route-results.css`: bar, elevation strip and legend dots all use that pair; the
  legend gains its missing unknown dot.
- `src/ui/planner/RideTruthLines.tsx` + the same stylesheet: a surface line whose only caveat is
  unmeasured road now shows the unknown hatch instead of the amber dot. An amber "warn" dot still
  means a real warning elsewhere.
- `DESIGN.md`: one decision-log line (needed because this changes an approved screen).

**Tests.**
- `tests/unit/ui/surface-colours.test.ts` (new, 8 cases): paved ≠ unknown, both read as graphics
  (≥3:1) on the strip's track, the bar and the legend name the same tokens, and unknown is a hatch in
  all four places. Fails on `origin/main` (tokens and rules absent), passes now.
- `tests/unit/ui/phone-plan-shell.test.tsx` → "marks an unmeasured surface as unknown, not as a
  gravel-toned warning (QA-10)". Fails on `origin/main` (`data-tone="warn"`), passes now.

## QA-15 / the white-block half of QA-17: the page does not paint it (headless compositor artefact)

**What it is not.** At 390x844 on production Explore the block is pure `#000000`, spans the map
panel, and none of its edges matches any element: the block is 21..368 x 644..742 CSS, the map panel
is 16..374 x 639..879. The element chain at the block's centre is only the map's own stack
(`canvas.maplibregl-canvas` → `.og-map__attempt` → `.og-map` → `.og-map-host` → `.og-explore-map`);
no element with an opaque background sits over the map, and the canvas's computed background is
`rgb(11,16,14)` (the map paper), not black. The WebGL clear colour is `[0,0,0,0]`.

**What it is.** Four captures of the same moment, same page:

| capture | pure black in the map panel |
| --- | --- |
| ordinary Playwright screenshot (the compositor's surface) | **34%** |
| CDP `Page.captureScreenshot` with `fromSurface:false` (the renderer's own frame) | **0%** |
| after the panel is scrolled into view | **0%** |
| two seconds later, untouched | **0%** |

So the map itself is drawn; the black is a stale region of the *compositor's* raster for the WebGL
layer, taken while the map sat partly below the fold. Nothing in the app draws white or black there,
which is why the CSS hunt and the earlier GPU probes found nothing. It reproduces in the same headless
Chromium the QA sweep used; a real phone repaints on scroll and I could not check one, so treat the
FINDINGS "(render?)" as: not app code.

**Test added (a guard, not a red→green fix).** `tests/e2e/critical/explore-browser.spec.ts` → "the
Explore map panel is the map and nothing opaque is painted over it (QA-15)". It fails if any
non-ancestor, visible, non-transparent element ever covers ≥30% of the map panel (the bug's shape),
and asserts the canvas covers the panel. It passes on `origin/main` and now, because the page is
already innocent. Had a wrapper, backdrop or glass fallback been the cause, it would fail — that is
the cause this test can catch. It cannot catch a compositor raster artefact, and I am not pretending
it does.

If we want the artefact gone from screenshots (it does not affect riders), the honest options are a
headless capture flag (`fromSurface:false`) in screenshot tooling, or waiting for a repaint after
scroll in the capture script — not a CSS or map change.

## Checks run

- `npx tsc --noEmit` clean.
- `npx vitest run` on the touched/new tests plus the neighbouring suites (surface strip, place
  styles, host integration, phone summary, contrast tokens, CSS budget, design tells): 190 tests, all
  pass.
- `npx eslint` clean on every touched file.
- `npm run css:budget` passes (overall 19877 lines, −146; two per-file limits needed trimming, and
  were trimmed rather than raised).
- Browser gate on the PC (`og-pc`, production build, `critical-chromium`): `explore-browser.spec.ts`
  3/3, `ride-menu-fit.spec.ts` 2/2, `settings.spec.ts` 4/4.

## Not done / honest limits

- QA-17's other half ("Average 249 mph" after a simulated jump) is not in this lane; untouched.
- QA-15's block was not reproduced on a physical phone. The screenshots that show it are headless
  Chromium.
- Visual screenshot baselines will move: the route summary's surface strip changes colour. This is
  intended; the commit that carries the report is tagged `[update-baselines]`.
