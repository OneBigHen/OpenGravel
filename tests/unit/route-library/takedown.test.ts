import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { addTakedown } from "../../../scripts/route-library/takedown";
import { parseTombstones } from "@/application/route-library/tombstones";

const work = mkdtempSync(path.join(tmpdir(), "route-library-takedown-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("taking a listing down", () => {
  it("creates the file with the removal and a readable date", () => {
    const file = path.join(work, "fresh", "tombstones.json");
    const list = addTakedown(file, { id: "pa-bad-road", removedAt: "2026-11-14T12:00:00Z", reason: "Wrong road in the track." });

    expect(list).toEqual([{ id: "pa-bad-road", removedAt: "2026-11-14T12:00:00Z", reason: "Wrong road in the track." }]);
    expect(parseTombstones(JSON.parse(readFileSync(file, "utf8")))).toEqual(list);
  });

  it("keeps every existing removal and replaces the same id", () => {
    const file = path.join(work, "existing", "tombstones.json");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify([
        { id: "aa-old", removedAt: "2026-11-01T00:00:00Z", reason: "first" },
        { id: "mm-old", removedAt: "2026-11-02T00:00:00Z", reason: "second" },
      ]),
    );
    const list = addTakedown(file, { id: "mm-old", removedAt: "2026-11-14T00:00:00Z", reason: "second, restated" });

    expect(list.map((entry) => entry.id)).toEqual(["aa-old", "mm-old"]);
    expect(list.find((entry) => entry.id === "mm-old")?.reason).toBe("second, restated");
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveLength(2);
  });

  it("refuses to rewrite a malformed file rather than dropping its contents", () => {
    const file = path.join(work, "malformed", "tombstones.json");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify([{ id: "not a ride id", removedAt: "2026-11-01", reason: "x" }]));
    expect(() => addTakedown(file, { id: "pa-bad-road", removedAt: "2026-11-14", reason: "x" })).toThrow(/id must be a ride id/);
    expect(readFileSync(file, "utf8")).toContain("not a ride id");
  });
});
