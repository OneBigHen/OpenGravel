#!/usr/bin/env bash
# Start the v2 router from a build folder, detached: 127.0.0.1:8989 (admin 8990), -Xmx4g, as production.
# Refuses when the port is taken: it never stops a process it did not start. Stop it with: kill "$(cat BUILD_DIR/server.pid)"
set -euo pipefail
build_dir=$(cd -- "${1:?usage: serve-v2.sh BUILD_DIR}" && pwd)
cd "$build_dir"
if (exec 3<>/dev/tcp/127.0.0.1/8989) 2>/dev/null; then
  echo "refusing: something already listens on 127.0.0.1:8989" >&2
  exit 1
fi
setsid nohup java -Xmx4g -cp og-ext/og-ext.jar:graphhopper-web-11.0.jar \
  com.graphhopper.application.GraphHopperApplication server config-v2.yml > server.log 2>&1 < /dev/null &
echo $! > server.pid
started=$(date +%s)
until curl -sf http://127.0.0.1:8989/health > /dev/null; do
  if ! kill -0 "$(cat server.pid)" 2>/dev/null; then echo "server exited; see server.log" >&2; exit 1; fi
  sleep 1
done
echo "v2 router up on 127.0.0.1:8989 (pid $(cat server.pid)) after $(( $(date +%s) - started )) s"
