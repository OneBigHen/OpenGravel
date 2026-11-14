# OpenGravel: instructions for autonomous agents

Read `CLAUDE.md` first, then `docs/PLAN.md`. Everything in it applies to Pi, OpenCode, Codex and any other agent. Read `DESIGN.md` before any UI work.

The owner does not read code. Finish the job and prove it by running it, then report in plain English.

## Before calling work done

On docker-dev run only the checks for what you touched:

```bash
npm run typecheck
npm run lint
npx vitest run <the test files for the code you changed>
```

Then open a PR. **GitHub CI is the gate of record**: it runs the full unit tests, architecture tests,
the build and the critical browser tests. Do not run `npm run build` or the full suite on docker-dev.
Routing PRs attach a scorecard run. Screen PRs attach a before/after `npm run shots` gallery.

## Rules for long unattended runs

- Work only on your own branch in your worktree. Never push to `main` and never deploy to production. The owner approves deploys.
- Make small commits with plain-English messages. Commit when checks pass, so a dropped session loses little.
- Never commit secrets or production data.
- Do not ask questions you can answer from the repo. If truly blocked, write what you need and stop.
- iOS builds and simulators run on the MacBook (`ssh macbook`), one at a time. Run builds detached so a dropped connection doesn't kill them.
- Only one build or end-to-end test run at a time on docker-dev.
- Never scan the whole disk. Search this repo.

## Frozen areas (until 2027-02-08)

No new work here. Keep it running; fix only what breaks the build.

- Hiking mode, the trail catalog and the hiking router (frozen by the owner on 2026-11-10).
- Spotify, traffic cameras, AI "Ask" and the Jev judges, wind arrows, sun lighting, long-trip, live follow, emergency card.
- The native SwiftUI rewrite, CarPlay, Android.
- The 26-mission acceptance pack (its nightly job is switched off; manual runs only).

## Rules that stop churn

- Work-in-progress limit: 3 open PRs. Nothing new starts while a PR is more than 3 days old.
- Frozen areas are off limits.
- No new documents. Handoffs go in the PR description. Only `docs/PLAN.md` and the scorecard result are updated.
- No new "shadow" switches. A routing change is turned on or deleted in the same PR, decided by the scorecard.
- Taste is decided once, written in the `DESIGN.md` decision log, and never re-asked. A change to an approved screenshot without a log line fails review.
- A flaky browser test gets one rerun, then moves to a non-blocking job with an issue. Never "rerun until green".
- At most 1 PR in 5 may be plumbing. Every other PR must start with a sentence a rider would understand.
- Two failed attempts by a cheap worker means one attempt by Codex Sol; if that fails too, park the issue with a note.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
