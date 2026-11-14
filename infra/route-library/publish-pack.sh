#!/usr/bin/env bash
# Publishes a built ride-library pack to production data storage.
#
#   infra/route-library/publish-pack.sh <route-library-VERSION.sqlite> [--dry-run]
#
# Copies the pack to docker-stable under /root/Vibe/opengravel-data/route-library/,
# checks the copy's checksum, points current.sqlite at it (the app reopens the
# file by itself, no restart), keeps ONE previous pack for rollback, and asks the
# live manifest what it now serves. --dry-run prints every step and changes nothing.
#
# Only the owner approves a publish. Rollback = repoint current.sqlite at the
# previous pack (printed at the end); it never needs a code release.
set -euo pipefail

PACK="${1:-}"
DRY_RUN=0
[[ "${2:-}" == "--dry-run" || "${1:-}" == "--dry-run" ]] && DRY_RUN=1
[[ "${PACK}" == "--dry-run" ]] && PACK="${2:-}"

HOST="${PUBLISH_HOST:-docker-stable}"
DEST="${PUBLISH_DIR:-/root/Vibe/opengravel-data/route-library}"
MANIFEST_URL="${MANIFEST_URL:-https://opengravel.henning.rodeo/api/route-library/manifest}"

if [[ -z "${PACK}" || ! -f "${PACK}" ]]; then
  echo "Usage: $0 <route-library-VERSION.sqlite> [--dry-run]" >&2
  exit 2
fi

NAME="$(basename "${PACK}")"
if [[ ! "${NAME}" =~ ^route-library-[0-9a-f]{12}\.sqlite$ ]]; then
  echo "Refusing ${NAME}: a published pack is named route-library-<12 hex>.sqlite (build it with build-pack.ts)." >&2
  exit 2
fi
VERSION="${NAME#route-library-}"
VERSION="${VERSION%.sqlite}"

# The pack must say it is that version before it goes anywhere.
INSIDE="$(node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1], { readOnly: true });
const row = db.prepare("SELECT value FROM meta WHERE key = ?").get("version");
process.stdout.write(row ? row.value : "");
' "${PACK}")"
if [[ "${INSIDE}" != "${VERSION}" ]]; then
  echo "The pack says version '${INSIDE}' but its file name says '${VERSION}'. Stopping." >&2
  exit 1
fi

SUM="$(sha256sum "${PACK}" | cut -d' ' -f1)"
SIZE="$(stat -c %s "${PACK}")"
echo "Pack ${NAME}: ${SIZE} bytes, sha256 ${SUM}"
[[ "${DRY_RUN}" == "1" ]] && echo "DRY RUN: nothing below is executed." || true

run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '  would run: %s\n' "$*"
  else
    "$@"
  fi
}
remote() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '  would run on %s: %s\n' "${HOST}" "$1"
  else
    ssh "${HOST}" "$1"
  fi
}

echo "1. Copy to ${HOST}:${DEST}"
remote "mkdir -p '${DEST}'"
run rsync --partial --inplace "${PACK}" "${HOST}:${DEST}/${NAME}.part"

echo "2. Verify the copy's checksum"
if [[ "${DRY_RUN}" == "1" ]]; then
  printf '  would compare sha256sum of %s/%s.part with %s\n' "${DEST}" "${NAME}" "${SUM}"
else
  REMOTE_SUM="$(ssh "${HOST}" "sha256sum '${DEST}/${NAME}.part'" | cut -d' ' -f1)"
  if [[ "${REMOTE_SUM}" != "${SUM}" ]]; then
    ssh "${HOST}" "rm -f '${DEST}/${NAME}.part'"
    echo "Checksum mismatch (${REMOTE_SUM}); the copy was removed. Nothing was switched." >&2
    exit 1
  fi
  echo "  checksum matches"
fi
remote "mv '${DEST}/${NAME}.part' '${DEST}/${NAME}'"

echo "3. Switch current.sqlite (keeping the pack it pointed at as the one previous pack)"
SWITCH="cd '${DEST}' && PREVIOUS=\$(readlink current.sqlite || true) && ln -sfn '${NAME}' current.sqlite.new && mv -T current.sqlite.new current.sqlite && echo \"previous: \${PREVIOUS:-none}\" && for f in route-library-*.sqlite; do [ \"\$f\" = '${NAME}' ] || [ \"\$f\" = \"\$PREVIOUS\" ] || rm -f -- \"\$f\"; done"
remote "${SWITCH}"

echo "4. Ask the live manifest what it serves"
if [[ "${DRY_RUN}" == "1" ]]; then
  printf '  would run: curl -fsS %s\n' "${MANIFEST_URL}"
else
  sleep 2
  curl -fsS "${MANIFEST_URL}" || { echo; echo "The manifest did not answer. Roll back: ssh ${HOST} \"cd ${DEST} && ln -sfn <previous pack> current.sqlite\"" >&2; exit 1; }
  echo
fi
echo "Done. Rollback: ssh ${HOST} \"cd ${DEST} && ln -sfn <previous pack named above> current.sqlite\""
