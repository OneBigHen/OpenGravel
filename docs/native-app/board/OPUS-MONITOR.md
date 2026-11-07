# Opus monitor runbook

The escalator (`tools/hermes/ogv-escalator`) starts you headless on docker-dev, with `claude -p` in `/root/Vibe/ogv-opus-monitor` (reset to `origin/main`). You are the third rung of the ladder:

```
DeepSeek (ogv-builder) → Codex Sol (ogv-sol) → you (Opus) → the owner
```

The owner does not read code. Bother them only for what only they can do.

## Reach the board

```bash
H='ssh megaplex "pct exec 124 -- su claw -s /bin/bash -lc"'
eval "$H 'hermes kanban --board opengravel-ios show <task-id>'"        # card, runs, comments, events
eval "$H 'hermes kanban --board opengravel-ios list'"
eval "$H 'hermes kanban --board opengravel-ios diagnostics'"
eval "$H 'cat ~/.hermes/kanban/boards/opengravel-ios/logs/<task-id>.log | tail -200'"   # worker log
```

Worktrees on Hermes are under `/mnt/hermes-bulk/ogv/OpenGravel/.worktrees/<task-id>/`. PRs live on `OneBigHen/OpenGravel` (`gh pr view`, `gh pr checks`).

## By reason

**`ogv-sol-blocked` / `ogv-sol-gave_up` / `stuck-after-escalation`.** Sol could not finish.
1. Read every run summary, comment and the worker log tail. Look at the branch diff.
2. Decide which of these it is, and act:
   - **Card too big or wrong:** split it into smaller cards (same front-matter conventions as `docs/native-app/board/cards/`). Create them with `hermes kanban create ... --idempotency-key ogv-ios:<ID>a` and link them as parents of the original card's children. Archive the original with a comment explaining the split.
   - **Missing decision:** make it, write it into the card body (`hermes kanban edit`), comment, unblock.
   - **Environment problem** (Mac, credentials, approvals): fix it if it's in reach. Otherwise send an OWNER ASK.
   - **Real bug Sol couldn't crack:** you may fix it yourself in a worktree on Hermes, push to the card's branch, comment what you did, and send the card to review with `hermes kanban request-review <id> --reviewer ogv-reviewer --summary "..."`.

**`ogv-reviewer-blocked`.** The reviewer escalated. Read its reason and resolve as above.

**`owner-ask-review`.** A worker wrote "OWNER ASK:". Check it really needs the owner. If yes, forward it in the format below. If no, answer it yourself in a comment and unblock.

**`gate-ready`.** Run the gate card's checklist yourself, with commands. Then either:
- complete the gate (`hermes kanban complete <gate-id> --force --summary "..."`); or
- create fix cards, link them as parents of the gate, and leave it blocked.

Gates G1–G4 need the owner (a look choice or real rides). Send one OWNER ASK with exactly what to look at (attach images with `MEDIA:<path>`).

**`board-diagnostics`.** Something is stranded or stuck. Read the diagnostics and fix the cause: wrong assignee, missing profile, a dead dispatcher (`systemctl --user status hermes-gateway`).

**`mac-unreachable` / `mac-restored`.** Check Mac reachability and whether a wake attempt worked. If it is still down, leave Swift cards waiting and message the owner only when power, dock, or FileVault needs their action. When it returns, record that in the relevant blocked card or board summary.

## OWNER ASK format (the only way to message the owner)

```bash
ssh megaplex "pct exec 124 -- su claw -s /bin/bash -lc 'hermes send -t slack -s \"OpenGravel: needs you\" \"<message>\"'"
```

The message has 4 lines at most:
1. What is needed, in plain English (no code, no jargon).
2. Why it is blocking, and what is waiting on it.
3. Exactly what to do (where to click or what to answer).
4. The card id.

Batch questions. Never send more than one message per escalation.

## Rules

- Evidence over opinion. The gates and screenshots decide, not model reviews.
- Never raise SwiftLint limits. Never weaken a gate. Never add GPL code.
- Never merge a PR whose checks are failing.
- Finish by commenting a one-paragraph summary on the card (`--author opus-monitor`).
