# Library round: rules every lib-* brief inherits

This codebase is yours. Repo OneBigHen/OpenGravel. Work in your own worktree and branch off `origin/main`
(`library/<slug>`). Read `CLAUDE.md`, `AGENTS.md`, `DESIGN.md` (before any screen work) and
`.fable/LIBRARY-PLAN.md` sections 3 to 6. Section 6 is the contract: the pack tables, the endpoints and the
JSON shapes are fixed there. If you must change one, change the plan file in the same PR and say so first.

- **Names.** In code this feature is `route-library` (`src/application/route-library/`, `src/server/route-library/`,
  `/api/route-library/...`, `OGV_ROUTE_LIBRARY_PACK`, CSS block `og-routes`). `library` and `.og-library` already
  mean the rider's own My rides; do not reuse or import from them for this work.
- **Honesty.** Unknown or unavailable is never shown as open, clear, legal, paved or safe. A source's claim reads
  "the source says". A library track is a reference line, never a router-checked route. Never hide a weather
  warning. Every ride we did not make shows its credit line and its source link.
- **Rider words.** Plain rider English, US units (mi, ft, mph). Types: Twisty, Scenic, Dirt, Trails, Big trips.
  Quality: "Standout" (score 5), "Great ride" (score 4), nothing below. Never draw stars for our own score.
- **Data.** The library folder is `/root/Vibe/og-route-library-national/` (read-only for you; another session
  writes to it). The 548 MB of GPX never goes into git, the JS bundle or production. Test against the fixture
  pack in `tests/fixtures/route-library/`.
- **Machine.** docker-dev has 10 GB and crashed from memory pressure on 2026-11-13. Run only `npm run typecheck`,
  `npm run lint`, `npm run css:budget` and the unit tests you touched. Never `npm run build` or the full suite
  there. One browser at a time, closed when done; long shot runs go out with `fleet run auto`. Never scan `/`
  or `~`.
- **Screens.** Phone first. Every screen change attaches shots at 390 x 844 and 320 x 568, Day and Night, taken
  in fixture mode, and names any DESIGN.md decision-log line it relies on. Tokens only (`var(--og-...)`), no
  literal colours, radii or shadows. Touch targets 48 px on phone. `css:budget` may rise only by the lines the
  brief allows, stated in the PR.
- **Frozen.** Hiking, Spotify, cameras, Ask/Jev, wind, sun lighting, the long-trip planner
  (`src/application/long-trip`), live follow, emergency card: untouched.
- **Done** means a PR whose description starts with the rider sentence, lists the commands you ran with their
  results, and attaches the shots. GitHub CI is the gate. No deploy; the owner approves releases and pack
  publishes.
