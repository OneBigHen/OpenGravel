# Rules for the Hermes defect-fix lanes (coordinator, 2026-11-13)

- This codebase is yours. Read CLAUDE.md, AGENTS.md, DESIGN.md first, then `.fable/hermes/capture.md` (Hermes' 27-defect capture of prod 9e1c4367 plus the owner's phone screenshots). Fix only the OG-numbers your lane owns.
- Prod = origin/main = 9e1c4367. Your branch is off it. Ignore Hermes' note that "the live build is ahead of origin/main" — Hermes had a stale clone; main IS what ships.
- Hermes quoted minified bundle names; find the real source with grep on the quoted user-facing strings.
- Three other lanes are open as PRs and touch CSS/sheet/chrome: #222 night map + glove-sized ride screen, #223 sheet heights/peek, #226 ride top bar + compare rows + 320px search. Do not redo their work; keep your CSS changes small and local to avoid conflicts.
- Owner rules: never hide a weather WARNING; phone is the primary experience; plain rider English, no engineering words (TODO, canonical, connector, feed, registry, DEM, MVUM, WZDx, NRT) in anything a rider sees. US riders: feet and miles.
- docker-dev has 10 GB RAM and other agents run at the same time. Every build, dev server and browser run: `flock /tmp/og-heavy.lock <cmd>`. Typecheck/vitest: `flock /tmp/og-light.lock`, vitest `--maxWorkers=2`. `PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright`. Use only your given port. Close every server/browser you start. Never scan the disk (no find/rg from / or ~).
- Local browser tests can time out under load at 30 s; retry with --timeout=60000 before calling it a failure; compare with origin/main before blaming yourself.
- Prove every fix: typecheck, lint, vitest for touched areas (add unit tests for each fix), the critical browser specs your files touch, and before/after phone screenshots (390x844, plus 320x568 where layout changed) in `.fable/shots/<lane>/`.
- Commit in plain English, one commit per OG item where practical; last commit message contains [update-baselines]. Push your branch (`git push -u origin HEAD`). Do NOT open PRs, merge or deploy — the coordinator does that.
- If an item cannot be reproduced or is already fixed on main, say so with evidence rather than inventing a change.
- Final reply in plain English: per OG-number, what a rider sees now (or why not fixed), test results, screenshot paths, anything left.
