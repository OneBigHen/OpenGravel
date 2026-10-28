/**
 * OSM input for the trail catalog job.
 *
 * A `.osm.pbf` is streamed through `osmium export` (osmium-tool must be on
 * PATH, as it already is for `infra/maps/scripts/fetch-osm.sh`) and read as a
 * GeoJSON sequence; a pre-exported `.geojsonseq`/`.geojson`/`.ndjson` file is
 * read directly. There is no OSM protobuf reader in `node_modules`, so the
 * pipeline never pretends to parse a PBF itself.
 *
 * Two exports are made from the PBF:
 *  - trail lines: `route=hiking|foot` relations and `highway=path|footway|track`
 *    ways, with referenced objects so relation members and node geometry are
 *    present for osmium to assemble; and
 *  - places: trailhead and parking objects only, so the point export does not
 *    carry every node of every member way.
 *
 * The exact commands are printed by `osmiumCommands()` and documented in
 * `infra/trails/README.md`.
 */

import { spawn } from "node:child_process";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

import type { Coordinate } from "../../../src/domain/ride/types";
import {
  assembleLines,
  bboxOf,
  isContainedIn,
  linesFromGeometry,
  linesLengthMeters,
  pointFromGeometry,
  polygonCentre,
} from "./geometry";
import type {
  PlaceCandidate,
  TrailAttributes,
  TrailCandidate,
  TrailheadKind,
} from "./types";

export interface OsmFeature {
  readonly properties: Record<string, unknown>;
  readonly geometry: unknown;
}

const TRAIL_HIGHWAYS = new Set(["path", "footway", "track"]);
const HIKING_ROUTES = new Set(["hiking", "foot"]);

/** The curated attributes, in OSM tag spelling. */
const TAG_KEYS: Readonly<Record<keyof TrailAttributes, string>> = {
  name: "name",
  ref: "ref",
  operator: "operator",
  sacScale: "sac_scale",
  surface: "surface",
  trailVisibility: "trail_visibility",
  dog: "dog",
  access: "access",
};

