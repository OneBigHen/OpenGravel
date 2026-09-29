#!/usr/bin/env bash
# Builds $OUT/osm-places.json for Discover from per-state OSM extracts.
# Usage: build-osm-places.sh OUT_DIR state1.osm.pbf [state2.osm.pbf …]
# Each state file is filtered separately: a merged multi-state extract carries
# duplicate objects, which osmium export refuses.
set -euo pipefail
OUT=$1; shift
mkdir -p "$OUT"
HERE=$(cd "$(dirname "$0")" && pwd)
SEQS=()
for PBF in "$@"; do
  NAME=$(basename "$PBF" .osm.pbf)
  osmium tags-filter -O -o "$OUT/$NAME-interesting.osm.pbf" "$PBF" \
    nwr/tourism=attraction,viewpoint,museum,artwork,picnic_site,camp_site,gallery \
    nwr/waterway=waterfall nwr/natural=waterfall,cave_entrance,peak,arch,rock,stone,spring \
    nwr/historic nwr/man_made=tower,lighthouse,observatory,windmill,watermill \
    nwr/bridge=covered nwr/covered=yes nwr/leisure=nature_reserve,park \
    nwr/highway=trailhead nwr/amenity=ferry_terminal nwr/boundary=protected_area
  osmium export -O -f geojsonseq --geometry-types=point,polygon,linestring -a type,id \
    -o "$OUT/$NAME.geojsonseq" "$OUT/$NAME-interesting.osm.pbf"
  SEQS+=("$OUT/$NAME.geojsonseq")
done
node "$HERE/build-osm-places.mjs" "$OUT/osm-places.json.tmp" "${SEQS[@]}"
mv "$OUT/osm-places.json.tmp" "$OUT/osm-places.json"
