#!/usr/bin/env node
// Usage: tsx infra/trails/split-catalog.ts CATALOG_DIR — writes hikes.summary.json and
// hikes.details.jsonl next to hikes.json (see src/server/hikes/catalog-split.ts).
import { openSync, readFileSync, statSync, writeFileSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import type { HikeCatalog } from './lib/types';
import { detailsPathFor, splitRecord, summaryPathFor } from '../../src/server/hikes/catalog-split';

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
