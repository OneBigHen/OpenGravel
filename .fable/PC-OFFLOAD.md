# Heavy runs go to the Windows PC (50 GB RAM, 16 cores) — docker-dev is out of memory
- Push your branch first. Then: `/root/bin/og-pc <branch> '<command>'` runs it in a clean per-branch worktree on the PC (npm ci done for you, PLAYWRIGHT_BROWSERS_PATH set, node 24).
  e.g. `/root/bin/og-pc ui/pf-chrome 'npm run build && npx playwright test tests/e2e/critical/compact-sheet.spec.ts --project=critical-chromium'`
- Copy results back: `/root/bin/og-pc-get <branch> test-results /root/Vibe/wt/<your-wt>/.fable/pc-out` (tar of a path inside the PC worktree).
- Use the PC for: production builds, browser specs, screenshot runs. Keep only typecheck/lint/vitest (under /tmp/og-light.lock, --maxWorkers=2) on docker-dev. Do NOT start dev servers on docker-dev any more.
- The PC sleeps when idle; og-pc keeps it awake 2 h each call. If ssh times out, tell the coordinator.
