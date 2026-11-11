Work package 2 of /root/Vibe/wt/og-worldclass/.fable/ROUND-PLAN.md (read sections 5.1 and 6, plus CLAUDE.md, AGENTS.md, docs/PLAN.md section 5). This codebase is yours.

Goal (rider sentence): "Ask for twisty, get twisty." Curvy and Backroads requests must actually seek curves. Today the twisty profile has no curvature term and the curvature rules sit behind a shadow switch (src/server/planning/plan-service.ts ~line 847, ride-formula-rules.ts).

Do: turn the curvature rules on for Curvy/Backroads (or bake curvature into the profile if the scorecard proves that better), and DELETE the shadow switch in the same change (churn rule: no shadow flags). Keep all trust rules intact; unknown is never treated as safe.

Pass/fail:
1. First capture a baseline scorecard on unmodified code, then on your change: `npm run scorecard -- --set tuning` (needs live router: `ssh -N -L 8989:127.0.0.1:8989 docker-stable &` plus the prod switch env vars documented in scripts/scorecard). Curvy rides go from 0 to 4+ wins, total wins not lower than baseline, trust failures 0.
2. `npx tsc --noEmit`, `npm run lint`, and unit tests for touched files pass. Do not run the full unit suite on this box (10 GB RAM).
3. Commit on your branch with a PR-ready description: before/after scorecard headline and per-ride table. Do not push or deploy.
