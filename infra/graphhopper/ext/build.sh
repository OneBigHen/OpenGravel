#!/usr/bin/env bash
set -euo pipefail
# Compile against the exact GH 11 fat jar used by the importer/server. Run this on powerplex.
jar_path=$(realpath "${1:?Usage: build.sh graphhopper-web-11.0.jar}")
cd "$(dirname "$0")"
mkdir -p target
build_dir=$(mktemp -d target/build.XXXXXXXX)
trap 'rm -rf -- "$build_dir"' EXIT
mkdir "$build_dir/classes" "$build_dir/test-classes"
javac --release 17 -cp "$jar_path" -d "$build_dir/classes" $(find src/main/java -name '*.java' | sort)
javac --release 17 -cp "$jar_path:$build_dir/classes" -d "$build_dir/test-classes" $(find src/test/java -name '*.java' | sort)
java -ea -cp "$jar_path:$build_dir/classes:$build_dir/test-classes" rodeo.opengravel.graphhopper.CurveTest fixtures/franco.json
java -ea -cp "$jar_path:$build_dir/classes:$build_dir/test-classes" rodeo.opengravel.graphhopper.DistributionTest
if [[ -n "${OG_CURVE_TEST_CONFIG:-}" ]]; then
  java -ea -Xmx1g -XX:ActiveProcessorCount=2 -cp "$jar_path:$build_dir/classes:$build_dir/test-classes" rodeo.opengravel.graphhopper.IntegrationTest "$OG_CURVE_TEST_CONFIG"
fi
jar --create --file target/og-curve-gh11.jar -C "$build_dir/classes" .
sha256sum "$jar_path" target/og-curve-gh11.jar
