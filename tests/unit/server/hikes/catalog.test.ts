import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listHikes } from "@/server/hikes/catalog";

describe("hike catalog API", () => {
  it("validates bounds and reports an unconfigured catalog", async () => {
    expect((await listHikes(new URL("http://localhost/?bbox=1,2,0,3"), undefined)).status).toBe(400);
    expect((await listHikes(new URL("http://localhost/"), undefined)).body).toEqual({ enabled: false, hikes: [] });
  });
  it("filters intersections, reloads changed files, and reports invalid data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hikes-test-"));
    const path = join(dir, "hikes.json");
    try {
      await writeFile(path, JSON.stringify({ version: 1, hikes: [{ id: "a", bbox: [-76, 40, -75, 41] }, { id: "b", bbox: [-80, 42, -79, 43] }] }));
      const result = await listHikes(new URL("http://localhost/?bbox=-76,40,-75,41"), path);
      expect(result.body).toEqual({ enabled: true, hikes: [{ id: "a", bbox: [-76, 40, -75, 41] }] });
      await writeFile(path, "invalid");
      expect((await listHikes(new URL("http://localhost/"), path)).status).toBe(503);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
