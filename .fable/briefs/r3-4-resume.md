# R3-4 resume (one instrument) — This codebase is yours

Repo OpenGravel, worktree `/root/Vibe/wt/og-r3-one-instrument`, branch `r3/one-instrument`.
Read `CLAUDE.md`, `AGENTS.md`, `DESIGN.md`, then the full brief `.fable/briefs/r3-4-one-instrument.md`
(Build list, Files, Pass/fail). The earlier agent died on a rate limit. State:

Done (committed): weather thins the line to 512 points (f1a3b5bc); Auto theme follows the sun at
the rider's place on every page (106a1037).
Half done (commit 38a4a62b "WIP R3-4"): Start paints the route outline at once
(`src/ui/ride/RouteOutline.tsx`, `RideFocus.tsx`) and drops "Ride Focus" wording. Review it,
finish it, make its tests pass, and replace the WIP commit message with a real one (amend or a
follow-up commit, your choice).

Still to build (from the brief):
1. One summary component for loop, destination, curated, saved and imported rides (title, time and
   miles, the three truth lines from `RideTruthLines.tsx`, Start, Save, Share). Curated/imported
   loops are titled by their name, never "To <place>".
2. Save in one tap with an automatic name ("Rothrock loop, 53 mi"), button becomes "Saved", title
   editable in place. Delete the name box, the second Save and every "draft" sentence.
3. Start: remaining "Ride Focus" strings gone; no "Back to the planner" page unless loading failed.
4. Desktop opens on Loop with "Make my loop" live.
5. Compare cards named by what they are ("Most dirt", "Twistiest", "Fastest", else "Option 2");
   fix the clipped "Back to ride" link.

Rules: on docker-dev run only `npm run typecheck`, `npm run lint` and the touched unit tests,
wrapped in `flock /tmp/og-light.lock …`. Never `npm run build` or the full browser suite (CI does
that). If you touch browser specs, keep them; update selectors, never skip. Browser tests need
`PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright` if you run one single spec.
`npm run css:budget` must not rise. Frozen areas (hiking, Spotify, cameras, Ask/Jev, wind, long
trip, live follow) stay untouched. Unknown is never shown as open, paved or safe. Small
plain-English commits, never push to main, never deploy. You may push the branch
`r3/one-instrument` to origin.

Final message: what a rider now sees, commands run with results, anything left undone.
