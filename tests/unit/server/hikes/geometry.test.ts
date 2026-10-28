import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/hikes/geometry/route";

describe("hike geometry API", () => {
  it("returns only requested features in a bounded batch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hike-geometry-"));
    const previous = process.env.OGV_HIKES_PATH;
    process.env.OGV_HIKES_PATH = join(dir, "hikes.json");
    try {
      const feature = (id: string) => ({ type: "Feature", id, geometry: { type: "LineString", coordinates: [[-75, 40], [-75.1, 40.1]] }, properties: {} });
      await writeFile(join(dir, "trails.geojson"), JSON.stringify({ type: "FeatureCollection", features: [feature("a"), feature("b")] }));
      const response = await GET(new Request("http://localhost/api/hikes/geometry?ids=b&ids=missing"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ features: [feature("b")] });
      const excess = new URL("http://localhost/api/hikes/geometry");
      for (let index = 0; index < 51; index++) excess.searchParams.append("ids", "a");
      expect((await GET(new Request(excess))).status).toBe(400);
    } finally {
      if (previous === undefined) delete process.env.OGV_HIKES_PATH; else process.env.OGV_HIKES_PATH = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
