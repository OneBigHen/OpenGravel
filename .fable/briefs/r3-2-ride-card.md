# R3-2: Every ride is kept, and ends with a ride card

**Rider sentence:** "Every ride I take is kept, and ends with a card I want to show someone."
**Worker:** DeepSeek for the pure module and tests (MacBook via `fleet run mac` or docker-dev), Sonnet for the screen, Opus reviews. **Size:** M (estimate). **Lane:** ride, first.

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/next`. Read `AGENTS.md`, and `DESIGN.md` before any screen work.
House rules: on docker-dev run only `npm run typecheck`, `npm run lint` and the unit tests you touched; never `npm run build`, the full suite or the scorecard there (one heavy job at a time, 10 GB box). Never scan `/` or `~`. Frozen areas stay untouched: hiking, Spotify, cameras, Ask/Jev, wind, sun lighting, long trip, live follow. Unknown or unavailable is never shown as open, clear, legal, paved or safe. `npm run css:budget` must not rise. Report in plain English with the commands you ran and their results. Audit screenshots named below are in `.fable/shots/audit/`.

## What is wrong today (seen on production)
- Start a planned ride, ride, End ride, confirm. The card says "Ride finished" twice, shows a faint grey outline and no numbers. Tap My rides: "No saved rides yet" (or the Recorded tab says "No recorded rides yet."). Shots: `phone-dark-26b-after-ride.png`, `phone-dark-26c-myrides-after-ride.png`, `phone-dark-18-recorded.png`. Guided rides only record if the rider finds a switch in Menu (`startRecording`, `src/ui/stores/ride-focus-store.ts:1954`; toggle in `RideFocus.tsx:~1820`).
- After a free Record: "Saved 642 m to My rides." in a miles app, and "Recorded ride saved" twice (`phone-light-68-record-after.png`, `ride-focus-store.ts:2681`).

## Build
1. **Recording is on for every ride**, guided or free, from Start. The Menu switch stays as "Recording: on" for riders who want it off. One point per second at most. End ride keeps today's three choices; the first one saves.
2. **Pure module** `src/application/ride-metrics/ride-card.ts`: from a finished recording plus (when guided) the plan's surface runs, return miles, moving time, average moving speed, climb, dirt miles and share (only where the surface is known; unknown is reported as unknown miles, never as paved or gravel), start and end time, and a simplified line (at most 400 points). Reuse `ride-summary.ts` and `src/domain/recording/telemetry.ts`.
3. **Screen** `src/ui/ride/RideCard.tsx`, replacing the finish card (`RideFocus.tsx:~1454`): one solid card (no glass): the ride's line in plum on the app's own map picture or the existing sketch (`RideRouteSketch.tsx`) at full contrast, title (ride name or "Ride, Nov 11"), four numbers in Outfit (miles, moving time, dirt miles, climb), date. Buttons: **Done** (primary, goes to My rides, Ridden tab), **Share** (Web Share with a PNG drawn on a canvas in the browser, 1080x1350; falls back to "Save picture"), **GPX**. "Ride finished" appears once.
4. **My rides** (`src/ui/rides/RidesLibrary.tsx`): tabs renamed **Saved** and **Ridden**; `/rides?tab=ridden` opens Ridden; each ridden row opens the same ride card. All distances use the rider's unit.

## Files
`src/application/ride-metrics/ride-card.ts` (new), `src/ui/ride/RideCard.tsx` (new), `src/ui/ride/RideFocus.tsx` (finish card and the recording switch only), `src/ui/stores/ride-focus-store.ts` (start recording with the ride; the status line at 2681), `src/application/ride-session/recording-workflow.ts`, `src/ui/rides/RidesLibrary.tsx`, `src/ui/rides/rides.css`, `src/ui/ride/ride.css` (must not grow: delete the old finish-card rules).

## Pass/fail
- `npx vitest run tests/unit/ride-session tests/unit/application` with a new `ride-card.test.ts`: 5 recordings (guided with surface runs, free, paused in the middle, 30 s with no GPS, under 100 m): numbers match by hand; unknown surface is never counted as dirt or paved.
- `npm run ride-sim` still passes.
- New `tests/e2e/critical/ride-card.spec.ts` (440x956): plan, Start, feed 60 s of positions, End ride: the card shows miles greater than 0 and "Ride finished" exactly once; Done lands on `/rides?tab=ridden` with one row; opening it shows the card. No text matches `/\d+ m to My rides/`.
- `record.spec.ts`, `free-ride.spec.ts`, `ride-handlebar.spec.ts`, `library.spec.ts` pass (CI).
- Shots: the card, phone and desktop, both themes, plus the exported PNG attached to the PR.
