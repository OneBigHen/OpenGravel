/**
 * Merge the same trail seen by several sources.
 *
 * Duplicates are detected two ways: an exact vertex-signature match (both
 * sources came from the same OSM nodes) and a conservative near match (both
 * ends within 75 m of each other and a length within 10 %). Everything else
 * stays separate — a false merge would credit one trail's access or surface to
 * another, which is worse than listing a trail twice.
 *
 * A merged trail keeps every source that described it, the geometry of the most
 * complete description, and the highest-priority value for each attribute.
 * When two sources disagree, both values are recorded in `conflicts` so a
 * rider-facing surface never hides a contradiction.
 */

import {
  geometryNeighbourKey,
  geometrySignature,
  lineLengthMeters,
  linesLengthMeters,
  longestLine,
  primaryEndpoints,
  type Line,
} from "./geometry";
import { haversine } from "../../../src/domain/geometry/analysis";
import { attachTrailheads, PlaceGrid, DEFAULT_TRAILHEAD_RADIUS_METERS } from "./trailhead";
import type {
  AttributeField,
  PlaceCandidate,
  Trail,
  TrailCandidate,
  TrailConflict,
  TrailSource,
  TrailSourceId,
} from "./types";
import { ATTRIBUTE_FIELDS } from "./types";

/** Lower wins. OSM first: it is the freshest and the routing base. */
export const SOURCE_PRIORITY: Readonly<Record<TrailSourceId, number>> = { osm: 0, usfs: 1, nps: 2, dcnr: 3, njdep: 4 };

export const SOURCE_LABELS: Readonly<Record<TrailSourceId, string>> = {
  osm: "OpenStreetMap",
  usfs: "USDA Forest Service",
  nps: "National Park Service",
  dcnr: "PA DCNR",
  njdep: "NJDEP Geographic Information System (GIS)",
};

/** Sources that digitized the same ground never line up vertex for vertex. */
const NEAR_ENDPOINT_METERS = 75;
const NEAR_LENGTH_RATIO = 0.1;
const NEAR_LENGTH_METERS = 50;

interface Cluster {
  readonly candidates: TrailCandidate[];
}

type Bucket = Map<string, number[]>;

/**
 * Bucket keys to look at, including the neighbouring length bands: two
 * digitizations of one trail must land somewhere they can meet even when a band
 * boundary splits them.
 */
function neighbourKeys(candidate: TrailCandidate): readonly string[] {
  const key = geometryNeighbourKey(candidate.lines, linesLengthMeters(candidate.lines));
  const [endpoints, band] = key.split("#");
  const bandNumber = Number(band ?? "0");
  return [bandNumber - 1, bandNumber, bandNumber + 1].map((value) => `${endpoints ?? ""}#${value}`);
}

function isNearDuplicate(a: readonly Line[], aLength: number, b: readonly Line[], bLength: number): boolean {
  // Two lines are the same ground when both ends line up and the lengths agree.
  const aEnds = primaryEndpoints(a);
  const bEnds = primaryEndpoints(b);
  if (aEnds === null || bEnds === null) return false;
  const longer = Math.max(aLength, bLength);
  if (Math.abs(aLength - bLength) > Math.max(NEAR_LENGTH_METERS, longer * NEAR_LENGTH_RATIO)) return false;
  const forward =
    haversine(aEnds[0], bEnds[0]) <= NEAR_ENDPOINT_METERS && haversine(aEnds[1], bEnds[1]) <= NEAR_ENDPOINT_METERS;
  const reversed =
    haversine(aEnds[0], bEnds[1]) <= NEAR_ENDPOINT_METERS && haversine(aEnds[1], bEnds[0]) <= NEAR_ENDPOINT_METERS;
  return forward || reversed;
}

function sourceOf(candidate: TrailCandidate, label: string): TrailSource {
  if (candidate.sourceId === "dcnr" || candidate.sourceId === "njdep") throw new Error("State sources require reviewed terms through the official overlay");
  return {
    sourceId: candidate.sourceId,
    sourceLabel: label,
    licence: candidate.sourceId === "osm" ? "ODbL 1.0" : "Public domain (US federal government)",
    licenceUrl: candidate.sourceId === "osm" ? "https://www.openstreetmap.org/copyright" : "https://www.usa.gov/government-works",
    recordId: candidate.recordId,
    url: candidate.url,
  };
}

function bySourcePriority(a: TrailCandidate, b: TrailCandidate): number {
  return (
    SOURCE_PRIORITY[a.sourceId] - SOURCE_PRIORITY[b.sourceId] ||
    a.recordId.localeCompare(b.recordId)
  );
}

const primaryLineLength = (candidate: TrailCandidate): number => {
  const line = longestLine(candidate.lines);
  return line === null ? 0 : lineLengthMeters(line);
};

/** The most complete geometry wins; ties go to the higher-priority source. */
function primaryOf(candidates: readonly TrailCandidate[]): TrailCandidate {
  const [first, ...rest] = candidates;
  if (first === undefined) throw new Error("cluster without a candidate");
  let best = first;
  let bestLength = primaryLineLength(best);
  for (const candidate of rest) {
    const length = primaryLineLength(candidate);
    if (length > bestLength || (length === bestLength && bySourcePriority(candidate, best) < 0)) {
      best = candidate;
      bestLength = length;
    }
  }
  return best;
}

interface ResolvedField {
  readonly value: string | null;
  readonly conflicts: readonly TrailConflict[];
}

