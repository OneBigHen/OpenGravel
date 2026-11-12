# R3-3 resume (share and import) — This codebase is yours

Repo OpenGravel, worktree `og-r3-share-import`, branch `r3/share-import`.
Read `CLAUDE.md`, `AGENTS.md`, `DESIGN.md`, then the full brief `.fable/briefs/r3-3-share-import.md`
(Build list, Files, Pass/fail). The earlier agent died on a rate limit after starting a rewrite of
`src/ui/sharing/ShareSheet.tsx` (commit fe3e6941 "WIP R3-3"). Review that rewrite, finish it, then
do the import half of the brief. Make every unit test you touch pass, then replace the WIP commit
message with a real one.

Rules: run only `npm run typecheck`, `npm run lint` and the touched unit tests
(`npx vitest run <paths>`). Never `npm run build` or the full browser suite. Update browser spec
selectors if your text changes; never skip a spec. `npm run css:budget` must not rise. Frozen
areas (hiking, Spotify, cameras, Ask/Jev, wind, long trip, live follow) stay untouched. Small
plain-English commits on `r3/share-import`. Never push to main, never deploy.

Final message: what a rider now sees, commands run with results, anything left undone.
