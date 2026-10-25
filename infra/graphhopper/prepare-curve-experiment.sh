#!/usr/bin/env bash
set -euo pipefail
# POWERPLEX ONLY. Creates experiment assets; never starts, stops, copies to, or inspects a live service.
# Usage: prepare-curve-experiment.sh ~/ghbuild ~/ghbuild-curve-<run>
source_root=$(realpath "${1:?existing powerplex ghbuild directory}")
output_root=$(realpath -m "${2:?NEW experiment directory on powerplex data disk}")
case "$output_root/" in "$source_root/"*) echo "Output must be outside source directory" >&2; exit 1;; esac
assets=$(cd "$(dirname "$0")" && pwd)
[[ "$source_root" != "$output_root" && ! -e "$output_root" ]] || { echo 'Output must be new and separate' >&2; exit 1; }
[[ -f "$source_root/graph-cache/properties" && -f "$source_root/pa-nj-motorcycle.osm.pbf" ]] || { echo 'Missing powerplex control graph/extract' >&2; exit 1; }
mkdir -p "$output_root/control"
cp -a "$source_root/graph-cache" "$source_root/custom-models" "$output_root/control/"
cp "$source_root/config.yml" "$output_root/control/config.yml"
cp "$assets/config-curve.yml" "$output_root/config.yml"
cp -a "$assets/custom-models" "$output_root/"
ln -s "$source_root/pa-nj-motorcycle.osm.pbf" "$output_root/pa-nj-motorcycle.osm.pbf"
ln -s "$source_root/graphhopper-web-11.0.jar" "$output_root/graphhopper-web-11.0.jar"
"$assets/ext/build.sh" "$source_root/graphhopper-web-11.0.jar"
cp "$assets/ext/target/og-curve-gh11.jar" "$output_root/og-curve-gh11.jar"
(cd "$output_root"; sha256sum graphhopper-web-11.0.jar og-curve-gh11.jar pa-nj-motorcycle.osm.pbf config.yml custom-models/*.json > inputs.sha256)
(cd "$output_root/control"; sha256sum graph-cache/* custom-models/*.json config.yml > ../control.sha256)
cat <<EOF_COMMANDS
Prepared only. On powerplex, run:
cd '$output_root'
python3 -m venv curve-venv
curve-venv/bin/pip install -r '$assets/ext/preprocess/requirements.txt'
curve-venv/bin/python -m unittest discover -s '$assets/ext/preprocess' -v
curve-venv/bin/python '$assets/ext/preprocess/curve.py' pa-nj-motorcycle.osm.pbf pa-nj-og-curve.osm.pbf
sha256sum pa-nj-og-curve.osm.pbf > preprocessed.sha256
java -Xmx16g -XX:ActiveProcessorCount=6 -cp og-curve-gh11.jar:graphhopper-web-11.0.jar rodeo.opengravel.graphhopper.Import config.yml
java -Xmx6g -XX:ActiveProcessorCount=4 -jar graphhopper-web-11.0.jar server config.yml
# In a second terminal; unchanged control graph, copied into this experiment:
cd '$output_root/control'
java -Xmx6g -XX:ActiveProcessorCount=4 -jar ../graphhopper-web-11.0.jar server config.yml
EOF_COMMANDS
