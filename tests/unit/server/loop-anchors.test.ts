import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, vi } from "vitest";

import { createLoopAnchors } from "@/server/roads/loop-anchors";

const WORLD = { west: -80, south: 30, east: -70, north: 45 };

function tableFile(importDate = "2026-11-01T00:00:00Z", version = 1): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "ogv-anchors-test-")), "anchors.sqlite");
  const db = new DatabaseSync(file);
  db.exec(`pragma user_version = ${version};
    create table meta (key text primary key, value text not null);
    create table anchors (id text primary key, kind text, lat real, lon real, heading real, length_m real, quality real, max_grade integer, sand_share real, seasonal_flags_json text, through real, through_street real, curve real, town real);`);
  db.prepare("insert into meta values ('import_date', ?)").run(importDate);
  const insert = db.prepare("insert into anchors values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  insert.run("d1", "dirt", 40.1, -75.1, 90, 3000, 0.9, 2, 0.02, "[]", 1, 0.2, 0.1, 0);
  insert.run("sandy", "dirt", 40.2, -75.1, 90, 3000, 0.8, 2, 0.5, "[]", 1, 1, 0.1, 0);
  insert.run("rough", "dirt", 40.3, -75.1, 90, 3000, 0.7, 5, 0.0, "[]", 1, 0, 0.1, 0.7);
  insert.run("dead", "dirt", 40.4, -75.1, 90, 3000, 0.6, 1, 0.0, "[]", 0.1, 0.1, 0.1, 0);
  insert.run("c1", "curvy", 40.5, -75.1, 10, 5000, 0.95, null, 0, '["seasonal"]', 1, 1, 0.6, 0.3);
  db.close();
  return file;
}

describe("loop anchors loader", () => {
  it("reads anchors and filters for the bike", () => {
    const log = vi.fn();
    const anchors = createLoopAnchors(tableFile(), "2026-11-01T00:00:00Z", log);
    expect(log).not.toHaveBeenCalled();
    expect(anchors.availability()).toMatchObject({ available: true, count: 5 });
    expect(anchors.anchorsNear(WORLD).map((a) => a.id)).toEqual(["c1", "d1", "sandy", "rough", "dead"]);
    expect(anchors.anchorsNear(WORLD, { kind: "curvy" })[0]).toMatchObject({ id: "c1", seasonalFlags: ["seasonal"], maxGrade: null, curve: 0.6 });
    const gentle = anchors.anchorsNear(WORLD, { kind: "dirt", maxSandShare: 0.1, maxGrade: 3, requireThrough: "any" });
    expect(gentle.map((a) => a.id)).toEqual(["d1"]);
    expect(anchors.anchorsNear(WORLD, { kind: "dirt", requireThrough: "street" }).map((a) => a.id)).toEqual(["sandy"]);
    expect(anchors.anchorsNear(WORLD, { maxTown: 0.5 }).map((a) => a.id)).not.toContain("rough");
    expect(anchors.anchorsNear({ west: -76, south: 40.45, east: -74, north: 41 })).toHaveLength(1);
  });

  it("gives an empty result and one health line when the file is missing", () => {
    const log = vi.fn();
    const anchors = createLoopAnchors("/nonexistent/anchors.sqlite", "2026-11-01", log);
    expect(anchors.anchorsNear(WORLD)).toEqual([]);
    expect(anchors.availability().available).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("gives an empty result and one health line when the table is for another map", () => {
    const log = vi.fn();
    const anchors = createLoopAnchors(tableFile("2026-10-01T00:00:00Z"), "2026-11-01T00:00:00Z", log);
    expect(anchors.anchorsNear(WORLD)).toEqual([]);
    expect(anchors.availability()).toMatchObject({ available: false, count: 0 });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain("another map");
  });

  it("is unused when the running map's date is unknown, the version is wrong, or the file is junk", () => {
    const junk = path.join(mkdtempSync(path.join(tmpdir(), "ogv-anchors-junk-")), "x.sqlite");
    writeFileSync(junk, "this is not a database");
    const cases: [string, string | null][] = [
      [tableFile(), null],
      [tableFile(), "unknown"],
      [tableFile("x", 9), "x"],
      [junk, "x"],
    ];
    for (const [file, date] of cases) {
      const log = vi.fn();
      const anchors = createLoopAnchors(file, date, log);
      expect(anchors.anchorsNear(WORLD)).toEqual([]);
      expect(log).toHaveBeenCalledTimes(1);
    }
  });
});
