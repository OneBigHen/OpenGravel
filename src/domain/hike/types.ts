/**
 * Hike record value types (HIKE-MODE-PLAN H1 items 5 and 6).
 *
 * A hike record is what we measure ourselves from the line and the DEM, plus
 * what the trail catalog mapped. Every field a source may not have established
 * is `null` (or an explicit `unknown` band), never a plausible default:
 * a trail whose surface was never mapped is never described as easy, and a line
 * without a DEM profile reports null gain rather than zero gain.
 *
 * The modules that compute these values are pure: the same line, elevations
 * and mixes always produce the same record. Provider adapters belong in
 * `src/application` and `src/infrastructure`.
 */

import type { Coordinate } from "../ride/types";
import type { SurfaceClass } from "../roads/surface";

/**
 * OSM `sac_scale` values, normalised with hyphens. The labels are the mapper's
 * description of the hardest step on the way, not a difficulty score of the
 * whole trail: the T-grade mapping lives in `difficulty.ts`.
 */
export const HIKE_SAC_SCALES = [
  "hiking",
  "mountain-hiking",
  "demanding-mountain-hiking",
  "alpine-hiking",
  "demanding-alpine-hiking",
  "difficult-alpine-hiking",
] as const;
export type HikeSacScale = (typeof HIKE_SAC_SCALES)[number];

/** A SAC band, including "no SAC data was mapped for this stretch". */
export type HikeSacBand = HikeSacScale | "unknown";

/** Every SAC band, in increasing severity; "unknown" is last and never easy. */
export const HIKE_SAC_BANDS = [...HIKE_SAC_SCALES, "unknown"] as const satisfies readonly HikeSacBand[];

/** Features the catalog promotes along a hike (H1 item 5). */
export const HIKE_FEATURE_KINDS = [
  "waterfall",
  "viewpoint",
  "summit",
  "water",
  "shelter",
  "campsite",
  "parking",
] as const;
export type HikeFeatureKind = (typeof HIKE_FEATURE_KINDS)[number];

/** One cumulative point of the DEM profile, measured along the line. */
export interface HikeProfilePoint {
  /** Along-line distance from the start, in meters; non-decreasing. */
  readonly distanceMeters: number;
  /** DEM elevation in meters; null when the DEM did not establish one. */
  readonly elevationMeters: number | null;
}

/** A DEM profile: at least the line's vertices, ordered from start to end. */
export type HikeProfile = readonly HikeProfilePoint[];

/**
 * How much of the line has an elevation on both ends. Gain, loss and max grade
 * are computed only from those measured segments, and the share is reported so
 * a partial profile is never presented as a full one.
 */
export interface HikeElevationCoverage {
  readonly knownSamples: number;
  readonly totalSamples: number;
  readonly measuredSegments: number;
  /** Segments with length whose elevation on at least one end is unknown. */
  readonly unmeasuredSegments: number;
  readonly measuredLengthMeters: number;
  /** Measured length / line length, 0–1; 0 for a line with no length. */
  readonly measuredLengthShare: number;
}

/** The highest or lowest DEM sample, and where it is on the line. */
export interface HikeElevationPoint {
  readonly elevationMeters: number;
  readonly distanceMeters: number;
  readonly coordinate: Coordinate;
}

/** The steepest measured segment, signed: positive is uphill. */
export interface HikeGrade {
  /** Rise / run × 100; positive climbs, negative descends. */
  readonly percent: number;
  readonly direction: "up" | "down";
  readonly runMeters: number;
  /** Along-line distance at the start of the segment. */
  readonly atMeters: number;
}

/** What we measured on the line, with the elevation gaps left visible. */
export interface HikeStats {
  readonly lengthMeters: number;
  /** Sum of climbs between adjacent known elevations; null when no segment has both. */
  readonly gainMeters: number | null;
  /** Sum of descents between adjacent known elevations; null when no segment has both. */
  readonly lossMeters: number | null;
  /** Steepest measured segment of at least `MIN_GRADE_RUN_METERS`; null when none. */
  readonly maxGrade: HikeGrade | null;
  readonly highestPoint: HikeElevationPoint | null;
  readonly lowestPoint: HikeElevationPoint | null;
  readonly elevation: HikeElevationCoverage;
}

export const HIKE_SHAPES = ["loop", "out-and-back", "point-to-point"] as const;
export type HikeShape = (typeof HIKE_SHAPES)[number] | "unknown";

/** The classification, plus the endpoint and retrace evidence behind it. */
export interface HikeShapeClassification {
  readonly shape: HikeShape;
  readonly lengthMeters: number;
  readonly endpointDistanceMeters: number;
  /** Endpoint distance / line length, 0–1; 0 for a line with no length. */
  readonly endpointClosureRatio: number;
  /**
   * Share 0–1 of sampled line positions that lie within the retrace tolerance
   * of an earlier stretch at least the minimum separation back along the line.
   */
  readonly retracedShare: number;
  readonly explanation: string;
}

/** Metres of trail in one band. Builders sum duplicates and reject negatives. */
export interface HikeBandMeters<Band extends string> {
  readonly band: Band;
  readonly meters: number;
}

/**
 * Metres per SAC band. A full record so a reader cannot confuse "no band was
 * supplied" with a zero: an all-zero mix means no SAC data at all. Build it
 * with `buildSacMix`.
 */
export type HikeSacMix = Readonly<Record<HikeSacBand, number>>;

/** Metres per surface class, including "unknown". Build it with `buildSurfaceMix`. */
export type HikeSurfaceMix = Readonly<Record<SurfaceClass, number>>;

/** Where a catalog fact came from, and when that source was read. */
export interface HikeSource {
  /** Stable source key, e.g. "osm" or "usfs-nfs-trail". */
  readonly key: string;
  readonly label: string;
  /** ISO date/timestamp of the source snapshot; null when it stated no date. */
  readonly observedAt: string | null;
  readonly url: string | null;
}

/** A mapped trailhead. Parking is null when nobody mapped it, never false. */
export interface HikeTrailhead {
  readonly coordinate: Coordinate;
  readonly name: string | null;
  readonly parking: boolean | null;
  readonly source: HikeSource;
}

/** One promoted feature near the trail (OSM within 50 m, H1 item 5). */
export interface HikeFeature {
  readonly kind: HikeFeatureKind;
  readonly coordinate: Coordinate;
  /** Straight-line distance from the trail, in meters. */
  readonly distanceFromTrailMeters: number;
  /** Along-line distance of the nearest trail position; null when not projected. */
  readonly distanceAlongTrailMeters: number | null;
  readonly name: string | null;
  readonly sourceKey: string;
}
