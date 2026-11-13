# Scorecard v4: honest verdicts (from Fable's RM-DECIDE-VERDICT.md, items a, b, c, d)

This codebase is yours. Read AGENTS.md and CLAUDE.md first, then `.fable/RM-DECIDE-VERDICT.md` (section with items a-d).
Code lives in `scripts/scorecard/`. Do NOT run live scorecards against a router (no router reachable); prove with unit tests and with the saved JSON reports already in the repo or fixtures.

Build:
1. (a) Two-run mode: a way to combine two scorecard result files; a row counts only if both runs agree; the headline prints the lower of the two counts. Old single-run output keeps working.
2. (b) Every scorecard result file records the router's graph build date and profile hash (read them from GraphHopper's /info when available, otherwise "unknown") plus the git commit. The two-run combiner refuses (clear message) to combine runs with different build dates.
3. (c) Margin column: a Win whose score is within 10% of its bar is labelled "thin"; the headline says "N wins (K thin)". Rule v3 itself must not change.
4. (d) Fastest-reference sanity: for each A-to-B ride, print what the "fastest" reference is; a ride whose own chosen line is more than 2% quicker than its "fastest" reference is marked FAILED (reference broken) and counted in the headline.

Pass/fail: `npx tsc --noEmit -p .` clean, `npx eslint scripts/scorecard`, `npx vitest run tests/unit/scorecard --maxWorkers=2` (add tests for each item a-d). Existing tests stay green.
Commit in plain English on this branch. Don't open PRs, merge or deploy. Final message: plain English list of what changed and test output.
