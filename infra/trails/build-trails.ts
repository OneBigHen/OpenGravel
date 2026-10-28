#!/usr/bin/env node

/**
 * Build the OpenGravel trail catalog (HIKE-MODE-PLAN H1 item 4).
 *
 * Inputs: a regional OSM extract (`.osm.pbf`, exported through osmium-tool —
 * there is no OSM PBF reader in `node_modules`) or an osmium-produced GeoJSON
 * sequence, plus optional USFS National Forest System Trails and NPS trails
 * GeoJSON files.
 *
 * Outputs, in `--out`:
 *  - `trails.geojson`: one feature per physical trail, merged across sources.
 *  - `hikes.json`: the compact index Explore and the API read.
 *
 * What this job does NOT do: elevation gain and loss, Tobler time, surface mix
 * and along-the-way features need a DEM and the OSM tag dump, and are H1 item 5.
 * They are written as `null`, never as zero.
 *
 * Usage:
 *   node --import tsx infra/trails/build-trails.ts \
 *     --osm infra/maps/data/source/pa-nj.osm.pbf \
 *     --usfs infra/trails/data/source/usfs-nfs-trails.geojson \
 *     --nps infra/trails/data/source/nps-trails.geojson \
 *     --out infra/trails/data/out
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { NPS_TRAILS, USFS_TRAILS, readExternalSource } from "./lib/external";
import { mergeTrails } from "./lib/merge";
import { exportOsm, ingestOsm, osmiumCommands, readFeatureFile } from "./lib/osm-input";
import { serialize, toFeatureCollection, toHikeCatalog } from "./lib/output";
import { DEFAULT_TRAILHEAD_RADIUS_METERS } from "./lib/trailhead";
import type { PlaceCandidate, Trail, TrailCandidate, TrailFeatureCollection, HikeCatalog } from "./lib/types";

export interface BuildInput {
  /** `.osm.pbf`, `.geojsonseq`, `.geojson` or `.ndjson`. */
  readonly osm: string;
  /** Extra GeoJSON sequence of OSM trailhead/parking places (a second osmium export). */
  readonly osmPlaces?: string;
  readonly usfs?: string;
  readonly nps?: string;
  readonly trailheadRadiusMeters?: number;
  /** Called with progress lines; the CLI prints them to stderr. */
  readonly log?: (message: string) => void;
}

export interface BuildResult {
  readonly trails: readonly Trail[];
  readonly trailsGeoJson: TrailFeatureCollection;
  readonly hikes: HikeCatalog;
}

export function isPbf(path: string): boolean {
  return /\.pbf$/i.test(path);
}

interface ResolvedSources {
  readonly osmFiles: readonly string[];
  readonly placeFiles: readonly string[];
}

/** A PBF is exported through osmium into two GeoJSON sequences; plain files are read as they are. */
export async function resolveSources(
  input: Pick<BuildInput, "osm" | "osmPlaces">,
  workDir: string | null,
  log: (message: string) => void = () => undefined,
): Promise<ResolvedSources> {
  if (workDir === null) {
    return { osmFiles: [input.osm], placeFiles: input.osmPlaces === undefined ? [] : [input.osmPlaces] };
  }
  log(`exporting ${input.osm} with osmium (4 passes)`);
  const exported = await exportOsm(input.osm, workDir);
  return {
    osmFiles: [exported.linesPath],
    placeFiles: [exported.placesPath, ...(input.osmPlaces === undefined ? [] : [input.osmPlaces])],
  };
}

