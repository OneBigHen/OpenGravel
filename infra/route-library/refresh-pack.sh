#!/usr/bin/env bash
# Rebuilds the national ride library pack and, with --publish, hands a changed
# pack to publish-pack.sh. This is what the scheduled unit runs, and what a
# person runs by hand after a takedown. It never publishes when the pack is
# unchanged, and it refuses to run two builds at once (exit 75 = locked).
#
#   infra/route-library/refresh-pack.sh [--publish]
#
# Environment:
#   OGV_REPO_DIR                  the checkout that owns node_modules (the unit sets it)
#   OGV_ROUTE_LIBRARY_DIR         the library (default /root/Vibe/og-route-library-national)
#   OGV_ROUTE_LIBRARY_OUT         built packs (default /root/Vibe/opengravel-data/route-library-build)
#   OGV_ROUTE_LIBRARY_PUBLISH=0   build only; never publish (kill switch)
#   OGV_ROUTE_LIBRARY_KEEP        packs to keep in OUT (default 3)
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=${OGV_REPO_DIR:-$(cd "$here/../.." && pwd)}
library=${OGV_ROUTE_LIBRARY_DIR:-/root/Vibe/og-route-library-national}
out=${OGV_ROUTE_LIBRARY_OUT:-/root/Vibe/opengravel-data/route-library-build}
keep=${OGV_ROUTE_LIBRARY_KEEP:-3}

publish=()
case "${1:-}" in
  "") ;;
  --publish) publish=(--publish) ;;
  *) echo "Usage: $0 [--publish]" >&2; exit 2 ;;
esac

if [[ ! -d "$library/routes" ]]; then
  echo "No library at $library (set OGV_ROUTE_LIBRARY_DIR)." >&2
  exit 2
fi
if [[ ! -d "$repo/node_modules" ]]; then
  echo "No node_modules in $repo (run npm ci there)." >&2
  exit 2
fi

mkdir -p "$out"
cd "$repo"
exec node --max-old-space-size=512 --import tsx scripts/route-library/refresh-pack.ts \
  --library "$library" \
  --out "$out" \
  --keep "$keep" \
  "${publish[@]}"
