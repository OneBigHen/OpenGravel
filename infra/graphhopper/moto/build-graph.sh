#!/usr/bin/env bash
# Build the motorcycle router v2 graph (ROUTING-MASTER.md section 5, steps 1 to 3) in a NEW folder.
#
#   build-graph.sh BUILD_DIR            extension + import; writes import.log, gc.log, SHA256SUMS, build-summary.txt
#   build-graph.sh BUILD_DIR --serve    afterwards, start the v2 router detached on 127.0.0.1:8989 (-Xmx4g)
#
# Inputs (override with env): GH_JAR=~/ghbuild/graphhopper-web-11.0.jar, OSM_PBF=~/ghbuild/pa-nj-motorcycle.osm.pbf
# (the same jar and map file production imported). IMPORT_HEAP=12g. The upstream jar is never modified.
# Run it detached (nohup/setsid) so a dropped ssh does not kill the import.
set -euo pipefail
build_dir=${1:?usage: build-graph.sh BUILD_DIR [--serve]}
serve=${2:-}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
gh_jar=${GH_JAR:-$HOME/ghbuild/graphhopper-web-11.0.jar}
osm_pbf=${OSM_PBF:-$HOME/ghbuild/pa-nj-motorcycle.osm.pbf}
heap=${IMPORT_HEAP:-12g}

if [ -e "$build_dir/graph-cache-v2" ]; then
  echo "refusing: $build_dir/graph-cache-v2 already exists (use a new folder)" >&2
  exit 1
fi
mkdir -p "$build_dir"
build_dir=$(cd -- "$build_dir" && pwd)
cd "$build_dir"
summary="$build_dir/build-summary.txt"
note() { echo "$*" | tee -a "$summary"; }
: > "$summary"
note "build started $(date -u +%FT%TZ) on $(hostname), $(nproc) cores, git $(git -C "$script_dir" rev-parse --short HEAD 2>/dev/null || echo unknown)"

# Inputs: same jar and map file as production; recorded by hash.
cp "$gh_jar" graphhopper-web-11.0.jar
ln -sf "$osm_pbf" pa-nj-motorcycle.osm.pbf
note "jar $(sha256sum graphhopper-web-11.0.jar | cut -d' ' -f1)"
note "map $(sha256sum -L "$osm_pbf" 2>/dev/null | cut -d' ' -f1 || sha256sum "$osm_pbf" | cut -d' ' -f1) $(stat -L -c %s "$osm_pbf") bytes"
cp "$script_dir/config-v2.yml" config-v2.yml
mkdir -p custom-models
cp "$script_dir"/custom-models/*.json custom-models/

# 1. extension
"$script_dir/build-og-ext.sh" "$build_dir/graphhopper-web-11.0.jar" "$build_dir/og-ext" | tee -a "$summary"
classpath="og-ext/og-ext.jar:graphhopper-web-11.0.jar"

# 2. import
started=$(date +%s)
set +e
/usr/bin/time -v -o import.time java -Xms4g "-Xmx$heap" -XX:+UseParallelGC "-Xlog:gc:file=gc.log" \
  -cp "$classpath" com.graphhopper.application.GraphHopperApplication import config-v2.yml > import.log 2>&1
status=$?
set -e
seconds=$(( $(date +%s) - started ))
note "import exit $status in ${seconds} s"
if [ "$status" -ne 0 ] || grep -q -E 'Exception|^ERROR' import.log; then
  note "import FAILED: see import.log"
  grep -n -E 'Exception|^ERROR' import.log | head -20 | tee -a "$summary"
  exit 1
fi
note "peak RSS $(awk -F': ' '/Maximum resident set size/ {printf "%.2f GB", $2/1048576}' import.time)"
# Largest heap in use before any collection, from the GC log ("Pause ... 3000M->500M(12000M)").
note "peak heap $(grep -o '[0-9]*M->[0-9]*M' gc.log | cut -d'M' -f1 | sort -n | tail -1) MB (largest heap before a collection, gc.log)"
grep -E 'og_curve:|og_through:|og: ' import.log | sed 's/^.*\] //' | tee -a "$summary"

# 3. record the graph
(cd graph-cache-v2 && sha256sum -- * > ../SHA256SUMS)
note "graph $(du -sb graph-cache-v2 | cut -f1) bytes; turn_costs $(stat -c %s graph-cache-v2/turn_costs) bytes"
note "build finished $(date -u +%FT%TZ)"

if [ "$serve" = "--serve" ]; then
  "$script_dir/serve-v2.sh" "$build_dir"
fi
