import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listHikes } from "@/server/hikes/catalog";
import { splitRecord } from "@/server/hikes/catalog-split";

describe("hike catalog API", () => {
  it("validates bounds and reports an unconfigured catalog", async () => {
    expect((await listHikes(new URL("http://localhost/?bbox=1,2,0,3"), undefined)).status).toBe(400);
    expect((await listHikes(new URL("http://localhost/"), undefined)).body).toEqual({ enabled: false, hikes: [] });
  });
  it("keeps detail feature lists off list responses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hikes-rich-"));
    const path = join(dir,"hikes.json");
    const hike = { id:"rich",bbox:[-76,40,-75,41],featureKinds:["waterfall"],features:[{ id:"fall" }] };
    try {
      await writeFile(path,JSON.stringify({version:1,hikes:[hike]}));
      expect((await listHikes(new URL("http://localhost/"),path)).body).toEqual({enabled:true,hikes:[{ id:"rich",bbox:hike.bbox,featureKinds:["waterfall"] }]});
      expect((await listHikes(new URL("http://localhost/?id=rich"),path)).body).toEqual({enabled:true,hikes:[hike]});
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
  it("serves a split catalog: summaries in memory, one trail's full record read on demand", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hikes-split-"));
    const path = join(dir, "hikes.json");
    const hikes = [
      { id: "a", bbox: [-76, 40, -75, 41], featureKinds: ["waterfall"], features: [{ id: "fall" }], photos: [{ id: 1 }], sources: [{ sourceId: "osm", recordId: "1" }, { sourceId: "osm", recordId: "2" }] },
      { id: "b", bbox: [-80, 42, -79, 43], trailheads: [{ name: "Lot" }] },
    ];
    try {
      let offset = 0; const lines: string[] = []; const summaries: object[] = [];
      for (const hike of hikes) { const { summary, line } = splitRecord(hike, offset); summaries.push(summary); lines.push(line); offset += Buffer.byteLength(line); }
      await writeFile(path, "not read when a summary exists");
      await writeFile(join(dir, "hikes.summary.json"), JSON.stringify({ version: 1, hikes: summaries }));
      await writeFile(join(dir, "hikes.details.jsonl"), lines.join(""));
      const list = (await listHikes(new URL("http://localhost/?bbox=-76,40,-75,41"), path)).body as { hikes: Record<string, unknown>[] };
      expect(list.hikes).toEqual([{ id: "a", bbox: [-76, 40, -75, 41], featureKinds: ["waterfall"], sources: [{ sourceId: "osm", recordId: "2" }] }]);
      expect((await listHikes(new URL("http://localhost/?id=b"), path)).body).toEqual({ enabled: true, hikes: [hikes[1]] });
      expect((await listHikes(new URL("http://localhost/?id=a"), path)).body).toEqual({ enabled: true, hikes: [hikes[0]] });
      expect((await listHikes(new URL("http://localhost/?id=missing"), path)).body).toEqual({ enabled: true, hikes: [] });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("filters intersections, reloads changed files, and reports invalid data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hikes-test-"));
    const path = join(dir, "hikes.json");
    try {
      await writeFile(path, JSON.stringify({ version: 1, hikes: [{ id: "a", bbox: [-76, 40, -75, 41] }, { id: "b", bbox: [-80, 42, -79, 43] }] }));
      const result = await listHikes(new URL("http://localhost/?bbox=-76,40,-75,41"), path);
      expect(result.body).toEqual({ enabled: true, hikes: [{ id: "a", bbox: [-76, 40, -75, 41] }] });
      expect((await listHikes(new URL("http://localhost/?id=b"), path)).body).toEqual({ enabled: true, hikes: [{ id: "b", bbox: [-80, 42, -79, 43] }] });
      expect((await listHikes(new URL("http://localhost/?id=b&bbox=-76,40,-75,41"), path)).body).toEqual({ enabled: true, hikes: [] });
      await writeFile(path, "invalid");
      expect((await listHikes(new URL("http://localhost/"), path)).status).toBe(503);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
