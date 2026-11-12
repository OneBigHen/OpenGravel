# R3-3: Share in one tap, import in one tap

**Rider sentence:** "Sharing is one tap. Importing a GPX is one tap."
**Worker:** Sonnet, Opus reviews. **Size:** M (estimate). **Lane:** library. Start after R3-1 is merged.

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/next`. Read `AGENTS.md`, and `DESIGN.md` before any screen work.
House rules: on docker-dev run only `npm run typecheck`, `npm run lint` and the unit tests you touched; never `npm run build`, the full suite or the scorecard there (one heavy job at a time, 10 GB box). Never scan `/` or `~`. Frozen areas stay untouched: hiking, Spotify, cameras, Ask/Jev, wind, sun lighting, long trip, live follow. Unknown or unavailable is never shown as open, clear, legal, paved or safe. `npm run css:budget` must not rise. Report in plain English with the commands you ran and their results. Audit screenshots named below are in `.fable/shots/audit/`.

## What is wrong today (seen on production; these two files did not change on the branch)
- **Share** (`src/ui/sharing/ShareSheet.tsx`): opens on a form: "PRIVACY ON THE SHARED ROUTE", "Trim from both ends (meters)" with a raw number box, "WHO THE SHARED RIDE NAMES", and a red "A share needs a title to publish." before anything was typed. After creating the link it prints a JSON dump of coordinates (line ~325). Shots: `phone-light-10-share.png`, `phone-dark-10-share.png`, `desktop-light-10b-share-created.png`.
- **Import** (`src/ui/import/ImportPanel.tsx`): four screens of specification language: "Source segments and gaps stay separate. OpenGravel never draws a straight connector and calls it a road.", "Or open points as a breadcrumb", "IMPORT MEANING", "Follow keeps the imported geometry as the source of truth", "Preserved 1 GPX waypoint as metadata; they are not merged into the source track geometry", "choose Share with everyone on its saved card". Shots: `phone-light-19c-import-buttons.png`, `phone-light-19d-import-meaning.png`, `phone-light-19e-imported.png`.
- The shared page said "62.5 miles shared" for a 56 mi ride (`desktop-light-10c-share-page.png`). The page was rebuilt on the branch (N5); check the miles there against the planner and fix if still off.

## Build: Share
- Tapping Share opens one small solid sheet. Title is filled in from the ride's name. Start and finish hidden (today's default), coordinates rounded. One green button **Create link**; after that the link, **Copy**, the phone's own share sheet where available, and **Remove link**.
- One closed line "Privacy: start and finish hidden" opens the existing options. "Trim from both ends" is in the rider's unit (miles or feet), never metres. No fieldset legends in capitals, no JSON, no error until the rider has pressed the button with an empty title.
- The same sheet holds **Download GPX** and, on desktop, **Send to phone** (the branch's `SendToPhone.tsx`), so a ride has one Share button. Keep every privacy behaviour and its tests.

## Build: Import
- Pick a file with one track: it is saved to My rides under the file's own name and opened on the map, following its line (R3-1). One line of confirmation: "Added: Rothrock loop, 54 mi".
- More than one track: one list with checkboxes and one button "Add 3 rides". Nothing else.
- Everything else (breadcrumb mode, waypoint notes, group listing, the original file) moves behind one closed "More import options" line, in plain words.
- Remove the "Import from an older version" link from the bottom of My rides; put it inside "More import options".

## Files
`src/ui/sharing/ShareSheet.tsx`, `src/ui/sharing/SendToPhone.tsx` (mount point only), `src/ui/planner/RideActions.tsx` (one Share button), `src/ui/import/ImportPanel.tsx`, `src/ui/rides/RidesLibrary.tsx` (import entry and the older-version link), their CSS.

## Pass/fail
- `npx vitest run tests/unit/sharing tests/unit/import tests/unit/ui` passes.
- Updated `tests/e2e/critical/share.spec.ts`: open Share on a planned ride: no `role=alert` and no text "needs a title" before a click; the create button is enabled; after Create the page has no `{"version"` text and no "meters". `public-share.spec.ts` and `send-to-phone.spec.ts` pass.
- Updated `import-export.spec.ts`: a one-track GPX reaches a drawn line with Start enabled in at most 2 taps after choosing the file; the words "breadcrumb", "geometry", "metadata", "source of truth" are not visible unless "More import options" is open.
- Shots before/after: share sheet and import, phone and desktop, both themes.
