import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LOCAL_DATA_STORAGE_KEYS } from "@/infrastructure/storage/clear-all-local-data";

/**
 * "Delete all data" promises the rider their device data is gone. That promise
 * is only as complete as the key list, and the key list used to be a set of
 * literals nobody updated when a screen started writing a new preference. This
 * scan fails when `src/` declares a `*KEY = "og..."` constant that the wipe
 * does not cover (or cover deliberately, right here, with a reason).
 */

const SRC_ROOT = path.join(process.cwd(), "src");
const SOURCE_FILE = /\.(?:ts|tsx)$/;
const KEY_DECLARATION = /\b(?:const|let)\s+[A-Z0-9_]*KEY[A-Z0-9_]*\s*=\s*"((?:og|opengravel|OGV_)[^"]*)"/g;

/**
 * Keys that are not the rider's data: a renderer throttle, a one-time UI hint,
 * a this-tab-only sessionStorage marker, and the owner secret for a publicly shared route.
 */
const NOT_RIDER_DATA: ReadonlyMap<string, string> = new Map([
  ["ogv.mapbox-refused-until", "a renderer retry throttle with its own expiry"],
  ["opengravel-edit-tip-seen", "a one-time UI hint"],
  ["opengravel-vnext-ride-handoff", "a sessionStorage marker for this tab's Start ride"],
  [
    "opengravel.community.owner.",
    "the removal secret for a route this device shared publicly; wiping it would leave a public route nobody can take down",
  ],
]);

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return SOURCE_FILE.test(entry.name) ? [full] : [];
  });
}

function declaredStorageKeys(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC_ROOT)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(KEY_DECLARATION)) {
      if (match[1] !== undefined) found.add(match[1]);
    }
  }
  return [...found];
}

describe("local data key coverage", () => {
  it("finds the device keys src declares, so the scan cannot pass vacuously", () => {
    const keys = declaredStorageKeys();

    expect(keys.length).toBeGreaterThanOrEqual(20);
    expect(keys).toEqual(expect.arrayContaining([...NOT_RIDER_DATA.keys()]));
  });

  it("deletes every device key the app declares, or records why it stays", () => {
    const deleted = new Set<string>(LOCAL_DATA_STORAGE_KEYS);
    const undeleted = declaredStorageKeys().filter(
      (key) => !deleted.has(key) && !NOT_RIDER_DATA.has(key),
    );

    expect(undeleted).toEqual([]);
  });

  it("does not keep a stale 'not rider data' exception", () => {
    const declared = new Set(declaredStorageKeys());

    expect([...NOT_RIDER_DATA.keys()].filter((key) => !declared.has(key))).toEqual([]);
  });
});
