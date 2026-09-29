#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/infra/maps/regions/pa-nj.env"

DATA_ROOT="${OGV_MAP_DATA_ROOT:-$ROOT/infra/maps/data}"
INPUT="$DATA_ROOT/source/$REGION_ID.osm.pbf"
OUT_DIR="$DATA_ROOT/out"
OUTPUT="$OUT_DIR/ogv-$REGION_ID-vector.pmtiles"

if [[ ! -f "$INPUT" ]]; then
  echo "missing $INPUT; run infra/maps/scripts/fetch-osm.sh first" >&2
  exit 1
fi

command -v docker >/dev/null 2>&1 || {
  echo "missing required command: docker" >&2
  exit 1
}

mkdir -p "$OUT_DIR"

# Planetiler's OpenMapTiles task downloads its Natural Earth/water auxiliaries
# into /data. Keeping /data persistent makes repeat builds substantially cheaper.
echo "building $OUTPUT with $PLANETILER_IMAGE ($PLANETILER_HEAP heap)"
docker run --rm   -e JAVA_TOOL_OPTIONS="-Xmx$PLANETILER_HEAP -XX:MaxHeapFreeRatio=40"   -v "$DATA_ROOT:/data"   "$PLANETILER_IMAGE"   --osm-path="/data/source/$REGION_ID.osm.pbf"   --output="/data/out/ogv-$REGION_ID-vector.pmtiles"   --maxzoom="$VECTOR_MAXZOOM"   --download   --force

echo "built:"
ls -lh "$OUTPUT"
