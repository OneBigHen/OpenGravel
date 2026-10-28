#!/usr/bin/env bash
# Build a classpath overlay; the upstream jar and all rider files stay untouched.
set -euo pipefail
jar_path=${1:?usage: build-hike-snap.sh GRAPHOPPER_11_JAR OUTPUT_DIR}
out_dir=${2:?usage: build-hike-snap.sh GRAPHOPPER_11_JAR OUTPUT_DIR}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$out_dir/classes"
curl --fail --silent --show-error --location \
  https://raw.githubusercontent.com/graphhopper/graphhopper/69e50f6e2cfaf0a8e69752df9953ee5f1ac276a4/core/src/main/java/com/graphhopper/routing/ViaRouting.java \
  --output "$out_dir/ViaRouting.java"
echo "7f14d0ada5fcceb1f347542a289f1651e41b0df5cc01b2883bdab6ffff83a4c6  $out_dir/ViaRouting.java" | sha256sum --check --status
(cd "$out_dir" && patch --forward --fuzz=0 -p1 < "$script_dir/hike-snap.patch")
javac -cp "$jar_path" -d "$out_dir/classes" "$out_dir/ViaRouting.java"
jar --create --file "$out_dir/hike-snap.jar" -C "$out_dir/classes" .
