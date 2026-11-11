# Brief W3: the honest surface line on route preview

This codebase is yours. Worktree `/root/Vibe/wt/og-look`, branch `design/look-lock`. Don't push or deploy.

## Goal
On the phone route preview (the ride summary under the map), a rider sees at a glance how much of the ride is gravel/dirt and how much is unknown, plus a full-width surface bar. Example: `62 mi · 41% gravel · 3 mi unknown`. No competitor shows this. Core rule: unknown is never shown as paved or as zero.

## Read first
- `.fable/DESIGN-PICKS.md` section 5 (W3 row and its pass/fail).
- `src/ui/planner/PhoneRideSummary.tsx` (the phone summary; `meta` line ~line 81).
- `src/ui/planner/RouteDecisionCard.tsx` lines ~120-180: the desktop card already draws a surface strip (`og-route-card__strip`, `data-surface` paved/gravel/dirt/unknown) from `card.surfaceStrip` (shares that add to 1). Reuse its markup/CSS; don't duplicate colours.
- `src/ui/planner/MapRideGlance.tsx` `rideGlanceSurface` (current surface label rules).
- `src/application/planner/planner-view-model.ts` around 201 and 742 (`surfaceStrip`, distance).
- `DESIGN.md` (tokens; green only on the primary action).

## Do
1. A pure function (new file `src/application/planner/surface-facts.ts`) that takes total distance in metres and the strip shares and returns `{ unpavedShare, unknownMiles, line }` where line is e.g. `41% gravel · 3 mi unknown`. Rules: gravel % = gravel+dirt share, rounded; unknown miles rounded to whole miles, but if unknown share > 0 and rounds to 0 show `<1 mi unknown`; if no strip, line is `surface unknown`; if all paved, line is `all paved`; omit the unknown part only when unknown share is exactly 0.
2. In `PhoneRideSummary`, under the time/facts row (not in comparing mode), show that line (replace the existing surface part of `meta` so it is not said twice) and the strip bar full width, `data-testid="phone-surface-strip"` with an aria-label giving all four shares. Show the bar whenever a strip exists (even one surface). Unknown segment must look different from paved (hatched or dotted pattern via CSS using existing tokens).
3. CSS in the existing plan-sheet / route-results CSS file that owns the strip; keep `npm run css:budget` passing (shrink something nearby or adjust only the file you grew in `scripts/qa/css-budget.json`, net total lines must not rise by more than ~25).
4. Unit tests: `tests/unit/planner/surface-facts.test.ts` (shares add up; unknown never reports 0 when share > 0; no strip → "surface unknown"), and a render test for the phone summary showing the line and bar if there is an existing test file for PhoneRideSummary (`rg -l PhoneRideSummary tests`).

## Pass / fail
- `npx vitest run tests/unit/planner tests/unit/ui` passes; `npx tsc --noEmit -p .` clean for touched files; `npm run lint` clean; `npm run css:budget` ok.
- Commit on `design/look-lock`: "Route preview: say how much is gravel and how much is unknown".
- Fail: touching routing, map style or anything outside the files above.

End with a 5-line plain summary and test results.
