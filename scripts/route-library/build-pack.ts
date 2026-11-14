/**

 * node --max-old-space-size=320 --import tsx scripts/route-library/build-pack.ts --library <dir> --out <dir>
 * (the heap flag keeps the full-library build near 380 MB instead of 620 MB)
 *   [--policy <file>] [--catalog <file>] [--name <file.sqlite>] [--allow-drop]
 * Exits 1 when a quality gate fails (see the report).
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
  console.error("Usage: build-pack.ts --library <dir> --out <dir> [--policy <file>] [--catalog <file>] [--name <file>] [--allow-drop]");
  process.exit(2);
}
if (argument("old-library") !== undefined) console.warn("--old-library is read by package L2; ignored here.");

const result = buildPack({
  libraryDir: path.resolve(libraryDir),
  outDir: path.resolve(outDir),
  policyPath: path.resolve(argument("policy") ?? path.join(import.meta.dirname, "sources-policy.json")),
  catalogPath: path.resolve(argument("catalog") ?? path.join(import.meta.dirname, "..", "..", "data", "catalog", "routes.json.gz")),
  packName: argument("name"),
  allowDrop: process.argv.includes("--allow-drop"),
  log: (line) => console.log(line),
});
console.log(`${result.ok ? "PASS" : "FAIL"} version ${result.version}: ${result.counts.rides} rides, ${result.counts.located} located, ${result.counts.withLine} with a line`);
console.log(`Peak memory: ${Math.round(process.resourceUsage().maxRSS / 1024)} MB`);
console.log(`Pack: ${result.packPath}\nReport: ${result.reportPath}`);
for (const failure of result.failures) console.error(`GATE: ${failure}`);
process.exit(result.ok ? 0 : 1);
