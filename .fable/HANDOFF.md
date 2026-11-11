# Handoff: OpenGravel world-class round (2026-11-10)

Owner ask: outcompete REVER and Gaia; rich rider layers; good motorcycle routes; CSS/layout/looks rebuilt to world class. Fable advises, Opus runs the round and does UI/CSS itself.

- Worktree: `/root/Vibe/wt/og-worldclass`, branch `design/world-class` off origin/main 29cc986 (= production). Not pushed yet. `node_modules` not installed here yet (`npm ci` before building).
- Baseline prod screenshots: `.fable/shots/` (desktop 1440 + phone 440, light/dark, home/explore/settings/loop/layers). Script: `.fable/shoot.mjs` (run from a checkout with playwright, `PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright`).
- Fable brief: `.fable/BRIEF.md`. **Fable's plan: `.fable/ROUND-PLAN.md` — start here.**
- Read `CLAUDE.md`, `AGENTS.md`, `docs/PLAN.md`, `DESIGN.md` in the worktree before UI work.
- Note `/root/Vibe/wt/og-public` has someone's uncommitted work on `feat/progressive-routes`: leave it alone.

Next steps:
1. Show the owner Fable's owner-picks as side-by-side shots; record answers in DESIGN.md decision log.
2. Execute work packages in Fable's order; one heavy worker at a time on docker-dev.
3. Every PR: before/after shots gallery; routing PRs attach a scorecard run. No deploy without owner's go.

## Status at handoff (2026-11-10 evening)
- Fable's plan is DONE: `.fable/ROUND-PLAN.md` (8 work packages, 3 owner picks). Committed on `design/world-class` (not pushed).
- Package 2 brief ready: `.fable/pkg2-brief.md`. Codex Sol quota was out (exit 75) → run it with a Sonnet subagent (`model: "sonnet"`, background) or retry `delegate sol --wt og-twisty -f .fable/pkg2-brief.md` once quota resets.
- `npm ci` done in this worktree.
- Do package 1 (screenshot baselines + `css:budget` gate, with planned-route and ride-screen states) yourself first; then 3 (Layers sheet) beside package 2.
- Owner picks need side-by-side shots (green vs neutral selected buttons; Mapbox grey night vs own dark terrain; glass everywhere vs glass only over map). Build them after package 1.
