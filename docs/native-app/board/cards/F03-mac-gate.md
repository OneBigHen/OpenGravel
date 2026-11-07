---
id: F03
title: mac-gate: run Swift gates on the Mac from Hermes
assignee: ogv-sol
parents: [F01, F02]
priority: 90
max_runtime: 3h
---
# F03 · `mac-gate`

## Read first
ENGINEERING §6 and §8, `docs/native-app/MAC-RIG.md` (from F01), `apps/iphone/scripts/gate.sh` (from F02).

## Goal
Any worker on Hermes can run `mac-gate <branch> [--snapshots] [--ui] [--maestro] [--replay] [--record-snapshots]` and get a pass or fail, logs, failing snapshot diffs and screenshots back into its workspace. Mac jobs never overlap.

## Build
- `tools/mac-gate/mac-gate` (bash) in the repo, installed to Hermes `~/bin/mac-gate` by `tools/mac-gate/install.sh`. Steps:
  1. `ssh macbook`, wrapped in `~/bin/wake-mac.py --timeout 60` first.
  2. Take the lock on the Mac with `mkdir ~/dev/ogv-gate/.lock` (macOS has no `flock`). It holds the PID, branch and start time, and waits up to 45 min polling every 15 s. A stale lock (PID gone or older than 90 min) is broken and logged.
  3. Fetch: `~/dev/ogv-gate/repo` is a clone over https, `git fetch origin <branch> && git checkout -f FETCH_HEAD && git clean -fdx apps/iphone`.
  4. Run `apps/iphone/scripts/gate.sh --mac <flags>` with `nohup`, polling a status file so a dropped SSH session does not kill it (the Intel Mac can fall off the network under load).
  5. Copy back: `results/summary.txt`, the failing tests list, `__Snapshots__` failure diffs, `screenshots/*.png`, the Maestro report. They go to `${HERMES_KANBAN_WORKSPACE:-$PWD}/mac-gate/<timestamp>/`.
  6. Release the lock even on failure (trap). Exit code equals the gate result.
- `--record-snapshots` runs `scripts/record-snapshots.sh` and copies the new reference images back so the worker can commit them.
- `--install-iphone` (used by S07): build Debug for a device and install it on the owner's iPhone with the existing free-signing flow. Reuse what `~/dev/opengravel/ogv-resign.sh` does; don't duplicate keychain logic. It requires the owner's phone to be connected and unlocked, and fails clearly if it isn't.
- Logs: `~/dev/ogv-gate/logs/<timestamp>-<branch>.log` on the Mac, keeping the last 50.

## Acceptance checks
- [ ] `mac-gate main` passes and returns a summary and a screenshot. Paste the summary.
- [ ] Two `mac-gate` runs started 5 s apart: the second waits for the lock, then runs. Show both logs.
- [ ] Killing the SSH session mid-build does not kill the build. The rerun picks up the finished status.
- [ ] A failing test branch returns a non-zero exit and the failing test name.

## Out of scope
Snapshot helpers and Maestro flows themselves (F05). GPX replay (S06).
