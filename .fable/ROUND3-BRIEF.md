# Fable brief: audit plus the round after this one (2026-11-11)

This codebase is yours. **The owner has given you full authority** to move the app around (structure, navigation, screens, what's on by default) so it works great and looks incredible. Owner, verbatim: "make sure all features work excellent and add in new features to be an excellent app … Fable has full authority to move this app around."

## State
- Worktree `/root/Vibe/wt/og-next`, branch `round/next`. Your plan `.fable/NEXT-PLAN.md` is being built now:
  - N4 desktop rail: done (tidy chips, live green button, Best Ride first, Start pinned, More options fold).
  - N1 server half: done (the first answer uses the rider's profile; loops use one seed; Mixed A-to-B keeps its own profile).
  - N2 Part A surface-ahead: done. Part B handlebar screen: Sonnet is working on it.
  - N3 Part A ride-truth: DeepSeek is working on it on the MacBook. N5 send to phone: DeepSeek on the overflow server.
  - Opus does the N1 client half and N3's screens next.
- Production (https://opengravel.henning.rodeo) is still 40115cb6.

## What I need
Write `.fable/ROUND3-PLAN.md` (at most about 200 lines) plus a self-contained brief per package in `.fable/briefs/r3-*.md`.

1. **Audit: does every feature work excellently?** Drive production in a headless browser (playwright lives in this repo's node_modules; `PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright`), phone 440x956 and desktop 1440x900, light and dark. Walk every visible feature a rider can reach: search, Loop, destination plan, route cards, layers, curated rides, Explore, My rides (save, rename, GPX in/out), Settings and garage, share, ride screen, free ride and record. List what is broken, ugly or confusing, ranked by how much it hurts a rider, with a screenshot path and the file to fix for each. Save screenshots under `.fable/shots/audit/`. Only report what you saw.
2. **Restructure calls.** With your authority: what should move, merge, become the default, or be hidden so the app feels like one excellent instrument? Be decisive. Each call should be a concrete change with files.
3. **New features for the next round: 3 to 5.** Pick ones a rider will love and that fit the angle (gravel and twisty Mid-Atlantic, trust it). Candidates to weigh, not a must: offline "this ride works in airplane mode", the "gate closed" one-tap report, ride replay or a shareable ride card after a ride, weekend ride suggestions near me, a fuel-range check, a richer curated ride page. Frozen areas stay frozen (hiking, Spotify, cameras, Ask/Jev, wind, sun, long trip, live follow). Nothing needs the paid Apple account.
4. For each package: rider sentence, files, executable pass/fail checks, worker (DeepSeek on the MacBook or overflow for bulk work, Sonnet for screens, Opus reviews), size, and what can run in parallel.

Rules: don't edit source code. Mark estimates as estimates. Never scan / or ~.

## Update 2026-11-11 morning (your first run hit a rate limit mid-audit)
- Your earlier audit shots are already in `.fable/shots/audit/` (about 30 phone-light shots). Reuse them; shoot only what is missing (dark, desktop, the rest of the walk).
- Since then: N3 is done (ride-truth data + three lines under the route on phone and the chosen desktop card, surface bar full width and tappable, map stripe from zoom 8; shots `.fable/shots/n3/`). CSS is back under budget. N2 handlebar screen is being finished by Sonnet on `next/handlebar` (/root/Vibe/wt/og-handlebar) — don't review it yet.
- Write the plan files and stop; don't wait on anything else.

## Update 2026-11-11 midday (second run)
- N2 handlebar screen is done and merged into `round/next` (f03ea995); its browser tests pass. You may review it on the branch (it is not on production yet): `tests/e2e/critical/ride-handlebar.spec.ts`, `src/ui/ride/RideFocus.tsx`.
- The full browser suite is running on docker-dev right now; don't start a build or the scorecard. Headless browsing of production is fine.
- Write the plan files and stop.
