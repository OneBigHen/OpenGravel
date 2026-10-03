#!/usr/bin/env bash
# Smoke-check an OpenGravel origin: health, the main pages and the public JSON APIs.
# usage: infra/deploy/smoke.sh <origin>    e.g. http://127.0.0.1:3200
set -uo pipefail
ORIGIN=${1:?origin}
fail=0
check() {
  local path=$1 want=$2 code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$ORIGIN$path" || echo 000)
  if [ "$code" = "$want" ]; then printf '  ok   %s %s\n' "$code" "$path"; else printf '  FAIL %s %s (want %s)\n' "$code" "$path" "$want"; fail=1; fi
}
echo "[smoke] $ORIGIN"
check /api/health 200
check / 200
check /explore 200
check /ride 200
check /rides 200
check /settings 200
health=$(curl -sS --max-time 20 "$ORIGIN/api/health" || true)
case $health in
  *'"status"'*) ;;
  *) echo "  FAIL /api/health body has no status"; fail=1 ;;
esac
exit $fail
