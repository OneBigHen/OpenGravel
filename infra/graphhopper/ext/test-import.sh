#!/usr/bin/env bash
set -euo pipefail
# Small end-to-end GH test. Like every GraphHopper build in this task, run on powerplex.
jar_path=$(realpath "${1:?GH 11 jar}")
python_arg=${2:?curve-venv/bin/python}
python_path=$(cd "$(dirname "$python_arg")" && pwd)/$(basename "$python_arg")
assets=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d /tmp/og-curve-import-test.XXXXXXXX)
trap 'rm -rf -- "$tmp"' EXIT
"$python_path" "$assets/preprocess/curve.py" "$assets/fixtures/tiny.osm" "$tmp/curve.osm.pbf"
"$python_path" - "$assets" "$tmp" <<'PY'
from pathlib import Path
import sys
assets,tmp=map(Path,sys.argv[1:])
s=(assets.parent/'config-curve.yml').read_text()
s=s.replace('datareader.file: pa-nj-og-curve.osm.pbf',f'datareader.file: {tmp}/curve.osm.pbf')
s=s.replace('graph.location: graph-cache-og-curve',f'graph.location: {tmp}/graph')
s=s.replace('custom_models.directory: custom-models',f'custom_models.directory: {assets.parent}/custom-models')
s=s.replace('profiles_ch: []','profiles_ch:\n    - profile: motorcycle_twisty')
s=s.replace('prepare.min_network_size: 100','prepare.min_network_size: 0\n  prepare.lm.min_network_size: 2')
(tmp/'config.yml').write_text(s)
PY
"$assets/build.sh" "$jar_path"
java -Xmx1g -XX:ActiveProcessorCount=2 -cp "$assets/target/og-curve-gh11.jar:$jar_path" rodeo.opengravel.graphhopper.Import "$tmp/config.yml"
OG_CURVE_TEST_CONFIG="$tmp/config.yml" "$assets/build.sh" "$jar_path"
java -Xmx1g -XX:ActiveProcessorCount=2 -cp "$assets/target/og-curve-gh11.jar:$jar_path" rodeo.opengravel.graphhopper.Audit "$tmp/config.yml"
if java -Xmx1g -cp "$assets/target/og-curve-gh11.jar:$jar_path" rodeo.opengravel.graphhopper.Import "$tmp/config.yml" > "$tmp/reimport.log" 2>&1; then
  echo 'FAIL: importer accepted an existing graph' >&2; exit 1
fi
echo 'PASS: existing graph overwrite refused'
