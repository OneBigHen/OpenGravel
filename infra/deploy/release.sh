#!/usr/bin/env bash
# Build and promote one immutable OpenGravel release on the production host.
#
# usage: infra/deploy/release.sh [git-ref]        (default: origin/main)
#        CANDIDATE_ONLY=1 infra/deploy/release.sh <ref>   build + leave the candidate running for QA
#
# 1. checks out <ref> into its own directory  $RELEASE_ROOT/og-release-<sha12>
# 2. npm ci + npm run build with the production environment (NEXT_PUBLIC_* are build-time)
# 3. starts the candidate on $CANDIDATE_PORT and smoke-checks it
# 4. points the systemd drop-in at the new directory, restarts, smoke-checks :$PORT
# The previous release directory is kept and recorded for infra/deploy/rollback.sh.
set -euo pipefail

REF=${1:-origin/main}
SOURCE_REPO=${SOURCE_REPO:-/root/Vibe/wt/og-public}
RELEASE_ROOT=${RELEASE_ROOT:-/root/Vibe/wt}
ENV_FILE=${ENV_FILE:-/etc/opengravel/ogv.env}
NODE_HOME=${NODE_HOME:-/opt/opengravel-node24}
SERVICE=${SERVICE:-ogv.service}
DROPIN=${DROPIN:-/etc/systemd/system/ogv.service.d/opengravel.conf}
STATE_DIR=${STATE_DIR:-/var/lib/opengravel}
PORT=${PORT:-3200}
CANDIDATE_PORT=${CANDIDATE_PORT:-3299}
PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-https://opengravel.henning.rodeo}
HERE=$(cd "$(dirname "$0")" && pwd)

export PATH="$NODE_HOME/bin:$PATH"
log() { printf '[release] %s\n' "$*"; }

git -C "$SOURCE_REPO" fetch -q origin
SHA=$(git -C "$SOURCE_REPO" rev-parse "$REF^{commit}")
DIR="$RELEASE_ROOT/og-release-${SHA:0:12}"
PREVIOUS=$(sed -n 's/^WorkingDirectory=//p' "$DROPIN" | tail -1)
log "ref $REF -> $SHA"
log "current release: ${PREVIOUS:-none}"

if [ ! -e "$DIR/.git" ]; then
  git -C "$SOURCE_REPO" worktree add -q --detach "$DIR" "$SHA"
fi
[ "$(git -C "$DIR" rev-parse HEAD)" = "$SHA" ] || { log "release dir $DIR is not at $SHA"; exit 1; }
[ -z "$(git -C "$DIR" status --porcelain --untracked-files=no)" ] || { log "release dir $DIR has local edits"; exit 1; }

cd "$DIR"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
export NODE_ENV=production OGV_BUILD_ID=$SHA

if [ ! -f .next/BUILD_ID ] || [ "$(cat .ogv-release-sha 2>/dev/null)" != "$SHA" ]; then
  log "npm ci"
  npm ci --include=dev --no-audit --no-fund >"$DIR/.ogv-npm.log" 2>&1 || { tail -30 "$DIR/.ogv-npm.log"; exit 1; }
  log "npm run build"
  NODE_OPTIONS=--max-old-space-size=3072 npm run build >"$DIR/.ogv-build.log" 2>&1 || { tail -40 "$DIR/.ogv-build.log"; exit 1; }
  echo "$SHA" >.ogv-release-sha
fi

log "candidate on :$CANDIDATE_PORT"
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port "$CANDIDATE_PORT" >"$DIR/.ogv-candidate.log" 2>&1 &
CANDIDATE=$!
trap 'kill $CANDIDATE 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:$CANDIDATE_PORT/api/health" 2>/dev/null && break
  sleep 1
done
"$HERE/smoke.sh" "http://127.0.0.1:$CANDIDATE_PORT" || { log "candidate smoke failed; production untouched"; tail -20 "$DIR/.ogv-candidate.log"; exit 1; }
if [ "${CANDIDATE_ONLY:-0}" = 1 ]; then
  trap - EXIT
  log "candidate left running for QA: http://127.0.0.1:$CANDIDATE_PORT (pid $CANDIDATE); production untouched"
  exit 0
fi
kill "$CANDIDATE" 2>/dev/null || true
wait "$CANDIDATE" 2>/dev/null || true
trap - EXIT

log "promote"
mkdir -p "$STATE_DIR"
[ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$DIR" ] && echo "$PREVIOUS" >"$STATE_DIR/previous-release"
cat >"$DROPIN" <<UNIT
[Service]
WorkingDirectory=$DIR
ExecStart=
ExecStart=$NODE_HOME/bin/node $DIR/node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port $PORT
Environment=OGV_BUILD_ID=$SHA
Environment=OGV_PUBLIC_ORIGIN=$PUBLIC_ORIGIN
UNIT
systemctl daemon-reload
systemctl restart "$SERVICE"
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/health" 2>/dev/null && break
  sleep 1
done
if ! "$HERE/smoke.sh" "http://127.0.0.1:$PORT"; then
  log "production smoke failed after promote; rolling back"
  "$HERE/rollback.sh"
  exit 1
fi
"$HERE/smoke.sh" "$PUBLIC_ORIGIN" || log "WARNING: public origin smoke failed (origin is up locally; check the tunnel/proxy)"
log "live: $SHA in $DIR (previous: ${PREVIOUS:-none})"
