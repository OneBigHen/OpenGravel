#!/usr/bin/env bash
# Build a regional Overture rider-destination index.
#
# Requires DuckDB with spatial + httpfs extensions available.
# Usage:
#   build-overture-places.sh OUT_DIR WEST SOUTH EAST NORTH
#
# The release is intentionally pinned because Overture's Places schema changed
# in September 2026. Bump OVERTURE_RELEASE and review the parser together.
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "usage: $0 OUT_DIR WEST SOUTH EAST NORTH" >&2
  exit 2
fi

OUT=$1
WEST=$2
SOUTH=$3
EAST=$4
NORTH=$5
RELEASE=${OVERTURE_RELEASE:-2026-09-23.1}
SCHEMA=${OVERTURE_SCHEMA:-v2.0.0}
HERE=$(cd "$(dirname "$0")" && pwd)

mkdir -p "$OUT"
RAW="$OUT/overture-places.geojsonseq"
TMP="$OUT/overture-places.json.tmp"
FINAL="$OUT/overture-places.json"

duckdb <<SQL
INSTALL spatial;
INSTALL httpfs;
LOAD spatial;
LOAD httpfs;
SET s3_region='us-west-2';

COPY (
  SELECT
    id,
    names.primary AS name,
    basic_category,
    CAST(taxonomy AS JSON) AS taxonomy,
    confidence,
    CAST(websites AS JSON) AS websites,
    geometry
  FROM read_parquet(
    's3://overturemaps-us-west-2/release/$RELEASE/theme=places/type=place/*',
    filename=true,
    hive_partitioning=1
  )
  WHERE
    names.primary IS NOT NULL
    AND confidence >= 0.50
    AND bbox.xmin BETWEEN $WEST AND $EAST
    AND bbox.ymin BETWEEN $SOUTH AND $NORTH
) TO '$RAW' WITH (FORMAT GDAL, DRIVER 'GeoJSONSeq', SRS 'EPSG:4326');
SQL

node "$HERE/build-overture-places.mjs" "$TMP" "$RELEASE" "$SCHEMA" "$RAW"
mv "$TMP" "$FINAL"
echo "Built $FINAL"
