# Running the iPhone build on the Hermes kanban board

This folder turns [PLAN.md](../PLAN.md), [SPEC.md](../SPEC.md) and [ENGINEERING.md](../ENGINEERING.md) into cards on a dedicated Hermes board. The board is `opengravel-ios`.

## One-time setup (on Hermes, user `claw`)

```bash
cd /mnt/hermes-bulk/ogv/OpenGravel 2>/dev/null || git clone https://github.com/OneBigHen/OpenGravel.git /mnt/hermes-bulk/ogv/OpenGravel
cd /mnt/hermes-bulk/ogv/OpenGravel && git pull --ff-only
bash docs/native-app/board/setup.sh            # profiles, board, project (idempotent)
bash docs/native-app/board/setup.sh --parallel # optional: allow 3 cards at once, 2 per profile
python3 docs/native-app/board/load_board.py --dry-run   # print what would be created
python3 docs/native-app/board/load_board.py             # create the cards (idempotent)
```

Re-running the loader is safe. Each card has the idempotency key `ogv-ios:<ID>`, so existing cards are returned instead of duplicated. To change a card that already exists, edit it on the board (`hermes kanban edit`) or archive it and reload.

## Who does what

| Assignee | Model | Used for |
|---|---|---|
| `ogv-builder` | DeepSeek V4.1 Flash (`commandcode`) | most implementation cards |
| `ogv-sol` | Codex gpt-6.1-sol | hard cards: scaffold, mac-gate, contract, map, Ferrostar, riding screen |
| `ogv-reviewer` | Codex gpt-6.1-sol, read-and-merge | same-card review of every PR (bundled `sdlc-review` skill), squash-merge on approval |
| none (blocked cards `G*`, `F00`, `T01`) | owner or Opus monitor | phase gates and owner actions |

If Codex quota runs out, the profiles fall back to their configured fallback chain (DeepSeek first). Nothing else to do.

## Card flow

```
todo ──(parents done)──► ready ──► running (worktree ogv/<ID>-slug)
   └► review (ogv-reviewer: gates + screenshots vs SPEC) ──approve──► merge PR ──► done
                                                        └─changes──► back to the builder
```

- Code cards carry `--completion-contract OneBigHen/OpenGravel`, so a card cannot be completed without a published PR whose CI checks have passed.
- A child card starts only when every parent is **done**, which means merged. That keeps `main` as the base for every card.
- **Gate cards (`G0`–`G4`) start blocked.** Nothing behind a gate runs until the gate is completed by hand. Close a gate when its checklist is met:
  ```bash
  hermes kanban --board opengravel-ios complete <gate-task-id> --summary "Gate G1 passed: owner picked look B and map style 2" --force
  ```
- **Owner cards (`F00`, `T01`)** start blocked. Complete them the same way once done.

## The Opus monitor's routine

1. Watch the board:
   - `hermes kanban --board opengravel-ios list`
   - `hermes kanban --board opengravel-ios diagnostics`
   - or the dashboard: `hermes dashboard`, port 9119.
2. Spot-check merged PRs. Read the diff and the screenshots against SPEC.md. If something is wrong, create a fix card:
   ```bash
   hermes kanban --board opengravel-ios create "FIX: <what>" --assignee ogv-builder --project opengravel --workspace worktree \
     --completion-contract OneBigHen/OpenGravel --body-file fix.md
   ```
3. At each gate, run through the gate card's checklist, then complete the gate, or add fix cards as its parents and leave it blocked.
4. When a card blocks with `needs_input`, answer in a card comment, then `hermes kanban --board opengravel-ios unblock <id>`.
5. When the same card fails twice, re-scope it: split it, or move it to `ogv-sol` with `hermes kanban reassign`.

## Parallelism and the Mac

- The board allows 2 cards in progress by default (`kanban.max_in_progress`), 1 per profile. `setup.sh --parallel` raises this to 3 overall and 2 per profile. Don't go higher: Swift checks queue on one Mac.
- `mac-gate` serializes Mac jobs with a lock. A job waiting for the lock is normal, not a failure.

## Files

- `setup.sh`: creates the profiles, the board and the project. Idempotent.
- `load_board.py`: creates the cards from `cards/*.md`. The front matter keys are:
  - `id`, `title`, `assignee`;
  - `parents` (list of card ids);
  - `priority`;
  - `max_runtime`;
  - `blocked` (true/false);
  - `contract` (`pr` / `local`);
  - `skills` (list).
- `cards/`: one Markdown file per card. The body after the front matter is the card's opening post.
