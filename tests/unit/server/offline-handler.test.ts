import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  handleRegionList,
  handleRegionManifest,
  handleRegionTile,
  parseByteRange,
  type OfflineHandlerDeps,
} from "@/server/offline/handler";

const TILE = new Uint8Array([31, 139, 8, 0, 1, 2, 3, 4, 5, 6]);
const SHA = createHash("sha256").update(TILE).digest("hex");
const open = { check: () => null };
let root = "";
let deps: OfflineHandlerDeps;

function manifest(regionId: string, version: string) {
  return {
    schemaVersion: 2,
    regionId,
    regionName: "Test Valley",
    version,
    compression: "gzip-json",
    buildDate: "2026-09-26",
    sourceDataDate: "2026-09-20",
    snapshotUrl: "https://example.org/x.pbf",
    sourceUrl: "https://example.org/x",
    bounds: { minLon: -76, minLat: 40, maxLon: -75.75, maxLat: 40.25 },
    checksums: { inventorySha256: "b".repeat(64) },
    attribution: "© OpenStreetMap contributors, ODbL 1.0",
    tiles: [
      {
        tileId: "t-a",
        bounds: { minLon: -76, minLat: 40, maxLon: -75.75, maxLat: 40.25 },
        bytes: TILE.byteLength,
        sha256: SHA,
        nodeCount: 1,
        edgeCount: 1,
      },
    ],
    tileByteTotal: TILE.byteLength,
  };
}

const get = (headers: Record<string, string> = {}, method = "GET") =>
  new Request("http://ogv.test/api/offline", { method, headers });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ogv-offline-"));
  const dir = join(root, "test-valley", "v1");
  await mkdir(join(dir, "tiles"), { recursive: true });
  await writeFile(join(root, "test-valley", "active.json"), JSON.stringify({ version: "v1" }));
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest("test-valley", "v1")));
  await writeFile(join(dir, "tiles", "t-a.json.gz"), TILE);
  // Half-published: no active.json, so it stays invisible.
  await mkdir(join(root, "draft-region"), { recursive: true });
  deps = { limiter: open, root };
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("offline region handlers", () => {
  it("lists only regions with a valid active manifest, without the tile inventory", async () => {
    const body = (await (await handleRegionList(get(), deps)).json()) as { regions: Record<string, unknown>[] };
    expect(body.regions).toEqual([
      expect.objectContaining({ regionId: "test-valley", tileCount: 1, tileByteTotal: TILE.byteLength }),
    ]);
    expect(body.regions[0]).not.toHaveProperty("tiles");
  });

  it("serves a manifest with an ETag and answers a matching revalidation with 304", async () => {
    const first = await handleRegionManifest(get(), "test-valley", deps);
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"sha256-/);
    const again = await handleRegionManifest(get({ "if-none-match": etag }), "test-valley", deps);
    expect(again.status).toBe(304);
  });

  it("rejects unsafe ids and names a missing region", async () => {
    expect((await handleRegionManifest(get(), "../etc", deps)).status).toBe(400);
    expect((await handleRegionManifest(get(), "nowhere", deps)).status).toBe(404);
    expect((await handleRegionTile(get(), "test-valley", "../x", deps)).status).toBe(400);
    expect((await handleRegionTile(get(), "test-valley", "t-z", deps)).status).toBe(404);
  });

  it("serves a tile whole, by range for a resumed download, and headers-only on HEAD", async () => {
    const whole = await handleRegionTile(get(), "test-valley", "t-a", deps);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(TILE);

    const part = await handleRegionTile(get({ range: "bytes=4-" }), "test-valley", "t-a", deps);
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 4-9/${TILE.byteLength}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(TILE.subarray(4));

    const head = await handleRegionTile(get({}, "HEAD"), "test-valley", "t-a", deps);
    expect(head.headers.get("content-length")).toBe(String(TILE.byteLength));
    expect(await head.text()).toBe("");

    expect((await handleRegionTile(get({ range: "bytes=99-" }), "test-valley", "t-a", deps)).status).toBe(416);
  });

  it("answers a spent budget with 429 and a retry time", async () => {
    const response = await handleRegionList(get(), { root, limiter: { check: () => 12 } });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
  });

  it("parses byte ranges strictly", () => {
    expect(parseByteRange(null, 10)).toBeNull();
    expect(parseByteRange("bytes=2-4", 10)).toEqual({ start: 2, end: 4 });
    expect(parseByteRange("bytes=2-99", 10)).toEqual({ start: 2, end: 9 });
    expect(parseByteRange("bytes=-4", 10)).toBe("invalid");
    expect(parseByteRange("bytes=5-2", 10)).toBe("invalid");
  });
});
