#!/usr/bin/env bash
# Delete old release directories so the production disk never fills up.
# Each release is a ~0.9 GB worktree; nine of them filled the 52 GB root once
# and the next build died in `npm ci` with ENOSPC.
#
# usage: infra/deploy/prune.sh [keep-dir…]
#
# Always kept: the live release (systemd drop-in), the rollback target
# (previous-release), every keep-dir argument, any release a running process
# uses (e.g. a QA candidate), and the KEEP_EXTRA_RELEASES newest others.
set -euo pipefail

SOURCE_REPO=${SOURCE_REPO:-/root/Vibe/wt/og-public}
RELEASE_ROOT=${RELEASE_ROOT:-/root/Vibe/wt}
DROPIN=${DROPIN:-/etc/systemd/system/ogv.service.d/opengravel.conf}
STATE_DIR=${STATE_DIR:-/var/lib/opengravel}
KEEP_EXTRA_RELEASES=${KEEP_EXTRA_RELEASES:-1}
DRY_RUN=${DRY_RUN:-0}
log() { printf '[prune] %s\n' "$*"; }

declare -A keep=()
live=$(sed -n 's/^WorkingDirectory=//p' "$DROPIN" 2>/dev/null | tail -1 || true)
previous=$(cat "$STATE_DIR/previous-release" 2>/dev/null || true)
for dir in "$live" "$previous" "$@"; do
  if [ -n "$dir" ]; then keep["${dir%/}"]=1; fi
done

in_use() {
  # A release is in use when a running process works inside it: the candidate
  # starts `next` from the release directory with a relative path.
  local dir=$1 cwd
  for cwd in /proc/[0-9]*/cwd; do
    case "$(readlink "$cwd" 2>/dev/null)/" in "$dir"/*) return 0 ;; esac
  done
  return 1
}

extra=0
# Newest first, so the extra releases kept are the most recent ones.
while IFS= read -r dir; do
  dir=${dir%/}
  if [ -n "${keep[$dir]:-}" ]; then
    log "keep $dir"
    continue
  fi
  if in_use "$dir"; then
    log "keep $dir (in use)"
    continue
  fi
  if [ "$extra" -lt "$KEEP_EXTRA_RELEASES" ]; then
    extra=$((extra + 1))
    log "keep $dir (recent)"
    continue
  fi
  if [ "$DRY_RUN" = 1 ]; then
    log "would remove $dir"
    continue
  fi
  log "remove $dir"
  git -C "$SOURCE_REPO" worktree remove --force "$dir" 2>/dev/null || rm -rf "$dir"
done < <(ls -1dt "$RELEASE_ROOT"/og-release-* 2>/dev/null || true)

git -C "$SOURCE_REPO" worktree prune 2>/dev/null || true
