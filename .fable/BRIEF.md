# Fable brief: OpenGravel "world class" round

This codebase is yours. You are the advisor for the next major round of improvements. Do not edit product code; write the plan.

## Goal (owner's words, 2026-11-10)
"Keep pushing this app to outcompete REVER and Gaia, provide rich layer options and proper good routes for motorcyclists. It's all been vibe coded so it can be improved significantly. I suspect the CSS sheet and the layout and looks can all be improved. Make this world class."

The owner vibe-codes and does not read code. Every step must be proven by running something (tests, build, screenshots, scorecard).

## Current state
- Repo worktree: `/root/Vibe/wt/og-worldclass` (branch `design/world-class`, off `origin/main` 29cc986 = production).
- Read first: `CLAUDE.md`, `AGENTS.md`, `docs/PLAN.md` (90-day plan, milestones, frozen areas, churn rules), `DESIGN.md` (locked design rules: "trail instrument", glass, two themes, tokens in `src/app/tokens.css`).
- Styles: ~35 CSS files, ~20k lines (`src/app/*.css`, `src/ui/**/*.css`). No screenshot baselines yet (`npm run shots` exists: `scripts/og-shots/`).
- Layers UI: `src/ui/layers/`. Map style/basemap code: `src/ui/map/`. Planner: `src/ui/planner/`. Ride: `src/ui/ride/`.
- Routing: GraphHopper (PA+NJ only). `npm run scorecard` = 20 rides vs fastest baseline; latest: 4/20 wins, 0 trust failures (PLAN bar is 16/20).
- Live screenshots of production (desktop 1440x900 and phone 440 wide, light + dark; home, explore, settings, loop, layers panel): `.fable/shots/*.png`. Look at them.
- Production health shows layer-ish providers available: TomTom traffic/incidents/stops, NWS weather/alerts, curvature catalogue (Great Roads), Gravel Atlas, PAD-US/Overpass public land, USFS MVUM + PA/NJ seasonal roads, work zones, traffic cameras, Mapbox token, OpenFreeMap.
- Owner's newest ask (rich layers, world-class look) partly overrides PLAN.md's freeze list: e.g. layers that serve riders are back in scope. Hiking stays frozen (it should not be on the rider's Layers sheet front and centre).

## Competitors
- REVER: motorcycle route planner. Curvy-road routing ("twisty" slider), REV-scored rides, Butler Maps premium roads, ride discovery/community rides, ride recording, offline, Garmin/phone nav.
- Gaia GPS: layer powerhouse: dozens of overlays (public land, MVUM, USFS, slope angle, satellite variants, topo, weather/precip radar, wildfire, private land/parcels), offline maps, track recording. Not a routing app.
- Check current feature sets via web search if useful; cite what you confirm.

## What I need from you (write to `.fable/ROUND-PLAN.md`)
1. **Verdict** in 5 lines: where OpenGravel loses to REVER and Gaia today, as seen in the shots and code.
2. **Look and layout** — concrete redesign spec, not vibes: desktop planner panel, phone plan sheet, Layers sheet, ride screen. Name the layout, sizes, type scale, what is removed. Say what in DESIGN.md changes (owner must OK changes to locked rules: list them as proposals).
3. **CSS strategy** — how to cut the 20k lines safely (consolidate, delete dead rules, enforce tokens) with a measurable gate (line count, stylelint rule, screenshot baselines). Pick the order.
4. **Layers** — a ranked catalogue of rider layers to ship, each with free/legal data source, whether the data already exists in this repo, and how it appears (overlay, legend, quick set). Aim to beat Gaia for a motorcyclist, not for hikers.
5. **Routes** — the 3 highest-leverage routing changes to raise the scorecard from 4/20 toward 16/20, with file pointers and the check that proves each.
6. **Work packages** — at most 8, ranked, each: one rider-facing sentence, files, pass/fail command, suggested worker (Opus does UI/CSS itself per owner; Codex Sol for routing; DeepSeek for bounded mechanical edits; Sonnet when Codex quota is out), size S/M/L, and which can run in parallel. Only one heavy worker at a time on docker-dev (10 GB RAM); Windows PC (`ssh windows-zac`, 64 GB) for heavy builds.
7. **Owner picks** — at most 3 taste questions for the owner, each best shown as side-by-side screenshots.

## Pass/fail for your plan
- Every work package has a runnable check.
- Every claim about the current app cites a file path or a screenshot name.
- Plan fits on ~3 pages. No history recap.
