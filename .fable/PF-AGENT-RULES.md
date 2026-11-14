# Rules for PF package agents (coordinator, 2026-11-12)
- This codebase is yours. Read CLAUDE.md, AGENTS.md, DESIGN.md, then .fable/PHONE-FIRST-PLAN.md (Fable). Build only your packages, to Fable's specs and pass/fail checks.
- Branch is off ui/map-first (PR #221, not yet merged; it already holds PF-1 + the #221 fixes). Weather WARNING lines must stay visible at the half sheet (owner safety rule); never hide a warning to save space.
- docker-dev: 10 GB RAM, two other PF agents run at the same time. Every build, dev server, browser run: `flock /tmp/og-heavy.lock`. Typecheck/vitest: `flock /tmp/og-light.lock`, `--maxWorkers=2`. `PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright`. Pick a unique port (yours given in the prompt). Close every server/browser you start. Never scan the disk.
- Local browser tests can time out under load at 30 s; retry with --timeout=60000 before calling it a failure; compare with the base branch before blaming yourself.
- Prove: typecheck, lint, vitest, the critical browser specs your files touch, plus before/after phone screenshots (390x844 and 320x568; day, night, satellite where relevant) in .fable/shots/<your-lane>/ from a production build.
- Commit in plain English; last commit message contains [update-baselines]. Push your branch. Do NOT open PRs, merge, or deploy — the coordinator stacks lanes onto #221's successor.
- Final reply in plain English: what a rider sees now, test results, screenshot paths, anything left.
