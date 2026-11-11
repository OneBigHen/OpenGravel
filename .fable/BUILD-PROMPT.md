Build the whole OpenGravel world-class round, end to end.

Read first, in /root/Vibe/wt/og-worldclass (branch design/world-class): .fable/HANDOFF.md, .fable/ROUND-PLAN.md (look, layout, CSS, layers), .fable/ROUTING-PLAN.md (the single routing roadmap; it replaces ROUND-PLAN packages 2, 5, 8), then CLAUDE.md, AGENTS.md, DESIGN.md, docs/PLAN.md.

Two lanes run side by side:
- Screens: ROUND-PLAN packages 1 → 3 → 4 → 6 → 7.
- Routing: ROUTING-PLAN steps 1 → 6.
Package 1 (screenshot baselines + css:budget gate) and routing step 1 (honest scorecard) go first.

Who does what (cheapest worker that can pass the check):
- DeepSeek V4.1 Flash for every bounded or mechanical job: CSS file migrations, the css:budget script, new layer providers (package 6), dead-code deletion (routing step 3), tests. Use `commandcode -p "<brief>" --skip-onboarding -m deepseek/deepseek-v4.1-flash --yolo -w <name>` or OpenCode/Pi via Paseo, each in its own worktree off design/world-class. Write each worker a brief file (goal, files, pass/fail command, "This codebase is yours").
- Opus (you) does the visual design work yourself: Layers sheet, planner layout, ride screen, owner-pick shots. You also review every worker's diff and evidence.
- Codex Sol (`delegate sol --wt <slug> -f <brief>`, background) for the routing steps (2, 4, 5, 6). If it exits 75 (out of quota), use a Sonnet subagent instead.
- Graph rebuild (routing step 4) and any heavy build or test run: the Windows PC (`ssh windows-zac`, WSL, push a branch there, don't copy files). Use `fleet run auto` when docker-dev is short of RAM.
- Fable only as an advisor: when a step fails twice, or before a big architecture decision. Give it a written brief.

Rules:
- docker-dev has 10 GB RAM: at most one heavy worker plus 2 light workers here at once. Never scan / or ~.
- Every routing change attaches before/after scorecard results: wins never drop, trust failures stay 0.
- Every screen change attaches before/after shots and passes the baselines once package 1 lands.
- Two failed attempts by a cheap worker means one attempt by Sol or Sonnet, then park it with a note. No retry loops.
- One PR per package or step, opened against main. GitHub CI is the gate of record. Merge when the gates pass.
- Bring me the 3 owner picks as side-by-side screenshots once package 1 is in: green or neutral selected buttons; Mapbox grey night map or our own dark terrain map; glass on everything or only over the map. Record my answers in DESIGN.md.
- Do not deploy to production without my go. When a batch is ready, send me one message: what changed in rider words, 3 screenshots, and the scorecard line.
- Keep .fable/HANDOFF.md current, so a fresh session can always pick up. Tell me when context should be cleared.

Report to me in plain English. I don't read code.
