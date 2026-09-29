#!/usr/bin/env node
/**
 * Clips a small offline road-graph region out of a built one, for fixtures.
 *
 *   node scripts/offline/clip-region.mjs <sourceRegionDir> <outRoot> <regionId> <minLon,minLat,maxLon,maxLat> [splitLon]
 *
 * Keeps every edge whose two end nodes fall inside the box and writes the
 * v2 layout (`active.json`, `<version>/manifest.json`, `tiles/*.json.gz`).
 * With `splitLon` the box becomes two tiles, so a fixture also exercises
 * merging tiles across a shared border node, as the real 0.25° build does.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const [sourceDir, outRoot, regionId, box, split] = process.argv.slice(2);
if (!sourceDir || !outRoot || !regionId || !box) {
  console.error("usage: clip-region.mjs <sourceRegionDir> <outRoot> <regionId> <minLon,minLat,maxLon,maxLat> [splitLon]");
  process.exit(2);
}
const [minLon, minLat, maxLon, maxLat] = box.split(",").map(Number);
const splitLon = split === undefined ? null : Number(split);
const inside = ([lon, lat]) => lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

const active = JSON.parse(await readFile(join(sourceDir, "active.json"), "utf8"));
const source = JSON.parse(await readFile(join(sourceDir, active.version, "manifest.json"), "utf8"));
const wanted = source.tiles.filter(
  (t) => t.bounds.minLon <= maxLon && t.bounds.maxLon >= minLon && t.bounds.minLat <= maxLat && t.bounds.maxLat >= minLat,
);

const nodes = new Map();
const edges = new Map();
const restrictions = [];
for (const entry of wanted) {
  const tile = JSON.parse(gunzipSync(await readFile(join(sourceDir, active.version, "tiles", `${entry.tileId}.json.gz`))));
  for (const node of tile.nodes) if (inside(node.coordinate)) nodes.set(node.id, node);
  for (const edge of tile.edges) if (nodes.has(edge.fromNodeId) && nodes.has(edge.toNodeId)) edges.set(edge.id, edge);
  restrictions.push(...tile.turnRestrictions);
}

const cells =
  splitLon === null
    ? [{ minLon, minLat, maxLon, maxLat }]
    : [
        { minLon, minLat, maxLon: splitLon, maxLat },
        { minLon: splitLon, minLat, maxLon, maxLat },
      ];
const cellOf = (position) => (splitLon === null || position[0] < splitLon ? 0 : 1);

const version = "fixture-1";
const dir = join(outRoot, regionId, version);
await rm(join(outRoot, regionId), { recursive: true, force: true });
await mkdir(join(dir, "tiles"), { recursive: true });

const inventory = [];
for (const [index, bounds] of cells.entries()) {
  const tileEdges = [...edges.values()].filter((e) => cellOf(nodes.get(e.fromNodeId).coordinate) === index);
  const nodeIds = new Set(tileEdges.flatMap((e) => [e.fromNodeId, e.toNodeId]));
  const edgeIds = new Set(tileEdges.map((e) => e.id));
  const seen = new Set();
  const turnRestrictions = restrictions.filter((r) => {
    const key = `${r.incomingEdgeId}|${r.viaNodeId}|${r.outgoingEdgeId}|${r.restriction}`;
    if (seen.has(key) || !edgeIds.has(r.incomingEdgeId) || !edgeIds.has(r.outgoingEdgeId) || !nodeIds.has(r.viaNodeId)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const tileId = `t-${regionId}-${index}`;
  const tile = {
    schemaVersion: 2,
    tileId,
    bounds,
    nodes: [...nodeIds].map((id) => nodes.get(id)),
    edges: tileEdges,
    turnRestrictions,
  };
  const bytes = gzipSync(JSON.stringify(tile), { level: 9 });
  await writeFile(join(dir, "tiles", `${tileId}.json.gz`), bytes);
  inventory.push({ tileId, bounds, bytes: bytes.byteLength, sha256: sha(bytes), nodeCount: nodeIds.size, edgeCount: tileEdges.length });
}

const manifest = {
  schemaVersion: 2,
  regionId,
  regionName: `${source.regionName} (clipped fixture)`,
  version,
  compression: "gzip-json",
  buildDate: source.buildDate,
  sourceDataDate: source.sourceDataDate,
  snapshotUrl: source.snapshotUrl,
  sourceUrl: source.sourceUrl,
  bounds: { minLon, minLat, maxLon, maxLat },
  checksums: { inventorySha256: sha(inventory.map((t) => `${t.tileId}:${t.sha256}`).join("\n")) },
  attribution: source.attribution,
  tiles: inventory,
  tileByteTotal: inventory.reduce((sum, t) => sum + t.bytes, 0),
};
await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(outRoot, regionId, "active.json"), `${JSON.stringify({ version })}\n`);
console.log(`${regionId}: ${inventory.length} tiles, ${manifest.tileByteTotal} bytes, ${edges.size} edges`);