/** Highest-priority non-null value; every other distinct value becomes a conflict. */
function resolveField(
  field: AttributeField,
  ordered: readonly TrailCandidate[],
): ResolvedField {
  const withValue = ordered.flatMap((candidate) => {
    const value = candidate.attributes[field];
    return value === null ? [] : [{ sourceId: candidate.sourceId, value }];
  });
  const kept = withValue[0];
  if (kept === undefined) return { value: null, conflicts: [] };
  const conflicts: TrailConflict[] = [];
  for (const other of withValue.slice(1)) {
    if (other.value === kept.value) continue;
    if (conflicts.some((conflict) => conflict.other.value === other.value)) continue;
    conflicts.push({ field, kept, other });
  }
  return { value: kept.value, conflicts };
}

/**
 * "Best name": the highest-priority source that named the trail, and among
 * equals the more descriptive name (longer, then alphabetical) so a clipped
 * abbreviation does not beat the full name.
 */
function resolveName(candidates: readonly TrailCandidate[]): string | null {
  const named = candidates.filter((candidate) => candidate.attributes.name !== null);
  if (named.length === 0) return null;
  const best = [...named].sort(
    (a, b) =>
      SOURCE_PRIORITY[a.sourceId] - SOURCE_PRIORITY[b.sourceId] ||
      (b.attributes.name ?? "").length - (a.attributes.name ?? "").length ||
      (a.attributes.name ?? "").localeCompare(b.attributes.name ?? ""),
  )[0];
  return best?.attributes.name ?? null;
}

export interface MergeOptions {
  readonly trailheadRadiusMeters?: number;
}

/** Cluster candidates into the same physical trail. */
export function clusterCandidates(candidates: readonly TrailCandidate[]): TrailCandidate[][] {
  // One record is one trail: the same source id arriving twice (the same file
  // passed as both `--osm` and `--osm-places`, say) must not create two features
  // with one id, and the longer geometry of the two is the one kept.
  const unique = new Map<string, TrailCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.sourceId}:${candidate.recordId}`;
    const existing = unique.get(key);
    if (existing === undefined || primaryLineLength(candidate) > primaryLineLength(existing)) unique.set(key, candidate);
  }
  const ordered = [...unique.values()].sort(bySourcePriority);
  const exact = new Map<string, number>();
  const buckets: Bucket = new Map();
  const clusters: Cluster[] = [];

  const register = (index: number, candidate: TrailCandidate): void => {
    exact.set(geometrySignature(candidate.lines), index);
    for (const key of neighbourKeys(candidate)) {
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [index]);
      else if (!bucket.includes(index)) bucket.push(index);
    }
  };

  for (const candidate of ordered) {
    const signature = geometrySignature(candidate.lines);
    const exactHit = exact.get(signature);
    if (exactHit !== undefined) {
      clusters[exactHit]?.candidates.push(candidate);
      continue;
    }
    const length = linesLengthMeters(candidate.lines);
    let nearHit: number | undefined;
    for (const key of neighbourKeys(candidate)) {
      for (const index of buckets.get(key) ?? []) {
        const cluster = clusters[index];
        if (cluster === undefined) continue;
        const duplicate = cluster.candidates.some((member) =>
          isNearDuplicate(member.lines, linesLengthMeters(member.lines), candidate.lines, length),
        );
        if (duplicate) {
          nearHit = index;
          break;
        }
      }
      if (nearHit !== undefined) break;
    }
    if (nearHit !== undefined) {
      clusters[nearHit]?.candidates.push(candidate);
      register(nearHit, candidate);
      continue;
    }
    const index = clusters.length;
    clusters.push({ candidates: [candidate] });
    register(index, candidate);
  }

  return clusters.map((cluster) => cluster.candidates);
}

export function mergeTrails(
  candidates: readonly TrailCandidate[],
  places: readonly PlaceCandidate[] = [],
  options: MergeOptions = {},
): Trail[] {
  const grid = new PlaceGrid(places);
  const radius = options.trailheadRadiusMeters ?? DEFAULT_TRAILHEAD_RADIUS_METERS;
  const trails: Trail[] = [];

  for (const cluster of clusterCandidates(candidates)) {
    const primary = primaryOf(cluster);
    const ordered = [...cluster].sort(bySourcePriority);
    const conflicts: TrailConflict[] = [];
    const attributes: Record<AttributeField, string | null> = {
      name: resolveName(ordered),
      ref: null,
      operator: null,
      sacScale: null,
      surface: null,
      trailVisibility: null,
      dog: null,
      access: null,
    };
    for (const field of ATTRIBUTE_FIELDS) {
      if (field === "name") continue;
      const resolved = resolveField(field, ordered);
      attributes[field] = resolved.value;
      conflicts.push(...resolved.conflicts);
    }

    const seen = new Set<string>();
    const sources: TrailSource[] = [];
    for (const candidate of ordered) {
      const key = `${candidate.sourceId}:${candidate.recordId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push(sourceOf(candidate, SOURCE_LABELS[candidate.sourceId]));
    }

    // The id follows the highest-priority source, not whichever geometry won,
    // so a rebuild cannot silently renumber a trail when an agency redigitizes it.
    const identity = ordered[0] ?? primary;
    trails.push({
      id: `${identity.sourceId}:${identity.recordId}`,
      lines: primary.lines,
      attributes,
      sources,
      conflicts,
      trailheads: attachTrailheads(primary.lines, grid, radius),
      lengthMeters: Math.round(linesLengthMeters(primary.lines)),
    });
  }

  // Deterministic output: the same inputs always produce the same file bytes.
  return trails.sort((a, b) => a.id.localeCompare(b.id));
}
