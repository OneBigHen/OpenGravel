import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";

import { afterAll, describe, expect, it } from "vitest";

import { buildPack } from "../../../scripts/route-library/pack-builder";
import type { IndexRow, Tombstone } from "@/application/route-library/types";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SOURCE = path.join(ROOT, "tests/fixtures/route-library/source");
const POLICY = path.join(ROOT, "scripts/route-library/sources-policy.json");
const work = mkdtempSync(path.join(tmpdir(), "route-library-tombstone-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function library(name: string): string {
  const dir = path.join(work, name);
  cpSync(SOURCE, dir, { recursive: true });
  return dir;
}

function build(libraryDir: string, outDir: string, allowDrop = false) {
  return buildPack({ libraryDir, outDir, policyPath: POLICY, allowDrop });
}

function tombstones(packPath: string): Tombstone[] {
  const database = new DatabaseSync(packPath, { readOnly: true });
  try {
    return (database.prepare("SELECT id, removed_at, reason FROM tombstone ORDER BY id").all() as { id: string; removed_at: string; reason: string }[]).map(
      (row) => ({ id: row.id, removedAt: row.removed_at, reason: row.reason }),
    );
  } finally {
    database.close();
  }
}

function index(packPath: string): { rows: IndexRow[]; version: string } {
  const database = new DatabaseSync(packPath, { readOnly: true });
  try {
    const body = (database.prepare("SELECT body FROM asset WHERE key = 'index'").get() as { body: Uint8Array }).body;
    return JSON.parse(gunzipSync(body).toString("utf8")) as { rows: IndexRow[]; version: string };
  } finally {
    database.close();
  }
}

function manifest(packPath: string): { removed: number } {
  const database = new DatabaseSync(packPath, { readOnly: true });
  try {
    return JSON.parse((database.prepare("SELECT value FROM meta WHERE key = 'manifest'").get() as { value: string }).value) as { removed: number };
  } finally {
    database.close();
  }
}

describe("removing a bad listing", () => {
  it("keeps a deliberate removal on disk out of the pack and records it for old links", () => {
    const dir = library("takedown");
    const out = path.join(work, "takedown-out");
    const first = build(dir, out);
    expect(first.counts.rides).toBe(14);

    writeFileSync(
      path.join(dir, "tombstones.json"),
      JSON.stringify([{ id: "nc-cherohala-skyway", removedAt: "2026-11-14T08:00:00Z", reason: "The listing named the wrong road." }]),
    );
    const second = build(dir, out);
    expect(second.ok).toBe(true);
    expect(second.counts.rides).toBe(13);
    expect(index(second.packPath).rows.map((row) => row.id)).not.toContain("nc-cherohala-skyway");
    expect(tombstones(second.packPath)).toEqual([
      { id: "nc-cherohala-skyway", removedAt: "2026-11-14T08:00:00Z", reason: "The listing named the wrong road." },
      { id: "pa-old-mill-road", removedAt: "2026-11-01T09:00:00Z", reason: "The source withdrew this listing." },
    ]);
    expect(manifest(second.packPath).removed).toBe(2);
    expect(second.report).toContain("Removed by tombstone");
    expect(second.report).toContain("nc-cherohala-skyway");
    expect(second.version).not.toBe(first.version);
  });

  it("calls one removed record an intended removal, not a 2% drop", () => {
    const dir = library("takedown-drop");
    const out = path.join(work, "takedown-drop-out");
    build(dir, out);
    writeFileSync(
      path.join(dir, "tombstones.json"),
      JSON.stringify([{ id: "nc-cherohala-skyway", removedAt: "2026-11-14T08:00:00Z", reason: "takedown" }]),
    );
    const second = build(dir, out);
    expect(second.failures).toEqual([]);
    expect(second.ok).toBe(true);
  });

  it("notices a record that disappeared from the folder without a tombstones entry", () => {
    const dir = library("vanished");
    const out = path.join(work, "vanished-out");
    build(dir, out);
    rmSync(path.join(dir, "routes/PA/pa-pa-151-south-heights-hookstown.json"));
    rmSync(path.join(dir, "routes/PA/pa-pa-151-south-heights-hookstown.gpx"));

    const second = build(dir, out, true);
    expect(second.ok).toBe(true);
    expect(second.counts.rides).toBe(13);
    const removed = tombstones(second.packPath).find((entry) => entry.id === "pa-pa-151-south-heights-hookstown");
    expect(removed).toMatchObject({ reason: "no longer in the library" });
    expect(Number.isFinite(Date.parse(removed!.removedAt))).toBe(true);
    expect(second.report).toContain("no longer in the library");
  });

  it("keeps the same version and removal date when rebuilt with nothing new", () => {
    const dir = library("stable");
    const out = path.join(work, "stable-out");
    build(dir, out);
    writeFileSync(
      path.join(dir, "tombstones.json"),
      JSON.stringify([{ id: "nc-cherohala-skyway", removedAt: "2026-11-14T08:00:00Z", reason: "takedown" }]),
    );
    const second = build(dir, out);
    const third = build(dir, out);
    expect(third.version).toBe(second.version);
    expect(tombstones(third.packPath)).toEqual(tombstones(second.packPath));
  });

  it("lets a ride come back when its deliberate removal is taken out of the file", () => {
    const dir = library("restore");
    const out = path.join(work, "restore-out");
    build(dir, out);
    writeFileSync(
      path.join(dir, "tombstones.json"),
      JSON.stringify([{ id: "nc-cherohala-skyway", removedAt: "2026-11-14T08:00:00Z", reason: "takedown" }]),
    );
    expect(build(dir, out).counts.rides).toBe(13);

    // The fixture's own tombstone stays; the deliberate skyway line is gone.
    writeFileSync(
      path.join(dir, "tombstones.json"),
      JSON.stringify([{ id: "pa-old-mill-road", removedAt: "2026-11-01T09:00:00Z", reason: "The source withdrew this listing." }]),
    );
    const restored = build(dir, out);
    expect(restored.counts.rides).toBe(14);
    expect(index(restored.packPath).rows.map((row) => row.id)).toContain("nc-cherohala-skyway");
    expect(tombstones(restored.packPath).map((entry) => entry.id)).toEqual(["pa-old-mill-road"]);
  });

  it("keeps a removal through a later build where the ride is still gone", () => {
    const dir = library("carry");
    const out = path.join(work, "carry-out");
    build(dir, out);
    writeFileSync(
      path.join(dir, "tombstones.json"),
      JSON.stringify([{ id: "nc-cherohala-skyway", removedAt: "2026-11-14T08:00:00Z", reason: "source withdrew it" }]),
    );
    build(dir, out);
    // A later batch removes the deliberate line, but the record is still on
    // disk after that batch, so the ride is removed from the folder by hand.
    writeFileSync(path.join(dir, "tombstones.json"), "[]");
    rmSync(path.join(dir, "routes/NC/nc-cherohala-skyway.json"));
    rmSync(path.join(dir, "routes/NC/nc-cherohala-skyway.gpx"));
    const later = build(dir, out, true);
    expect(tombstones(later.packPath)).toEqual([
      { id: "nc-cherohala-skyway", removedAt: "2026-11-14T08:00:00Z", reason: "source withdrew it" },
      { id: "pa-old-mill-road", removedAt: "2026-11-01T09:00:00Z", reason: "The source withdrew this listing." },
    ]);
  });

  it("writes schema 2 and never puts a tombstoned id in the index", () => {
    const dir = library("schema");
    const out = path.join(work, "schema-out");
    const result = build(dir, out);
    const database = new DatabaseSync(result.packPath, { readOnly: true });
    try {
      expect((database.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string }).value).toBe("2");
    } finally {
      database.close();
    }
    expect(index(result.packPath).rows.map((row) => row.id)).not.toContain("pa-old-mill-road");
  });

  it("fails the build on a malformed tombstones file instead of serving it", () => {
    const dir = library("bad-tombstones");
    writeFileSync(path.join(dir, "tombstones.json"), JSON.stringify([{ id: "nc-cherohala-skyway", removedAt: "yesterday" }]));
    expect(() => build(dir, path.join(work, "bad-tombstones-out"))).toThrow(/removedAt must be a date/);
  });

  it("still packs the fixture's own deliberate removal without hiding a live ride", () => {
    const result = build(library("fixture-fake"), path.join(work, "fixture-fake-out"));
    expect(result.counts.rides).toBe(14);
    expect(tombstones(result.packPath)).toEqual([
      { id: "pa-old-mill-road", removedAt: "2026-11-01T09:00:00Z", reason: "The source withdrew this listing." },
    ]);
    expect(readFileSync(result.reportPath, "utf8")).toContain("Removed rides (1)");
  });
});