export function textTag(properties: Record<string, unknown>, key: string): string | null {
  const value = properties[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function osmAttributes(properties: Record<string, unknown>): TrailAttributes {
  const value = (field: keyof TrailAttributes): string | null => textTag(properties, TAG_KEYS[field]);
  return {
    name: value("name"),
    ref: value("ref"),
    operator: value("operator"),
    sacScale: value("sacScale"),
    surface: value("surface"),
    trailVisibility: value("trailVisibility"),
    dog: value("dog"),
    access: value("access"),
  };
}

type OsmObjectType = "node" | "way" | "relation";

function osmObjectType(properties: Record<string, unknown>): OsmObjectType | null {
  const raw = properties["@type"] ?? properties.type;
  return raw === "node" || raw === "way" || raw === "relation" ? raw : null;
}

function osmObjectId(properties: Record<string, unknown>, type: OsmObjectType): string {
  const raw = properties["@id"] ?? properties.id;
  const id = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.replace(/^[a-z]+\//i, "") : "unknown";
  return `${type}/${id}`;
}

export function osmUrl(recordId: string): string {
  const [type, id] = recordId.split("/");
  return type === undefined || id === undefined ? "https://www.openstreetmap.org/" : `https://www.openstreetmap.org/${type}/${id}`;
}

/** Member references as `{ type, ref }`, when the input carries them. */
function memberRefs(properties: Record<string, unknown>): readonly { type: OsmObjectType; ref: string; role: string }[] {
  const raw = properties.members ?? properties["@members"];
  if (!Array.isArray(raw)) return [];
  const members: { type: OsmObjectType; ref: string; role: string }[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const member = entry as { type?: unknown; ref?: unknown; role?: unknown };
    const type = member.type;
    if (type !== "node" && type !== "way" && type !== "relation") continue;
    if (member.ref === undefined || member.ref === null) continue;
    // Relation geometry only uses ways; a node member (a role=stop) is not a line.
    members.push({ type, ref: String(member.ref), role: typeof member.role === "string" ? member.role : "" });
  }
  return members;
}

export interface OsmIngest {
  readonly trails: readonly TrailCandidate[];
  readonly places: readonly PlaceCandidate[];
  readonly relationIssues: { missingWays: number; missingRelations: number; cycles: number };
}

/**
 * Normalize OSM features into trail candidates and place candidates.
 *
 * Relations keep their own tags. When the input carries member references the
 * member ways are assembled in relation order; otherwise the geometry that
 * `osmium export` already assembled from those members is used.
 */
export function ingestOsm(features: readonly OsmFeature[]): OsmIngest {
  const wayLines = new Map<string, Coordinate[][]>();
  const relations = new Map<string, OsmFeature>();
  const relationIssues = { missingWays: 0, missingRelations: 0, cycles: 0 };
  for (const feature of features) {
    const type = osmObjectType(feature.properties);
    if (type === "relation") relations.set(osmObjectId(feature.properties, type), feature);
    if (type !== "way") continue;
    wayLines.set(osmObjectId(feature.properties, type), linesFromGeometry(feature.geometry));
  }

  const relationTrails: TrailCandidate[] = [];
  const wayTrails: TrailCandidate[] = [];
  const places: PlaceCandidate[] = [];

  for (const feature of features) {
    const type = osmObjectType(feature.properties);
    if (type === null) continue;
    const recordId = osmObjectId(feature.properties, type);
    const tags = feature.properties;

    if (type === "relation") {
      if (!HIKING_ROUTES.has(textTag(tags, "route") ?? "")) continue;
      const lines = assembleRelation(feature, wayLines, relations, new Set(), relationIssues);
      if (lines.length === 0) continue;
      relationTrails.push({
        sourceId: "osm",
        recordId,
        url: osmUrl(recordId),
        lines,
        attributes: osmAttributes(tags),
      });
      continue;
    }

    if (type === "way") {
      const highway = textTag(tags, "highway");
      const attributes = osmAttributes(tags);
      const kind = placeKind(tags);
      if (kind !== null) {
        const centre = polygonCentre(linesFromGeometry(feature.geometry));
        if (centre !== null) {
          places.push({
            sourceId: "osm",
            recordId,
            url: osmUrl(recordId),
            kind,
            name: attributes.name,
            coordinate: centre,
          });
        }
      }
      // Only named walking ways stand alone; a route relation already describes
      // its members, and an unnamed fragment is not a trail a rider can pick.
      if (highway === null || !TRAIL_HIGHWAYS.has(highway) || attributes.name === null) continue;
      const lines = linesFromGeometry(feature.geometry);
      if (lines.length === 0) continue;
      wayTrails.push({ sourceId: "osm", recordId, url: osmUrl(recordId), lines, attributes });
      continue;
    }

    const kind = placeKind(tags);
    if (kind === null) continue;
    const coordinate = pointFromGeometry(feature.geometry);
    if (coordinate === null) continue;
    places.push({
      sourceId: "osm",
      recordId,
      url: osmUrl(recordId),
      kind,
      name: osmAttributes(tags).name,
      coordinate,
    });
  }

  return { trails: absorbContained([...relationTrails, ...wayTrails]), places, relationIssues };
}

/** ~5.5 km cells: long enough that most trails sit in one, short enough to prune. */
const ABSORB_CELL_DEGREES = 0.05;

function cellsOf(box: readonly [number, number, number, number]): string[] {
  const [west, south, east, north] = box;
  const cells: string[] = [];
  for (let lon = Math.floor(west / ABSORB_CELL_DEGREES); lon <= Math.floor(east / ABSORB_CELL_DEGREES); lon += 1) {
    for (let lat = Math.floor(south / ABSORB_CELL_DEGREES); lat <= Math.floor(north / ABSORB_CELL_DEGREES); lat += 1) {
      cells.push(`${lon},${lat}`);
    }
  }
  return cells;
}

/**
 * Drop a trail whose whole line is already part of a longer OSM trail: a named
 * member way of a route relation, or a sub-relation of a longer route. The same
 * ground must not be listed twice, and the longer relation carries the tags for
 * it. Only a strictly longer trail, or a relation covering a way exactly,
 * absorbs another, so two records of one length both survive.
 *
 * Candidates are bucketed by bounding box first: a state extract holds tens of
 * thousands of trails and comparing every pair would be quadratic for nothing.
 */
export function absorbContained(candidates: readonly TrailCandidate[]): TrailCandidate[] {
  const lengths = candidates.map((candidate) => linesLengthMeters(candidate.lines));
  const cellLists = candidates.map((candidate) => cellsOf(bboxOf(candidate.lines)));
  const cells = new Map<string, number[]>();
  cellLists.forEach((keys, index) => {
    for (const key of keys) {
      const bucket = cells.get(key);
      if (bucket === undefined) cells.set(key, [index]);
      else bucket.push(index);
    }
  });

  return candidates.filter((candidate, index) => {
    const ownLength = lengths[index] ?? 0;
    const nearby = new Set<number>();
    for (const key of cellLists[index] ?? []) {
      for (const other of cells.get(key) ?? []) if (other !== index) nearby.add(other);
    }
    for (const other of nearby) {
      const otherLength = lengths[other] ?? 0;
      const relationOverWay = candidate.recordId.startsWith("way/") && (candidates[other]?.recordId.startsWith("relation/") ?? false);
      if (!(otherLength > ownLength || (relationOverWay && otherLength >= ownLength))) continue;
      const container = candidates[other];
      if (container === undefined) continue;
      if (container.lines.some((line) => candidate.lines.every((own) => isContainedIn(own, line)))) return false;
    }
    return true;
  });
}

function placeKind(properties: Record<string, unknown>): TrailheadKind | null {
  if (textTag(properties, "highway") === "trailhead") return "trailhead";
  if (textTag(properties, "amenity") === "parking") return "parking";
  return null;
}

/** Expand nested route/superroute members, with branch-local cycle detection. */
function assembleRelation(
  feature: OsmFeature,
  wayLines: ReadonlyMap<string, Coordinate[][]>,
  relations: ReadonlyMap<string, OsmFeature>,
  ancestors: ReadonlySet<string>,
  issues: { missingWays: number; missingRelations: number; cycles: number },
): Coordinate[][] {
  const id = osmObjectId(feature.properties, "relation");
  if (ancestors.has(id)) {
    issues.cycles += 1;
    return [];
  }
  const members = memberRefs(feature.properties);
  // Geometry-only input is supported, but missing referenced members never
  // fall back to an unrelated geometry or an invented straight connector.
  if (members.length === 0) return linesFromGeometry(feature.geometry);
  const branch = new Set([...ancestors, id]);
  const segments: Coordinate[][] = [];
  for (const member of members) {
    let lines: Coordinate[][] = [];
    if (member.type === "way") {
      const found = wayLines.get(`way/${member.ref}`);
      if (found === undefined) issues.missingWays += 1;
      else lines = found;
    } else if (member.type === "relation") {
      const child = relations.get(`relation/${member.ref}`);
      if (child === undefined) issues.missingRelations += 1;
      else lines = assembleRelation(child, wayLines, relations, branch, issues);
    }
    if (member.role === "backward") lines = [...lines].reverse().map((line) => [...line].reverse());
    segments.push(...lines);
  }
  return assembleLines(segments);
}

/** Read GeoJSON/GeoJSONSeq/NDJSON records. Streams when the input is a sequence. */
export async function readFeatureFile(path: string): Promise<OsmFeature[]> {
  if (isSequence(path)) {
    const features: OsmFeature[] = [];
    for await (const line of createInterface({ input: createReadStream(path, "utf8") })) {
      const feature = parseFeatureLine(line);
      if (feature !== null) features.push(feature);
    }
    return features;
  }
  return parseFeatureDocument(readFileSync(path, "utf8"));
}

function isSequence(path: string): boolean {
  return /\.(geojsonseq|geojsonl|jsonl|ndjson)$/i.test(path);
}

function parseFeatureLine(line: string): OsmFeature | null {
  // A GeoJSON sequence prefixes each record with an ASCII record separator.
  const body = line.replace(/^\u001e/, "").trim();
  if (body === "") return null;
  try {
    return asOsmFeature(JSON.parse(body));
  } catch {
    // A malformed source record is skipped like osmium's own sequence reader does.
    return null;
  }
}

function parseFeatureDocument(raw: string): OsmFeature[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  const parsed: unknown = trimmed.startsWith("{") || trimmed.startsWith("[") ? safeParse(trimmed) : null;
  if (parsed !== null && !Array.isArray(parsed) && typeof parsed === "object") {
    const document = parsed as { type?: unknown; features?: unknown };
    if (document.type === "FeatureCollection" && Array.isArray(document.features)) {
      return document.features.flatMap((feature) => {
        const parsedFeature = asOsmFeature(feature);
        return parsedFeature === null ? [] : [parsedFeature];
      });
    }
  }
  if (Array.isArray(parsed)) {
    return parsed.flatMap((feature) => {
      const parsedFeature = asOsmFeature(feature);
      return parsedFeature === null ? [] : [parsedFeature];
    });
  }
  // Fall back to a sequence, which is what `osmium export` writes.
  return trimmed.split(/\r?\n/).flatMap((line) => {
    const feature = parseFeatureLine(line);
    return feature === null ? [] : [feature];
  });
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function asOsmFeature(value: unknown): OsmFeature | null {
  if (typeof value !== "object" || value === null) return null;
  const feature = value as { properties?: unknown; geometry?: unknown; type?: unknown };
  if (feature.type === "Feature") {
    const properties = feature.properties;
    return {
      properties: typeof properties === "object" && properties !== null ? (properties as Record<string, unknown>) : {},
      geometry: feature.geometry,
    };
  }
  return null;
}

/** Decode osmium OPL's %hex% escaped Unicode codepoints. */
function decodeOpl(value: string): string {
  return value.replace(/%([0-9a-fA-F]+)%/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

/** Route relations are not emitted as lines by osmium export; read their members separately. */
export async function readOplRelations(path: string): Promise<OsmFeature[]> {
  const features: OsmFeature[] = [];
  for await (const line of createInterface({ input: createReadStream(path, "utf8") })) {
    const parts = line.split(" ");
    const id = parts[0];
    if (!id?.startsWith("r")) continue;
    const tags = parts.find((part) => part.startsWith("T"))?.slice(1) ?? "";
    const memberText = parts.find((part) => part.startsWith("M"))?.slice(1) ?? "";
    const properties: Record<string, unknown> = { "@type": "relation", "@id": id.slice(1) };
    for (const tag of tags.split(",")) {
      const equals = tag.indexOf("=");
      if (equals >= 0) properties[decodeOpl(tag.slice(0, equals))] = decodeOpl(tag.slice(equals + 1));
    }
    properties.members = memberText.split(",").flatMap((member) => {
      const match = /^([nwr])(\d+)@/.exec(member);
      if (!match) return [];
      return [{ type: match[1] === "w" ? "way" : match[1] === "r" ? "relation" : "node", ref: match[2], role: decodeOpl(member.slice(match[0].length)) }];
    });
    features.push({ properties, geometry: null });
  }
  return features;
}

export interface OsmiumExport {
  readonly linesPath: string;
  readonly placesPath: string;
  readonly relationsPath: string;
}

/** The osmium invocations for a PBF, quoted for the README. */
export function osmiumCommands(pbfPath: string, workDir = "/tmp"): readonly (readonly string[])[] {
  const trailsPbf = `${workDir}/trails.osm.pbf`;
  const placesPbf = `${workDir}/trails-places.osm.pbf`;
  return [
    [
      "tags-filter", "--overwrite", "-o", trailsPbf, pbfPath,
      "r/route=hiking,foot",
      // Walking ways, plus the pedestrian ways a route relation may use as a
      // link, so osmium can assemble a relation without holes in the middle.
      "w/highway=path,footway,track,steps,bridleway,cycleway,pedestrian",
    ],
    ["cat", "--overwrite", "-t", "relation", "-f", "opl", "-o", `${workDir}/relations.opl`, trailsPbf],
    [
      "export", "--overwrite", "--no-progress", "-f", "geojsonseq",
      "--geometry-types=linestring", "-a", "type,id", "-o", `${workDir}/trails.geojsonseq`, trailsPbf,
    ],
    [
      "tags-filter", "--overwrite", "-o", placesPbf, pbfPath,
      "n/highway=trailhead", "n/amenity=parking",
      "w/highway=trailhead", "w/amenity=parking", "a/amenity=parking",
    ],
    [
      "export", "--overwrite", "--no-progress", "-f", "geojsonseq",
      "--geometry-types=point,polygon", "-a", "type,id", "-o", `${workDir}/trails-places.geojsonseq`, placesPbf,
    ],
  ];
}

/** Export a PBF through osmium into the two GeoJSON sequences the job reads. */
export async function exportOsm(pbfPath: string, workDir: string): Promise<OsmiumExport> {
  const commands = osmiumCommands(pbfPath, workDir);
  for (const args of commands) {
    await runOsmium(args, pbfPath);
  }
  return { linesPath: `${workDir}/trails.geojsonseq`, placesPath: `${workDir}/trails-places.geojsonseq`, relationsPath: `${workDir}/relations.opl` };
}

async function runOsmium(args: readonly string[], pbfPath: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("osmium", [...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.once("error", () => {
      reject(
        new Error(
          `osmium is required to read ${pbfPath} (there is no OSM PBF reader in node_modules).\n` +
            `Install osmium-tool and run:\n  ${osmiumCommands(pbfPath, workDirOf(args)).map((command) => `osmium ${command.join(" ")}`).join("\n  ")}`,
        ),
      );
    });
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`osmium ${args[0] ?? ""} exited ${code ?? "unknown"}: ${stderr.trim()}`));
    });
  });
}

function workDirOf(args: readonly string[]): string {
  const outputIndex = args.indexOf("-o");
  const output = outputIndex === -1 ? undefined : args[outputIndex + 1];
  return output !== undefined && output.includes("/") ? output.slice(0, output.lastIndexOf("/")) : "/tmp";
}