/** Run the whole job in memory: read every source, merge, shape the outputs. */
export async function buildTrailCatalog(input: BuildInput): Promise<BuildResult> {
  const log = input.log ?? (() => undefined);
  const candidates: TrailCandidate[] = [];
  const places: PlaceCandidate[] = [];
  let skippedNotOnGround = 0;

  const workDir = isPbf(input.osm) ? mkdtempSync(join(tmpdir(), "ogv-trails-")) : null;

  try {
    const sources = await resolveSources(input, workDir, log);
    for (const path of sources.osmFiles) {
      const features = await readFeatureFile(path);
      log(`osm: ${features.length} features from ${path}`);
      const ingest = ingestOsm(features);
      candidates.push(...ingest.trails);
      places.push(...ingest.places);
    }
    for (const path of sources.placeFiles) {
      const features = await readFeatureFile(path);
      log(`osm places: ${features.length} features from ${path}`);
      places.push(...ingestOsm(features).places);
    }
    if (input.usfs !== undefined) {
      const usfs = await readExternalSource(input.usfs, USFS_TRAILS);
      candidates.push(...usfs.trails);
      skippedNotOnGround += usfs.skippedNotOnGround;
      log(`usfs: ${usfs.trails.length} trails from ${input.usfs}`);
    }
    if (input.nps !== undefined) {
      const nps = await readExternalSource(input.nps, NPS_TRAILS);
      candidates.push(...nps.trails);
      skippedNotOnGround += nps.skippedNotOnGround;
      log(`nps: ${nps.trails.length} trails from ${input.nps}`);
    }
  } finally {
    // The intermediate osmium exports are throwaway: only the two output files matter.
    if (workDir !== null) rmSync(workDir, { recursive: true, force: true });
  }

  if (skippedNotOnGround > 0) {
    log(`skipped ${skippedNotOnGround} agency records marked proposed, planned or decommissioned`);
  }

  const trails = mergeTrails(candidates, places, { trailheadRadiusMeters: input.trailheadRadiusMeters });
  const result: BuildResult = {
    trails,
    trailsGeoJson: toFeatureCollection(trails),
    hikes: toHikeCatalog(trails),
  };
  log(
    `merged ${candidates.length} source records into ${trails.length} trails ` +
      `(${result.hikes.counts.merged} multi-source, ${result.hikes.counts.withTrailhead} with a trailhead)`,
  );
  return result;
}

export interface WriteResult {
  readonly trailsPath: string;
  readonly hikesPath: string;
}

export function writeCatalog(outDir: string, result: BuildResult): WriteResult {
  mkdirSync(outDir, { recursive: true });
  const trailsPath = join(outDir, "trails.geojson");
  const hikesPath = join(outDir, "hikes.json");
  writeFileSync(trailsPath, serialize(result.trailsGeoJson));
  writeFileSync(hikesPath, serialize(result.hikes));
  return { trailsPath, hikesPath };
}

interface CliOptions {
  readonly osm: string;
  readonly outDir: string;
  readonly usfs?: string;
  readonly nps?: string;
  readonly osmPlaces?: string;
  readonly trailheadRadiusMeters?: number;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (!argument.startsWith("--")) throw new Error(`unexpected argument: ${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${argument} needs a value`);
    values.set(argument.slice(2), value);
    index += 1;
  }
  const osm = values.get("osm");
  if (osm === undefined) throw new Error("--osm is required");
  const outDir = values.get("out");
  if (outDir === undefined) throw new Error("--out is required");
  for (const path of [osm, values.get("osm-places"), values.get("usfs"), values.get("nps")]) {
    if (path !== undefined && !existsSync(path)) throw new Error(`missing input file: ${path}`);
  }
  const radius = values.get("trailhead-radius");
  const parsedRadius = radius === undefined ? undefined : Number(radius);
  if (parsedRadius !== undefined && (!Number.isFinite(parsedRadius) || parsedRadius <= 0)) {
    throw new Error(`--trailhead-radius must be a positive number of metres, got ${radius ?? ""}`);
  }
  return {
    osm,
    outDir,
    usfs: values.get("usfs"),
    nps: values.get("nps"),
    osmPlaces: values.get("osm-places"),
    trailheadRadiusMeters: parsedRadius,
  };
}

const USAGE = `usage: build-trails.ts --osm INPUT --out DIR [--usfs FILE] [--nps FILE] [--osm-places FILE] [--trailhead-radius METERS]

INPUT is a .osm.pbf (exported with osmium-tool) or an osmium-produced
GeoJSON sequence. See infra/trails/README.md for the exact commands.`;

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  // A missing osmium is a setup problem, not a crash: say what to run instead.
  if (isPbf(options.osm)) {
    const commands = osmiumCommands(options.osm, "<work-dir>")
      .map((command) => `  osmium ${command.join(" ")}`)
      .join("\n");
    process.stderr.write(`reading ${options.osm} through osmium-tool:\n${commands}\n`);
  }

  try {
    const result = await buildTrailCatalog({
      osm: options.osm,
      osmPlaces: options.osmPlaces,
      usfs: options.usfs,
      nps: options.nps,
      trailheadRadiusMeters: options.trailheadRadiusMeters ?? DEFAULT_TRAILHEAD_RADIUS_METERS,
      log: (message) => process.stderr.write(`${message}\n`),
    });
    const written = writeCatalog(options.outDir, result);
    process.stderr.write(`wrote ${written.trailsPath} and ${written.hikesPath}\n`);
  } catch (error) {
    process.stderr.write(`trail catalog failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]).endsWith(join("infra", "trails", "build-trails.ts"));

if (invokedDirectly) {
  void main().catch((error: unknown) => {
    process.stderr.write(`trail catalog failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
