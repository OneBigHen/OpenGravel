#!/usr/bin/env node
/** Enrich an existing measured catalog without remeasuring unchanged geometry. */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { withAttribution } from "./lib/licence";
import { attachTrailheads, PlaceGrid } from "./lib/trailhead";
import { ingestOsm, readFeatureFile } from "./lib/osm-input";
import { alongTrailFeatures, featureGrid } from "./lib/features";
import { contextIndex, trailContext, catalogDifficulty } from "./lib/context";
import type { HikeCatalog, TrailFeatureCollection } from "./lib/types";

export async function enrichCatalog(base: string, contexts: readonly string[], out: string) {
  const catalog = JSON.parse(readFileSync(join(base,"hikes.json"),"utf8")) as HikeCatalog;
  const collection = JSON.parse(readFileSync(join(base,"trails.geojson"),"utf8")) as TrailFeatureCollection;
  const osm = (await Promise.all(contexts.map(readFeatureFile))).flat();
  const grid = featureGrid(osm);
  const places = new PlaceGrid(ingestOsm(osm).places);
  const context = contextIndex(osm);
  const enriched = new Map(collection.features.map((feature,i) => {
    const coordinates = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const lines = coordinates.map(line => line.map(([lon,lat]) => ({lon,lat})));
    const features = alongTrailFeatures(lines,grid);
    const trailheads = attachTrailheads(lines, places);
    const rich = { ...trailContext(lines,context), trailheads, trailheadCount: trailheads.length, features, featureCount: features.length, featureKinds: [...new Set(features.map(f => f.kind))].sort() };
    if (i % 1000 === 0) process.stderr.write(`features: ${i}/${collection.features.length}\n`);
    return [feature.id,rich] as const;
  }));
  const hikes = catalog.hikes.map(h => ({...withAttribution(h),...enriched.get(h.id),difficulty:catalogDifficulty(h)}));
  const byId = new Map(hikes.map(h => [h.id,h]));
  const features = collection.features.map(f => ({...f,properties: {...withAttribution(f.properties),...enriched.get(f.id),difficulty:byId.get(f.id)?.difficulty}}));
  mkdirSync(out,{recursive:true});
  if(existsSync(join(base,"sources"))) cpSync(join(base,"sources"),join(out,"sources"),{recursive:true});
  if(existsSync(join(base,"official-stats.json"))) cpSync(join(base,"official-stats.json"),join(out,"official-stats.json"));
  writeFileSync(join(out,"hikes.json"),JSON.stringify({...catalog,counts:{...catalog.counts,withTrailhead:hikes.filter(h=>h.trailheadCount>0).length},hikes})+"\n");
  writeFileSync(join(out,"trails.geojson"),JSON.stringify({...collection,features})+"\n");
  process.stderr.write(`enriched ${hikes.length} trails, ${hikes.reduce((n,h)=> n+(h.featureCount ?? 0),0)} feature matches\n`);
}
if (process.argv[1] && resolve(process.argv[1]).endsWith("infra/trails/enrich-trails.ts")) {
  const args = process.argv.slice(2);
  const value = (key: string) => args[args.indexOf(key)+1];
  const base = value("--base"), out = value("--out");
  const contexts = args.flatMap((arg,i) => arg === "--context" && args[i+1] ? [args[i+1]!] : []);
  if (!args.includes("--base") || !args.includes("--out") || !contexts.length || !base || !out) throw new Error("--base DIR --context FILE [--context FILE] --out DIR required");
  if (resolve(base) === resolve(out)) throw new Error("base and output must differ");
  void enrichCatalog(base,contexts,out).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
