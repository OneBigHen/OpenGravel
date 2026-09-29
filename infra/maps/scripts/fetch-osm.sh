#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/infra/maps/regions/pa-nj.env"

DATA_ROOT="${OGV_MAP_DATA_ROOT:-$ROOT/infra/maps/data}"
SOURCE_DIR="$DATA_ROOT/source"
mkdir -p "$SOURCE_DIR"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

need curl
need osmium

fetch() {
  local url="$1"
  local dest="$2"
  if [[ -f "$dest" && "${REFRESH:-0}" != "1" ]]; then
    echo "using existing $dest"
    return
  fi
  local tmp="$dest.part"
  rm -f "$tmp"
  echo "downloading $url"
  curl --fail --location --retry 4 --retry-delay 2 --continue-at - --output "$tmp" "$url"
  mv "$tmp" "$dest"
}

PA="$SOURCE_DIR/pennsylvania-latest.osm.pbf"
NJ="$SOURCE_DIR/new-jersey-latest.osm.pbf"
MERGED="$SOURCE_DIR/$REGION_ID.osm.pbf"

fetch "$OSM_URL_PA" "$PA"
fetch "$OSM_URL_NJ" "$NJ"

echo "merging PA + NJ -> $MERGED"
osmium merge --overwrite "$PA" "$NJ" -o "$MERGED"

echo "checking merged PBF"
osmium fileinfo "$MERGED" | sed -n '1,30p'
echo "ready: $MERGED"
