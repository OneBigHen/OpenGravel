/**
 *
 * node --max-old-space-size=320 --import tsx scripts/route-library/build-pack.ts --library <dir> --out <dir>
 * (the heap flag keeps the full-library build near 380 MB instead of 620 MB)
 *   [--policy <file>] [--catalog <file>] [--name <file.sqlite>] [--snapshot <file.json>] [--allow-drop]
 * The phrase snapshot goes to <out>/phrases.snapshot.json unless --snapshot names another file, so a build
 * never edits a tracked source file. Regenerate the repo's copy from the fixture with
 * `npm run route-library:snapshot`.
 * Exits 1 when a quality gate fails (see the report's gate table).
 */
import path from "node:path";

import { buildPack } from "./pack-builder";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const libraryDir = argument("library");
const outDir = argument("out");
if (libraryDir === undefined || outDir === undefined) {
  console.error("Usage: build-pack.ts --library <dir> --out <dir> [--policy <file>] [--catalog <file>] [--name <file>] [--snapshot <file>] [--allow-drop]");
  process.exit(2);
}
if (argument("old-library") !== undefined) console.warn("--old-library is read by package L2; ignored here.");

const snapshotArgument = argument("snapshot");

const result = buildPack({
  libraryDir: path.resolve(libraryDir),
  outDir: path.resolve(outDir),
  policyPath: path.resolve(argument("policy") ?? path.join(import.meta.dirname, "sources-policy.json")),
  catalogPath: path.resolve(argument("catalog") ?? path.join(import.meta.dirname, "..", "..", "data", "catalog", "routes.json.gz")),
  packName: argument("name"),
  snapshotPath: snapshotArgument === undefined ? undefined : path.resolve(snapshotArgument),
  allowDrop: process.argv.includes("--allow-drop"),
  log: (line) => console.log(line),
});
console.log(`${result.ok ? "PASS" : "FAIL"} version ${result.version}: ${result.counts.rides} rides, ${result.counts.located} located, ${result.counts.withLine} with a line`);
for (const gate of result.gates) console.log(`GATE ${gate.ok ? "pass" : "FAIL"} ${gate.name}: ${gate.detail}`);
console.log(`Peak memory: ${Math.round(process.resourceUsage().maxRSS / 1024)} MB`);
console.log(`Pack: ${result.packPath}\nReport: ${result.reportPath}`);
for (const failure of result.failures) console.error(`GATE: ${failure}`);
process.exit(result.ok ? 0 : 1);
