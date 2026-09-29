import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { handleBasemapArchive, handleRegionList } from "@/server/offline/handler";

const deps = {
  root: join(process.cwd(), "tests/fixtures/offline-regions"),
  basemapRoot: join(process.cwd(), "tests/fixtures/basemap"),
  limiter: { check: () => null },
};
const ARCHIVE = join(deps.basemapRoot, "lehigh-fixture.pmtiles");
const get = (headers: Record<string, string> = {}, method = "GET") => new Request("http://ogv.test/x", { method, headers });

describe("basemap archive handler", () => {
  it("lists a region's map size beside its roads", async () => {
    const body = (await (await handleRegionList(get(), deps)).json()) as { regions: { regionId: string; basemapBytes?: number }[] };
    const bytes = (await readFile(ARCHIVE)).byteLength;
    expect(body.regions).toEqual([expect.objectContaining({ regionId: "lehigh-fixture", basemapBytes: bytes })]);
  });

  it("streams the whole archive, a byte range, and resumes only against the same ETag", async () => {
    const whole = await handleBasemapArchive(get(), "lehigh-fixture", deps);
    expect(whole.status).toBe(200);
    const bytes = new Uint8Array(await whole.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 7))).toBe("PMTiles");
    const etag = whole.headers.get("etag") ?? "";

    const part = await handleBasemapArchive(get({ range: "bytes=100-199", "if-range": etag }), "lehigh-fixture", deps);
    expect(part.status).toBe(206);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.subarray(100, 200));

    const changed = await handleBasemapArchive(get({ range: "bytes=100-", "if-range": '"old"' }), "lehigh-fixture", deps);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("content-length")).toBe(String(bytes.byteLength));
    await changed.body?.cancel();
  });

  it("names a region without a map, and refuses unsafe ids", async () => {
    expect((await handleBasemapArchive(get(), "nowhere", deps)).status).toBe(404);
    expect((await handleBasemapArchive(get(), "../etc", deps)).status).toBe(404);
  });
});
