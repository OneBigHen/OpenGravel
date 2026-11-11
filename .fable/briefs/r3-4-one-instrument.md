# R3-4: One instrument

**Rider sentence:** "Every route looks the same, saves with one tap, and Start goes straight to the ride."
**Worker:** Opus. **Size:** M to L (estimate). **Lane:** planner, after R3-1. Split into two PRs if it grows: (a) summary, Save, weather; (b) theme, Start, desktop default.

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/next`. Read `AGENTS.md`, and `DESIGN.md` before any screen work.
House rules: on docker-dev run only `npm run typecheck`, `npm run lint` and the unit tests you touched; never `npm run build`, the full suite or the scorecard there (one heavy job at a time, 10 GB box). Never scan `/` or `~`. Frozen areas stay untouched: hiking, Spotify, cameras, Ask/Jev, wind, sun lighting, long trip, live follow. Unknown or unavailable is never shown as open, clear, legal, paved or safe. `npm run css:budget` must not rise. Report in plain English with the commands you ran and their results. Audit screenshots named below are in `.fable/shots/audit/`.

## What is wrong today
1. **Three route summaries.** Loop: title, big time, Start / Add stops / Save (`phone-light-04b-loop-result.png`). Destination: "BEST RIDE" eyebrow, an Options row, a wide "Start ride" (`phone-light-37a-destination-first.png`). Curated "Ride this": a loop titled "To Sand Mountain Trailhead" with no surface line (`phone-dark-42-ride-this.png`). Files: `src/ui/planner/PhoneRideSummary.tsx`, `TripCard.tsx`, `RouteDecisionCard.tsx`, `hooks/useOpenCuratedRide.ts`.
2. **Save is two controls.** A Save button by Start and, far down the sheet, "Name this ride to save it"; then "Named ride saved. Your active draft remains available." (`phone-light-12b-saved.png`; `RideActions.tsx:296,356`).
3. **Weather along the route fails on long loops.** `/api/weather/route` returns 400 because the line is capped at 2,048 points (`src/server/weather/route-weather.ts:51`) and `src/ui/weather/useRouteWeather.ts` sends every point. The rider reads "Weather along the route is unavailable right now."
4. **Auto theme means two things.** App: system setting (`src/ui/appearance/appearance.ts:59`). Ride: the sun (`RideFocus.tsx:463`). A dark planner hands over to a white ride screen at midday (`phone-dark-22b-opened-saved-ride.png` then `phone-dark-23g-ride-50mph.png`).
5. **Start shows a title page.** "Ride Focus / Opening your ride… / Back to the planner", then "Loading map…" (`phone-light-23e-start-1s.png`, `phone-light-23f-start-4s.png`; `RideFocus.tsx:173,788`).
6. **Desktop opens on "To a destination"** with a disabled button, while the phone's main action is Loop (`desktop-light-01b-home-12s.png`).
7. Compare shows two cards both named "Alternative", and "Back to ride" is clipped (`phone-light-07-compare.png`, `phone-light-08-after-compare-esc.png`).

## Build
- **One summary component** for loop, destination, curated, saved and imported rides, phone and the chosen desktop card: title, time and miles, the three truth lines (`RideTruthLines.tsx`), then Start (primary), Save, Share. A curated or imported loop is titled by its name, never "To <place>". When there is no surface data the first line says so; it is never absent and never guessed.
- **Save in one tap:** saves under an automatic name (place and shape, for example "Rothrock loop, 53 mi"); the button turns into "Saved" and the title becomes editable in place. Delete the name box, the second Save and every "draft" sentence.
- **Weather:** thin the line on the client to at most 512 points before posting (keep ends; the server takes 8 samples anyway).
- **Auto follows the sun at the rider's place across the whole app** (day from sunrise to sunset, using the calculation the ride already has; before a position is known, fall back to the system setting). Day and Night choices are unchanged.
- **Start:** remove the words "Ride Focus" from every rider-visible string. The ride route paints its chrome (maneuver card, metric strip) and the route outline in the first frame; the map fills in behind. No "Back to the planner" page unless loading failed.
- **Desktop opens on Loop** with "Make my loop" live.
- **Compare:** name cards by what they are ("Most dirt", "Twistiest", "Fastest", else "Option 2"); fix the clipped link.

## Files
`src/ui/planner/PhoneRideSummary.tsx`, `TripCard.tsx`, `RouteDecisionCard.tsx`, `PlannerResultPanel.tsx`, `RideActions.tsx`, `planner-view-model.ts`, `plan-sheet.css`, `route-results.css`, `hooks/useOpenCuratedRide.ts`, `IntentComposer.tsx`, `src/application/planner/auto-plan.ts`, `src/ui/weather/useRouteWeather.ts`, `src/ui/appearance/appearance.ts`, `use-appearance.ts`, `src/ui/ride/RideFocus.tsx` (lines 173, 463, 788 only), `src/app/RideClient.tsx`.

## Pass/fail
- `npx vitest run tests/unit/planner tests/unit/ui tests/unit/application`, with new cases: weather request never exceeds 512 points; Auto resolves to night at 9 PM and day at 1 PM for 40.72, -77.89 whatever the system setting.
- Browser tests (CI): `first-route.spec.ts`, `front-door.spec.ts`, `desktop-rail.spec.ts`, `weather.spec.ts`, `library.spec.ts`, `ride-handlebar.spec.ts` pass. New assertions: the same `data-testid="route-summary"` exists after a loop, a destination plan and a curated "Ride this"; one tap on Save creates a My rides row; the string "Ride Focus" and the word "draft" are not visible anywhere in the plan, save and start flow; a 60 mi loop shows a weather strip.
- Shots `loop-planned`, `route-choices`, `active-ride`, `plan-idle` desktop, both themes, with a DESIGN.md log line per taste call (plan section 3, calls 3, 4, 7, 8, 9).
