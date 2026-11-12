# N5: send to phone

This codebase is yours. Repo OneBigHen/OpenGravel.

## Goal (rider sentence)
"Plan on the laptop, click Send to phone, scan, tap Start." No account.

## Today
Sharing publishes an opaque link (`src/application/sharing/share-commands.ts`, `src/ui/sharing/ShareSheet.tsx`). The page it opens (`src/app/share/[token]/page.tsx`) is an unstyled outline with a raw JSON block and no way to ride the route. There is no QR code anywhere.

## Do
1. `src/application/sharing/qr.ts`: text in, boolean matrix out. Use the `qrcode-generator` package (MIT, no dependencies; check its current API with Context7 before writing) or a self-contained encoder. Drawn as inline SVG in the browser. No request to any outside service.
2. `src/ui/sharing/SendToPhone.tsx`: a solid dialog (no glass: nothing live behind it), QR at 240 px in ink on `--og-surface`, the link as selectable text, "Remove link" which revokes. It publishes through the existing share command with no privacy trim (it is the rider's own phone).
3. `src/ui/planner/RideActions.tsx`: a secondary "Send to phone" button beside Save, desktop widths only (1181 px and up), enabled when a route exists.
4. The share page becomes a real page in the app's look: route on the map component the route-detail page uses (or the static map from `src/application/map/static-map.ts`), name, miles, time, the surface line, and one green "Ride this" button that puts the exact shared line into the planner the way Explore's "Ride this" does (`rg -n "Ride this" src`), after which Start is enabled. Remove the raw JSON from view (keep `data-testid="public-share-payload"` available to tests if `tests/e2e/critical/public-share.spec.ts` needs it). Keep the revoked and not-found states and the honesty sentence about hidden start and finish.

## Pass / fail
- New `tests/e2e/critical/send-to-phone.spec.ts`: at 1440 x 900 plan the fixture route, open Send to phone, read the link from the dialog, open it in a second context at 440 x 956: the page shows the same distance; tap "Ride this"; the planner shows the route and `start-ride` is enabled. The test records network requests and finds none to a third-party host for the QR.
- `npx vitest run tests/unit/sharing` passes with a new `qr.test.ts` (a known string gives the expected version and size; the three finder patterns are present).
- `npx playwright test tests/e2e/critical/share.spec.ts tests/e2e/critical/public-share.spec.ts` still passes.
- `npm run css:budget` passes. Shots of the dialog and the phone share page, both themes, in the PR.
- This package touches only sharing files and `RideActions.tsx`; it runs beside every other package.

## Rules
- Read `CLAUDE.md`, `AGENTS.md` and (for any screen work) `DESIGN.md` first. The plan for this round is `.fable/NEXT-PLAN.md`; its section 5 holds the taste calls. Do not re-ask them.
- Work on your own branch off `round/next` in your own worktree. Never push to `main`, never deploy.
- On docker-dev run only `npm run typecheck`, `npm run lint` and the tests named here. No `npm run build`, no full suite: CI runs those.
- Never scan `/` or `~`. Search inside the repo only. Frozen areas (hiking, Spotify, cameras, Ask/Jev, wind, sun, long trip, live follow) are off limits.
- Unknown or unavailable is never shown as clear, open, paved, fine or safe.
- Small plain-English commits. Final message: what a rider now sees, the test output, anything you could not do.
