#!/usr/bin/env bash
set -euo pipefail
# Keep reusable exports and PBF intermediates on the bulk-data volume.
input=$1
output=$2
mkdir -p "$(dirname "$output")"
osmium tags-filter --overwrite -o "$output.osm.pbf" "$input" \
  nwr/natural=peak,water,cave_entrance,waterfall nwr/waterway=river,waterfall \
  nwr/tourism=viewpoint,camp_site,camp_pitch,wilderness_hut,alpine_hut \
  nwr/tower:type=observation,watchtower,fire nwr/historic \
  nwr/amenity=shelter,drinking_water,toilets,parking nwr/drinking_water=yes nwr/highway=trailhead \
  nwr/boundary=protected_area,national_park nwr/leisure=nature_reserve,park \
  nwr/place=city,town,village nwr/wikipedia nwr/wikidata
osmium export --overwrite --no-progress -f geojsonseq -a type,id -o "$output" "$output.osm.pbf"
