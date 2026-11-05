# OpenGravel: instructions for autonomous agents

Read `CLAUDE.md` first. Everything in it applies to Pi, OpenCode, Codex and any other agent. Read `DESIGN.md` before any UI work.

The owner does not read code. Finish the job and prove it by running it, then report in plain English.

## Before calling work done

Run all of these and fix what fails:

```bash
npm run typecheck
npm run lint
npm test
npm run test:architecture
npm run build
```

For UI changes, also run `npm run shots` and look at the screenshots.

## Rules for long unattended runs

- Work only on your own branch in your worktree. Never push to `main` and never deploy to production. The owner approves deploys.
- Make small commits with plain-English messages. Commit when checks pass, so a dropped session loses little.
- Never commit secrets or production data.
- Do not ask questions you can answer from the repo. If truly blocked, write what you need and stop.
- iOS builds and simulators run on the MacBook (`ssh macbook`), one at a time. Run builds detached so a dropped connection doesn't kill them.
- Only one build or end-to-end test run at a time on docker-dev.
- Never scan the whole disk. Search this repo.
