/**
 * Same-day takedown: add one ride id to `<library>/tombstones.json`.
 *
 *   node --import tsx scripts/route-library/takedown.ts <id> \
 *     --library <library dir> --reason "why it came down" [--at <date>]
 *
 * The rebuild and publish are a second command, because that is the step the
 * owner's publish rule covers:
 *
 *   infra/route-library/refresh-pack.sh --publish
 *
 * `--publish` on the wrapper hands the changed pack to publish-pack.sh; the
 * scheduled unit does the same on its next run if a person does not.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseTombstones, RIDE_ID, tombstonesJson, withTakedown } from "@/application/route-library/tombstones";
import type { Tombstone } from "@/application/route-library/types";

/**
 * Writes the deliberate list atomically. The previous entries are kept, the
 * same id is replaced rather than duplicated, and the file stays sorted.
 */
export function addTakedown(file: string, entry: Tombstone): readonly Tombstone[] {
  const existing = existsSync(file) ? parseTombstones(JSON.parse(readFileSync(file, "utf8")), file) : [];
  const list = withTakedown(existing, entry);
  const temporary = `${file}.${process.pid}.tmp`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(temporary, tombstonesJson(list));
  renameSync(temporary, file);
  return list;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const id = process.argv[2];
  const libraryDir = argument("library");
  const reason = argument("reason");
  const at = argument("at") ?? new Date().toISOString();
  if (id === undefined || id.startsWith("--") || libraryDir === undefined || reason === undefined) {
    console.error('Usage: takedown.ts <id> --library <dir> --reason "why it came down" [--at <date>]');
    process.exitCode = 2;
    return;
  }
  if (!RIDE_ID.test(id)) {
    console.error(`Refusing ${id}: a ride id is lowercase letters, digits and single hyphens.`);
    process.exitCode = 2;
    return;
  }
  const file = path.join(path.resolve(libraryDir), "tombstones.json");
  const list = addTakedown(file, { id, removedAt: at, reason });
  const routesDir = path.join(path.resolve(libraryDir), "routes");
  const present = existsSync(routesDir) && findRecord(routesDir, id);
  console.log(`${present ? "Tombstoned" : "Tombstoned (no record file with that id is present; old links will still answer)"}: ${id}`);
  console.log(`Kept in ${file} with ${list.length} removal${list.length === 1 ? "" : "s"}. Reason: ${reason}`);
  console.log("Rebuild and publish now:");
  console.log("  infra/route-library/refresh-pack.sh --publish");
}

function findRecord(routesDir: string, id: string): boolean {
  // The states are shallow folders; scanning their names is enough and never
  // walks the whole disk.
  try {
    for (const state of readdirSync(routesDir)) {
      if (existsSync(path.join(routesDir, state, `${id}.json`))) return true;
    }
  } catch {
    return false;
  }
  return false;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) main();
