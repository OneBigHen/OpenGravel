#!/usr/bin/env bash
# Point production back at the previous release directory recorded by release.sh.
# No rebuild: the previous directory keeps its node_modules and .next build.
#
# usage: infra/deploy/rollback.sh [release-dir]
set -euo pipefail

SERVICE=${SERVICE:-ogv.service}
DROPIN=${DROPIN:-/etc/systemd/system/ogv.service.d/opengravel.conf}
STATE_DIR=${STATE_DIR:-/var/lib/opengravel}
NODE_HOME=${NODE_HOME:-/opt/opengravel-node24}
PORT=${PORT:-3200}
PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-https://opengravel.henning.rodeo}
HERE=$(cd "$(dirname "$0")" && pwd)

TARGET=${1:-$(cat "$STATE_DIR/previous-release" 2>/dev/null || true)}
[ -n "$TARGET" ] && [ -f "$TARGET/.next/BUILD_ID" ] || { echo "[rollback] no built release to return to (${TARGET:-unset})"; exit 1; }
CURRENT=$(sed -n 's/^WorkingDirectory=//p' "$DROPIN" | tail -1)
SHA=$(git -C "$TARGET" rev-parse HEAD)

cat >"$DROPIN" <<UNIT
[Service]
WorkingDirectory=$TARGET
ExecStart=
ExecStart=$NODE_HOME/bin/node $TARGET/node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port $PORT
Environment=OGV_BUILD_ID=$SHA
Environment=OGV_PUBLIC_ORIGIN=$PUBLIC_ORIGIN
UNIT
[ -n "$CURRENT" ] && [ "$CURRENT" != "$TARGET" ] && echo "$CURRENT" >"$STATE_DIR/previous-release"
systemctl daemon-reload
systemctl restart "$SERVICE"
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/health" 2>/dev/null && break
  sleep 1
done
"$HERE/smoke.sh" "http://127.0.0.1:$PORT"
echo "[rollback] live: $SHA in $TARGET"
