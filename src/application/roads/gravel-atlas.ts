import type { Coordinate } from "@/domain/ride/types";

export type GravelAtlasCorridorKind = "dirt" | "backroad";

export interface GravelAtlasBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface GravelAtlasCorridor {
  readonly id: string;
  readonly kind: GravelAtlasCorridorKind;
  readonly geometry: readonly Coordinate[];
  readonly lengthMeters: number;
  readonly longestDirtRunMeters: number;
  readonly bendShare: number;
  readonly francoScore: number;
  readonly curvaturePerKm: number;
  readonly quality: number;
  /** True only when OSM explicitly says the way is reversible. */
  readonly reversible: boolean;
  /** Grade mix is in metres, not an unweighted tag count. */
  readonly gradeMix: Readonly<Record<string, number>>;
  readonly maxTrackGrade: number | null;
  /** OSM/source evidence only; this is not proof that GraphHopper can route it. */
  readonly legalConfidence: number;
  readonly access: {
    readonly legal: boolean;
    readonly unknownRestrictionFlags: readonly string[];
    readonly sandShare: number;
  };
  readonly seasonal: {
    readonly closed: boolean;
    readonly seasonalClosed: boolean;
    readonly flags: readonly string[];
  };
  readonly sourceIds: readonly string[];
  readonly areaHints: readonly string[];
}

export interface GravelAtlasAvailability {
  readonly available: boolean;
  readonly path: string | null;
  readonly schemaVersion: number | null;
  readonly corridorCount: number;
  readonly reason?: string;
}

export interface GravelAtlasPort {
  readonly corridorsNear: (
    bounds: GravelAtlasBounds,
    kind: GravelAtlasCorridorKind,
    limit?: number,
  ) => readonly GravelAtlasCorridor[];
  readonly availability: () => GravelAtlasAvailability;
}

const DEFAULT_RADIUS_METERS = 35_000;
const MAX_ROWS = 2_000;

function boundsForEllipse(start: Coordinate, finish: Coordinate, radiusMeters: number): GravelAtlasBounds {
  const latitude = (start.lat + finish.lat) / 2;
  const latDegrees = radiusMeters / 110_540;
  const lonDegrees = radiusMeters / Math.max(1, 111_320 * Math.cos((latitude * Math.PI) / 180));
  return {
    west: Math.min(start.lon, finish.lon) - lonDegrees,
    east: Math.max(start.lon, finish.lon) + lonDegrees,
    south: Math.min(start.lat, finish.lat) - latDegrees,
    north: Math.max(start.lat, finish.lat) + latDegrees,
  };
}

/** Query the complete reachable ellipse, rather than only its endpoints. */
export function corridorsInReachableEllipse(
  atlas: GravelAtlasPort,
  start: Coordinate,
  finish: Coordinate,
  radiusMeters = DEFAULT_RADIUS_METERS,
  kind: GravelAtlasCorridorKind = "dirt",
  limit = MAX_ROWS,
): readonly GravelAtlasCorridor[] {
  return atlas.corridorsNear(boundsForEllipse(start, finish, radiusMeters), kind, limit);
}

export function parseAtlasCoordinates(value: unknown): readonly Coordinate[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((point): Coordinate[] => {
      if (Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number") return [{ lon: point[0], lat: point[1] }];
      if (typeof point === "object" && point !== null && "lon" in point && "lat" in point && typeof point.lon === "number" && typeof point.lat === "number") return [{ lon: point.lon, lat: point.lat }];
      return [];
    });
  } catch {
    return [];
  }
}

export function parseJsonArray(value: unknown): readonly string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function parseGradeMix(value: unknown): Readonly<Record<string, number>> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, amount]) => typeof amount === "number" && Number.isFinite(amount) ? [[key, amount]] : []));
  } catch {
    return {};
  }
}
