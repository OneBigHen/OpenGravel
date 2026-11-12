# R3-1: Saved means exact

**Rider sentence:** "The ride I saved, imported or picked opens as exactly that line."
**Worker:** Opus. **Size:** M (estimate). **Lane:** planner, first. Blocks R3-3 and R3-7.

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/next`. Read `AGENTS.md`, and `DESIGN.md` before any screen work.
House rules: on docker-dev run only `npm run typecheck`, `npm run lint` and the unit tests you touched; never `npm run build`, the full suite or the scorecard there (one heavy job at a time, 10 GB box). Never scan `/` or `~`. Frozen areas stay untouched: hiking, Spotify, cameras, Ask/Jev, wind, sun lighting, long trip, live follow. Unknown or unavailable is never shown as open, clear, legal, paved or safe. `npm run css:budget` must not rise. Report in plain English with the commands you ran and their results. Audit screenshots named below are in `.fable/shots/audit/`.

## What is wrong today (seen on production 40115cb6, same code on the branch)
1. Plan a 2 h loop at Rothrock, save it, open it from My rides. Saved card: "53 mi, 2 h 12 min" (44% gravel when saved). Reopened: "55 mi, 1 h 55 min, 16% gravel, 3 mi unknown", status "Restored your draft". Three of three tries gave a different ride. Shots: `phone-light-16b-myrides.png`, `phone-light-22e-reopened-saved-31s.png`, `phone-dark-22b-opened-saved-ride.png`.
   Cause: `LibraryService.openRide` (`src/application/library/library-service.ts:621`) makes a working copy from the saved request, and the planner then plans it again. The stored line (`plannedRoute` in `src/application/persistence/ride-repository.ts:110`) is used only for export.
2. Import a GPX loop (your own exported loop will do), tap "Open in planner": "Planning failed. The routing service is unavailable right now", start and destination both "South Water Street, Ferguson, PA". Two of two tries. Shot: `phone-light-22c-import-open-in-planner.png`. The import stores the line (`src/application/import/import-service.ts:576`), then `RidesLibrary.tsx:767` opens it as an A-to-B request whose two ends are the same point.

## Build
- Opening a ride that has a stored line shows that line with its saved numbers and never calls the router. Start, Share, GPX and the three truth lines work from it. Reuse the path that already follows a fixed line: curated "Ride this" (`src/application/explore/ride-this.ts`, `src/ui/planner/hooks/useOpenCuratedRide.ts`). Do not invent a second mechanism.
- One secondary button "Plan it again" replans from the saved request (today's behaviour) and says once what changed.
- A saved ride with no stored line replans once and says "Planned again: the saved line was not stored."
- An imported track always opens as its own line. A loop track (ends within 150 m) is titled "Loop from <place>", never "To <same place>".
- Save must store the line the rider is looking at (the chosen card), with distance, time and surface runs, so the truth lines survive a reopen.
- Do not change `ImportPanel.tsx` or `ShareSheet.tsx` (R3-3 owns them).

## Files
`src/application/library/library-service.ts`, `src/application/persistence/ride-repository.ts`, `src/infrastructure/storage/ride-repository.ts`, `src/application/import/import-service.ts`, `src/ui/rides/RidesLibrary.tsx` (open handlers only), `src/ui/planner/hooks/useOpenCuratedRide.ts`, `src/application/planner/auto-plan.ts`, `src/ui/planner/hooks/usePlannerAutoPlan.ts`, `src/ui/planner/RideActions.tsx` (what Save stores).

## Pass/fail
- `npx vitest run tests/unit/application tests/unit/import tests/unit/planner` passes, with new cases: open a saved ride with a line gives the same coordinates and makes zero router calls; open without a line replans once; an imported loop opens as a loop.
- New `tests/e2e/critical/saved-ride-roundtrip.spec.ts` (440x956): plan a loop, save, reload, open from My rides: miles and minutes equal the saved card, the route-plan endpoint is not called, Start is enabled. Import `tests/fixtures` loop GPX, open: no "Planning failed", Start enabled.
- Existing `library.spec.ts`, `import-export.spec.ts`, `gpx-sharing.spec.ts`, `explore.spec.ts` still pass (CI).
- Shots before/after of the reopened ride, phone, both themes.
