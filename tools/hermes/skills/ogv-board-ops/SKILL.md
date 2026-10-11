---
name: ogv-board-ops
description: How to work an OpenGravel iPhone card on the opengravel-ios kanban board — reading the spec, worktree and branch rules, running CI and mac-gate, handing off for review, blocking well, and taking over escalated cards.
---

# OpenGravel board operations

## Start of every card
1. `kanban_show()`: read the title, body, parent handoffs, previous runs and every comment.
2. Your cwd is the card's git worktree on branch `ogv/<id>-<slug>`. Run `git fetch origin && git rebase origin/main` before you start.
3. Read `docs/native-app/ENGINEERING.md` §1 and the SPEC sections the card names. If the card depends on DESIGN-SYSTEM.md, read it too.

## While working
- Commit small and often. Push the branch early: `git push -u origin HEAD`.
- Open the PR as soon as there's something to look at: `gh pr create --draft --base main --title "[<ID>] <title>" --body "<10 lines>"`. Mark it ready (`gh pr ready`) before handing off.
- Heartbeat during long steps: `kanban_heartbeat(note="...")`.

## Proving it works
- **CI (any Swift change):** `gh pr checks --watch` until `ios / build + unit tests` finishes. On failure: `gh run view <id> --log-failed | tail -150`.
- **Mac (screens, components, navigation, ride):** `mac-gate <branch> [--snapshots] [--ui] [--maestro] [--replay]`. Results land in `./mac-gate/<timestamp>/`. Attach the screenshots with `kanban_attach`.
  - Waiting for the Mac lock is normal.
  - If the Mac is unreachable: `~/bin/wake-mac.py --timeout 120`, then retry once. If it's still down, block with `kind=transient` and reason "Mac unreachable". The escalator wakes Opus; only Opus can decide whether an owner message is needed.
- **Server changes:** `npm run lint && npm run typecheck && npm test` in the worktree, and the `ci.yml` check on the PR.
- New snapshot references: `mac-gate <branch> --record-snapshots`, commit the images, and say so in the handoff.

## Handing off
`kanban_request_review(reviewer="ogv-reviewer", summary="<what changed, how verified>", metadata={published_pr, changed_files, verification, screenshots, residual_risk})`.

## Blocking well (the next model has to act on it)
Use `kanban_block(kind=..., reason=...)`:

| kind | When |
|---|---|
| `dependency` | A parent card's output is missing. Name the card. |
| `transient` | Mac down, CI outage, or quota. Retry first. |
| `needs_input` | Two honest failures on the same problem, or a missing decision. |

Write the reason as:
```
Tried: <1-3 bullets>
Failing: <exact command> -> <exact error, 5 lines max>
Think: <your best hypothesis>
Need: <what would unblock it>
OWNER ASK: <only if the owner alone can do it: password, physical device, account, taste decision>
```

Blocked cards go up the ladder automatically: DeepSeek → Codex Sol → Opus monitor → owner. Do not message the owner yourself.

## Taking over an escalated card
1. Read the ESCALATED comment, all run summaries, and the worker log (`~/.hermes/kanban/boards/opengravel-ios/logs/<task-id>.log`).
2. Check out the same branch. Look at `git log origin/main..HEAD` and the PR state.
3. Keep good work. Revert only what's wrong, and say why in a comment.
4. Finish the card yourself, or block with a better reason than the one you inherited.

## Never
- Hand-edit `.xcodeproj` or `.pbxproj`.
- Raise lint limits.
- Re-record snapshots silently.
- Add a dependency the card doesn't name.
- Copy GPL or decompiled code.
- Put secrets in code, comments or metadata.
- Merge your own PR.
