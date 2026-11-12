#!/usr/bin/env bash
# Build og-ext.jar: a classpath overlay that makes the GraphHopper 11.0 server and importer use
# OgGraphHopper (og_curve, og_through, og_through_street). The upstream jar is never modified.
# Usage: build-og-ext.sh GRAPHHOPPER_11_JAR OUTPUT_DIR
set -euo pipefail
jar_path=${1:?usage: build-og-ext.sh GRAPHHOPPER_11_JAR OUTPUT_DIR}
out_dir=${2:?usage: build-og-ext.sh GRAPHHOPPER_11_JAR OUTPUT_DIR}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$out_dir"
out_dir=$(cd -- "$out_dir" && pwd)
classes="$out_dir/classes-$(date +%s)"
mkdir "$classes"
curl --fail --silent --show-error --location \
  https://raw.githubusercontent.com/graphhopper/graphhopper/69e50f6e2cfaf0a8e69752df9953ee5f1ac276a4/web-bundle/src/main/java/com/graphhopper/http/GraphHopperManaged.java \
  --output "$out_dir/GraphHopperManaged.java"
echo "a1d9152f2c78374fb8d5984e04e21cb73decdec618753ac1e69e740b778fad3f  $out_dir/GraphHopperManaged.java" | sha256sum --check --status
(cd "$out_dir" && patch --forward --fuzz=0 -p1 < "$script_dir/ext/GraphHopperManaged.patch")
mapfile -t sources < <(find "$script_dir/ext/src" -name '*.java' | sort)
javac --release 17 -cp "$jar_path" -d "$classes" "$out_dir/GraphHopperManaged.java" "${sources[@]}" "$script_dir/ext/OgChecks.java"
jar --create --file "$out_dir/og-ext.jar.tmp" -C "$classes" .
mv "$out_dir/og-ext.jar.tmp" "$out_dir/og-ext.jar"
sha256sum "$out_dir/og-ext.jar"
