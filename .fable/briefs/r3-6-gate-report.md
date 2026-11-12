# R3-6: Gate closed, one tap

**Rider sentence:** "Gate closed: one tap, and I am not sent there again."
**Worker:** DeepSeek for the pure module and tests, Sonnet for the two screens, Opus reviews. **Size:** M (estimate). **Lane:** ride, after R3-2.

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/next`. Read `AGENTS.md`, and `DESIGN.md` before any screen work.
House rules: on docker-dev run only `npm run typecheck`, `npm run lint` and the unit tests you touched; never `npm run build`, the full suite or the scorecard there (one heavy job at a time, 10 GB box). Never scan `/` or `~`. Frozen areas stay untouched: hiking, Spotify, cameras, Ask/Jev, wind, sun lighting, long trip, live follow. Unknown or unavailable is never shown as open, clear, legal, paved or safe. `npm run css:budget` must not rise. Report in plain English with the commands you ran and their results. Audit screenshots named below are in `.fable/shots/audit/`.

## Idea
While riding, one button marks "I could not get through here". It is private to this device. The planner already routes around rider-drawn no-go areas (`avoidArea.create` in `src/domain/ride/commands.ts`, `src/application/planner/avoid-area-geometry.ts`, `src/ui/planner/hooks/usePlannerAvoidAreas.ts`, browser test `avoid-area.spec.ts`). A report is a small no-go area the app adds for the rider. No server change, no crowd, no moderation. This is PLAN milestone 12, second half, in its smallest honest form.

## Build
1. **Module** `src/application/roads/rider-reports.ts` (pure) and a small local store beside the garage storage: a report = id, point, heading, kind (`gate-closed` | `road-bad`), time, expiry (30 days). `reportsToAvoidAreas(reports, now)` returns one 60 m box per live report, shaped to pass `validateAvoidAreaRings`. Expired reports produce nothing.
2. **Ride screen:** one row at the top of Menu, and one 56 px button that appears on the right rail only when stopped or under 5 mph: **Road blocked**. Tap: a two-choice sheet with glove-size buttons, "Gate closed" and "Road too rough", plus Cancel; no typing. Then a toast "Marked. Your next routes avoid this spot." with Undo for 8 s. If a guided ride is running, offer "New route from here" (the existing reroute) with the spot avoided.
3. **Planner:** every plan includes live reports as no-go areas, merged with the rider's drawn ones. The third truth line counts them apart from official checks: "Checked 9:14 AM: 4 sources, no closures. Avoiding 1 spot you reported." A marker on the map at each report; tap: "You marked this gate closed on Nov 11", with **Remove**.
4. **Settings, Units and data:** "Spots you reported (2)" with a list and Remove all.

## Rules
- A report never becomes a fact about the road: it is not sent anywhere, never shown as "closed" to anyone, never overrides or hides an official closure, and never makes a road "open".
- If avoiding a spot makes a plan fail, plan without it and say "Could not avoid the spot you reported on Bear Meadows Rd".
- Do not touch `src/server/contributions/`.

## Files
New `src/application/roads/rider-reports.ts`, new storage file under `src/application/persistence/` (key listed in `local-data-keys.ts` so Export all data and Delete all data include it), `src/ui/ride/RideFocus.tsx` (Menu row, rail button, sheet), `src/ui/stores/ride-focus-store.ts`, `src/application/ride-session/guided-reroute.ts`, `src/ui/planner/hooks/usePlannerAvoidAreas.ts`, `src/application/planner/ride-truth.ts`, `RideTruthLines.tsx`, the map scene builder for the marker, `src/app/SettingsClient.tsx`.

## Pass/fail
- `npx vitest run tests/unit/application tests/unit/planner tests/unit/ride-session` with new `rider-reports.test.ts`: box is valid for the avoid-area validator; a report older than 30 days yields nothing; two reports 20 m apart merge; the truth line never says "closed" for a rider report.
- New `tests/e2e/critical/gate-report.spec.ts` (440x956, fixture router): start a ride, stop, Road blocked, Gate closed; end the ride; plan the same loop: the plan request body contains an avoid area around that point and the drawn line does not pass within 60 m of it; Remove in Settings and the next request has none.
- New live case in `tests/real-router/`: with a report on a road the fastest route uses, the planned route's distance to the point is over 60 m.
- `ride-handlebar.spec.ts` still passes: at speed the rail still has at most 3 buttons.
- `npm run ride-sim` passes. Shots: the sheet, the toast, the truth line, the marker; phone, both themes.
