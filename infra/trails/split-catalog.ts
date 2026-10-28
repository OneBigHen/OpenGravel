#!/usr/bin/env node
// Usage: tsx infra/trails/split-catalog.ts CATALOG_DIR — writes hikes.summary.json and
// hikes.details.jsonl next to hikes.json (see src/server/hikes/catalog-split.ts).
import { openSync, readFileSync, statSync, writeFileSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import type { HikeCatalog } from './lib/types';
import { detailsPathFor, featureIndexPathFor, featureLinesPathFor, splitRecord, summaryPathFor } from '../../src/server/hikes/catalog-split';
import type { TrailFeatureCollection } from './lib/types';

const dir = process.argv[2];
if (!dir) throw new Error('split-catalog.ts CATALOG_DIR');
const path = join(dir, 'hikes.json');
const catalog = JSON.parse(readFileSync(path, 'utf8')) as HikeCatalog;
const out = openSync(detailsPathFor(path), 'w');
let offset = 0;
const hikes = catalog.hikes.map((hike) => {
  const { summary, line } = splitRecord(hike, offset);
  writeSync(out, line);
  offset += Buffer.byteLength(line);
  return summary;
});
closeSync(out);
writeFileSync(summaryPathFor(path), JSON.stringify({ ...catalog, hikes }));
console.log(`${hikes.length} trails · summary ${(statSync(summaryPathFor(path)).size / 1e6).toFixed(1)} MB · details ${(offset / 1e6).toFixed(1)} MB`);

const geojson = join(dir, 'trails.geojson');
const collection = JSON.parse(readFileSync(geojson, 'utf8')) as TrailFeatureCollection;
const lines = openSync(featureLinesPathFor(geojson), 'w');
const index: Record<string, { offset: number; length: number }> = {};
let at = 0;
for (const feature of collection.features) {
  const line = `${JSON.stringify(feature)}\n`;
  writeSync(lines, line);
  index[feature.id] = { offset: at, length: Buffer.byteLength(line) - 1 };
  at += Buffer.byteLength(line);
}
closeSync(lines);
writeFileSync(featureIndexPathFor(geojson), JSON.stringify(index));
console.log(`${collection.features.length} trail lines · index ${(statSync(featureIndexPathFor(geojson)).size / 1e6).toFixed(1)} MB`);
