# Package 1 helper: `npm run css:budget` ratchet gate

This codebase is yours. Repo OpenGravel (Next.js). You are in your own worktree, branch off `design/world-class`.

## Goal
"The app cannot quietly get uglier." A script that counts CSS bloat and fails if any count rises above a checked-in budget.

## Build
1. `scripts/qa/css-budget.mjs` (plain Node ESM, no new dependencies, ~60 lines). Scan every `*.css` file under `src/` (use fs.readdirSync recursive inside `src/` only). Count:
   - `totalLines` (all CSS lines), `maxFileLines` plus a per-file map `files: { "src/ui/ride/ride.css": 3071, ... }`
   - `backdropFilter`: declarations of `backdrop-filter` or `-webkit-backdrop-filter` (count each declaration line)
   - `mediaQueries`: number of DISTINCT `@media` condition strings (normalise whitespace)
   - `literalRadius`: `border-radius` declarations whose value has a px/rem/% number and no `var(`
   - `literalShadow`: `box-shadow` declarations not using `var(` and not `none`
   - `hexLiterals`: `#rgb/#rrggbb/#rrggbbaa` outside `src/app/tokens.css`
2. Budget file `scripts/qa/css-budget.json` holding today's numbers (generate it with `node scripts/qa/css-budget.mjs --write`).
3. Default run prints a small table (metric, budget, now, delta) and exits 1 if any metric (or any single file's line count, or a NEW css file over 400 lines) is above budget. `--write` rewrites the budget (only allowed to lower numbers unless `--allow-raise` is passed; print a warning when raising).
4. `package.json` script: `"css:budget": "node scripts/qa/css-budget.mjs"`.
5. Add a step `- name: CSS budget\n        run: npm run css:budget` in `.github/workflows/ci.yml` job `gates` right after Lint.
6. Unit test `tests/unit/qa/css-budget.test.ts` (vitest): export the counting function and test it on small inline CSS strings (distinct media queries, var() radius not counted, -webkit-backdrop-filter counted, hex in tokens.css ignored).

## Pass/fail (run all, paste output)
- `npm run css:budget` exits 0 on this tree.
- Add one line `.x{backdrop-filter:blur(2px)}` to any css file → exits 1; then revert it.
- `npx vitest run tests/unit/qa/css-budget.test.ts` passes.
- `npm run lint` and `npm run typecheck` clean.

## Rules
Do not run `npm run build` or the full suite. Never scan / or ~. Commit on your branch with a plain-English message. Do not push to main. Final message: what you built, the printed table, test output.
