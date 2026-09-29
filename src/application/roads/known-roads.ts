/**
 * Known roads a route rides (M3, OGV-D-264): the rated curvy-road catalogue and
 * the Gravel Atlas's verified gravel corridors.
 *
 * The engine's own tags say *what kind* of road a metre is; these catalogues
 * say *which* road it is, and that it was checked. A route that rides Decker
 * Road for four miles can say so by name, and a verified gravel corridor is a
 * stronger surface fact than an OSM tag. The catalogues are read through a port
 * (`KnownRoadsPort`) so the SQLite files stay a server concern.
 */

import type { EvidenceValue } from "@/domain/evidence/types";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteEvidence } from "@/domain/route/types";

import { indexRoute, lineOverlap } from "./route-overlap";

export interface Bounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface KnownCurvyRoad {
  readonly id: string;
  readonly name: string;
  /** Catalogue curvature score (300 = curvy … 1500 = the twistiest rated). */
  readonly rating: number;
  readonly line: readonly Coordinate[];
}

export interface KnownGravelCorridor {
  readonly id: string;
  readonly label: string;
  readonly line: readonly Coordinate[];
  readonly confidence: number;
}

export interface KnownRoadsPort {
  readonly curvyRoadsNear: (bounds: Bounds) => readonly KnownCurvyRoad[];
  readonly gravelCorridorsNear: (bounds: Bounds) => readonly KnownGravelCorridor[];
}

export interface RiddenCurvyRoad {
  readonly name: string;
  readonly rating: number;
  readonly riddenMeters: number;
}

export interface NamedRoadsValue {
  readonly roads: readonly RiddenCurvyRoad[];
  /** Metres of the route on rated curvy roads, named or not. */
  readonly ratedMeters: number;
}

export interface VerifiedGravelValue {
  readonly meters: number;
  readonly corridors: readonly string[];
}

/** A road counts as ridden past this many metres, or half its rated length. */
const MIN_RIDDEN_METERS = 800;
const MIN_RIDDEN_SHARE = 0.5;
/** At most this many roads are named; the longest-ridden first. */
export const MAX_NAMED_ROADS = 3;
const UNNAMED = /^(unnamed|unknown)|^\d+$/i;

const CATALOGUE_SOURCE = {
  id: "curvy-road-catalogue",
  label: "Rated curvy-road catalogue",
  category: "derived" as const,
};
const GRAVEL_ATLAS_SOURCE = {
  id: "gravel-atlas",
  label: "Gravel Atlas verified corridors",
  category: "survey" as const,
  authoritativeFor: ["surface"],
};

/** `very twisty` / `twisty` / `curvy`, from the catalogue score. */
export function ratingWord(rating: number): string {
  if (rating >= 1000) return "very twisty";
  if (rating >= 600) return "twisty";
  return "curvy";
}

function padded(bounds: Bounds, degrees: number): Bounds {
  return {
    west: bounds.west - degrees,
    south: bounds.south - degrees,
    east: bounds.east + degrees,
    north: bounds.north + degrees,
  };
}

/**
 * The evidence the catalogues support for one route line. Both keys are
 * outside the scored §18 set: they explain and name, they do not re-score
 * what the engine's curvature and surface already measure.
 */
export function knownRoadEvidence(
  route: readonly Coordinate[],
  port: KnownRoadsPort,
): RouteEvidence {
  if (route.length < 2) return {};
  const index = indexRoute(route);
  // A road is looked up by its midpoint; pad so a long road whose middle lies
  // just outside the route's box is still considered (~3 km).
  const bounds = padded(index.bounds, 0.03);
  const evidence: Record<string, EvidenceValue<unknown>> = {};

  const byName = new Map<string, RiddenCurvyRoad>();
  let ratedMeters = 0;
  for (const road of port.curvyRoadsNear(bounds)) {
    const overlap = lineOverlap(index, road.line);
    if (overlap.riddenMeters <= 0) continue;
    const ridden =
      overlap.riddenMeters >= MIN_RIDDEN_METERS ||
      (overlap.lineMeters > 0 && overlap.riddenMeters / overlap.lineMeters >= MIN_RIDDEN_SHARE);
    if (!ridden) continue;
    ratedMeters += overlap.riddenMeters;
    if (UNNAMED.test(road.name.trim()) || road.name.trim() === "") continue;
    // One road is often several catalogue segments: sum them under its name.
    const previous = byName.get(road.name);
    byName.set(road.name, {
      name: road.name,
      rating: Math.max(previous?.rating ?? 0, road.rating),
      riddenMeters: (previous?.riddenMeters ?? 0) + overlap.riddenMeters,
    });
  }
  if (ratedMeters > 0) {
    const roads = [...byName.values()]
      .sort((left, right) => right.riddenMeters - left.riddenMeters || left.name.localeCompare(right.name))
      .slice(0, MAX_NAMED_ROADS);
    evidence["namedRoads"] = {
      value: { roads, ratedMeters } satisfies NamedRoadsValue,
      status: "estimated",
      confidence: 0.7,
      provenance: [CATALOGUE_SOURCE],
    };
  }

  let gravelMeters = 0;
  let weighted = 0;
  const corridors: string[] = [];
  for (const corridor of port.gravelCorridorsNear(bounds)) {
    const overlap = lineOverlap(index, corridor.line);
    if (overlap.riddenMeters < 100) continue;
    gravelMeters += overlap.riddenMeters;
    weighted += overlap.riddenMeters * corridor.confidence;
    if (!UNNAMED.test(corridor.label)) corridors.push(corridor.label);
  }
  if (gravelMeters > 0) {
    evidence["verifiedGravel"] = {
      value: { meters: gravelMeters, corridors: [...new Set(corridors)] } satisfies VerifiedGravelValue,
      status: "known",
      confidence: Number((weighted / gravelMeters).toFixed(3)),
      provenance: [GRAVEL_ATLAS_SOURCE],
    };
  }
  return evidence;
}

const METERS_PER_MILE = 1609.344;

function miles(meters: number): string {
  const value = meters / METERS_PER_MILE;
  return `${value >= 10 ? Math.round(value) : Number(value.toFixed(1))} mi`;
}

function isNamedRoads(value: unknown): value is NamedRoadsValue {
  return typeof value === "object" && value !== null && Array.isArray((value as NamedRoadsValue).roads);
}

/** `Rides Decker Road (very twisty, 4.1 mi) and Smith Gap Road (twisty, 2 mi).` */
export function namedRoadsSentence(evidence: EvidenceValue<unknown> | undefined): string | null {
  if (evidence === undefined || !isNamedRoads(evidence.value)) return null;
  const { roads, ratedMeters } = evidence.value;
  if (roads.length === 0) {
    return ratedMeters > 0 ? `Rides ${miles(ratedMeters)} of rated curvy road.` : null;
  }
  const parts = roads.map((road) => `${road.name} (${ratingWord(road.rating)}, ${miles(road.riddenMeters)})`);
  const joined = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Rides ${joined}.`;
}

/** `3.2 mi of verified gravel (Old Mine Road).` */
export function verifiedGravelSentence(evidence: EvidenceValue<unknown> | undefined): string | null {
  if (evidence === undefined || typeof evidence.value !== "object" || evidence.value === null) return null;
  const value = evidence.value as Partial<VerifiedGravelValue>;
  if (typeof value.meters !== "number" || !(value.meters > 0)) return null;
  const names = (value.corridors ?? []).slice(0, 2);
  return `${miles(value.meters)} of surveyed gravel${names.length > 0 ? ` (${names.join(", ")})` : ""}.`;
}
