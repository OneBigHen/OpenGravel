import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createGravelAtlas, gravelAtlasFromEnv } from "@/server/roads/gravel-atlas";

function atlasFile(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "ogv-atlas-test-")), "atlas.sqlite");
  const db = new DatabaseSync(file);
  db.exec("pragma user_version = 3; create table corridors (id text, kind text, geometry_json text, reversible integer, west real, south real, east real, north real, length_meters real, longest_dirt_run_meters real, bend_share real, franco_score real, curvature_per_km real, quality real, grade_mix_json text, max_track_grade integer, legal_confidence real, access_legal integer, sand_share real, unknown_restriction_flags_json text, closed integer, seasonal_closed integer, seasonal_flags_json text, source_ids_json text, area_hints_json text)");
  db.prepare("insert into corridors values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "d1", "dirt", JSON.stringify([[-77, 40], [-76.9, 40.1]]), 1, -77, 40, -76.9, 40.1,
    10_000, 8_000, 0.2, 800, 80, 0.8, JSON.stringify({ grade2: 8_000 }), 2, 0.9, 1, 0,
    "[]", 0, 0, "[]", JSON.stringify(["way/1"]), JSON.stringify(["michaux"]),
  );
  db.prepare("insert into corridors values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "private", "dirt", JSON.stringify([[-77, 40], [-76.9, 40.1]]), 0, -77, 40, -76.9, 40.1,
    10_000, 8_000, 0.2, 800, 80, 0.8, "{}", 2, 0.1, 0, 0, "[]", 0, 0, "[]", "[]", "[]",
  );
  db.close();
  return file;
}

describe("Gravel Atlas SQLite adapter", () => {
  it("reads v3 corridors and applies legal/seasonal gates", () => {
    const path = atlasFile();
    const atlas = createGravelAtlas(path);
    expect(atlas.availability()).toMatchObject({ available: true, schemaVersion: 3, corridorCount: 2 });
    expect(atlas.corridorsNear({ west: -77.1, south: 39.9, east: -76.8, north: 40.2 }, "dirt").map((row) => row.id)).toEqual(["d1"]);
  });

  it("supports the OGV_GRAVEL_ATLAS_PATH environment seam", () => {
    const path = atlasFile();
    expect(gravelAtlasFromEnv({ OGV_GRAVEL_ATLAS_PATH: path }).availability().available).toBe(true);
  });
});

describe("Gravel Atlas graph validation columns", () => {
  function validatedAtlas(): string {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "ogv-atlas-valid-")), "atlas.sqlite");
    const db = new DatabaseSync(file);
    db.exec("pragma user_version = 3; create table corridors (id text, kind text, geometry_json text, reversible integer, west real, south real, east real, north real, length_meters real, longest_dirt_run_meters real, bend_share real, franco_score real, curvature_per_km real, quality real, grade_mix_json text, max_track_grade integer, legal_confidence real, access_legal integer, sand_share real, unknown_restriction_flags_json text, closed integer, seasonal_closed integer, seasonal_flags_json text, source_ids_json text, area_hints_json text, entry_links integer, exit_links integer, routable integer, routed_meters real)");
    const insert = db.prepare("insert into corridors values (?, 'dirt', ?, 1, -77, 40, -76.9, 40.1, 10000, 8000, 0.2, 800, 80, 0.8, '{}', 2, 0.9, 1, 0, '[]', 0, 0, '[]', '[]', '[]', ?, ?, ?, ?)");
    const geometry = JSON.stringify([[-77, 40], [-76.9, 40.1]]);
    insert.run("ok", geometry, 2, 1, 1, 10_100);
    insert.run("unchecked", geometry, 1, 1, null, null);
    insert.run("unroutable", geometry, 1, 1, 0, 40_000);
    db.close();
    return file;
  }

  it("never returns a corridor the router could not ride, keeps unchecked ones, and reads end links", () => {
    const rows = createGravelAtlas(validatedAtlas()).corridorsNear({ west: -77.1, south: 39.9, east: -76.8, north: 40.2 }, "dirt");
    expect(rows.map((row) => row.id).sort()).toEqual(["ok", "unchecked"]);
    const ok = rows.find((row) => row.id === "ok")!;
    expect(ok).toMatchObject({ entryLinks: 2, exitLinks: 1, routable: true });
    expect(rows.find((row) => row.id === "unchecked")?.routable).toBeNull();
  });
});
