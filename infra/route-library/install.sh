#!/usr/bin/env bash
# Installs the scheduled ride-library refresh on the build host (run as root).
#
#   sudo infra/route-library/install.sh
#
# The timer is the schedule; the wrapper it runs is this checkout's
# infra/route-library/refresh-pack.sh. The build stays on this host (docker-dev)
# and publish-pack.sh copies the finished pack to docker-stable.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)

install -d /usr/local/lib/opengravel
install -m 0755 "$here/refresh-pack.sh" /usr/local/lib/opengravel/route-library-refresh.sh
sed "s|@REPO@|$repo|g" "$here/ogv-route-library-refresh.service" > /etc/systemd/system/ogv-route-library-refresh.service
install -m 0644 "$here/ogv-route-library-refresh.timer" /etc/systemd/system/ogv-route-library-refresh.timer

systemctl daemon-reload
systemctl enable --now ogv-route-library-refresh.timer
systemctl list-timers ogv-route-library-refresh.timer --no-pager

cat <<EOF

Installed. The unit rebuilds from:
  \${OGV_ROUTE_LIBRARY_DIR:-/root/Vibe/og-route-library-national}
into:
  \${OGV_ROUTE_LIBRARY_OUT:-/root/Vibe/opengravel-data/route-library-build}

Try a build without publishing:
  /usr/local/lib/opengravel/route-library-refresh.sh

A same-day takedown:
  node --import tsx scripts/route-library/takedown.ts <id> --library /root/Vibe/og-route-library-national --reason "why"
  sudo systemctl start ogv-route-library-refresh.service

Pause the schedule:
  sudo systemctl disable --now ogv-route-library-refresh.timer
EOF
