/**
 * Shapes for the offline trail catalog job (HIKE-MODE-PLAN H1 item 4).
 *
 * The rule from the plan applies to every field here: unknown stays unknown. A
 * `null` means "no source said", never "no", "none" or "easy". Nothing in this
 * job invents an access, surface or difficulty value, so a consumer can tell
 * "not mapped" from "mapped as open".
 */

import type { Coordinate } from "../../../src/domain/ride/types";

/** Sources this job can merge. Order in `SOURCE_PRIORITY` decides field winners. */
export type TrailSourceId = "osm" | "usfs" | "nps";

export interface TrailSource {
  readonly sourceId: TrailSourceId;
  readonly sourceLabel: string;
  /** Stable id inside the source: `relation/123`, `way/456`, the USFS trail number, … */
  readonly recordId: string;
  readonly url: string | null;
}

/** The curated attributes every source is normalized into. `null` = unknown. */
export interface TrailAttributes {
  readonly name: string | null;
  readonly ref: string | null;
  readonly operator: string | null;
  readonly sacScale: string | null;
  readonly surface: string | null;
  readonly trailVisibility: string | null;
  readonly dog: string | null;
  readonly access: string | null;
}

export const ATTRIBUTE_FIELDS = [
  "name",
  "ref",
  "operator",
  "sacScale",
  "surface",
  "trailVisibility",
  "dog",
  "access",
] as const satisfies readonly (keyof TrailAttributes)[];

export type AttributeField = (typeof ATTRIBUTE_FIELDS)[number];

/** One trail as one source described it, before merging. */
export interface TrailCandidate {
  readonly sourceId: TrailSourceId;
  readonly recordId: string;
  readonly url: string | null;
  /** Assembled geometry: at least one line of at least two points. */
  readonly lines: readonly (readonly Coordinate[])[];
  readonly attributes: TrailAttributes;
}

export type TrailheadKind = "trailhead" | "parking";

/** A trailhead or parking place from any source, before it is matched to a trail. */
export interface PlaceCandidate {
  readonly sourceId: TrailSourceId;
  readonly recordId: string;
  readonly url: string | null;
  readonly kind: TrailheadKind;
  readonly name: string | null;
  readonly coordinate: Coordinate;
}

/** A place matched to an end of a trail. */
export interface Trailhead {
  readonly kind: TrailheadKind;
  readonly name: string | null;
  readonly coordinate: Coordinate;
  readonly distanceMeters: number;
  /** Which end of which line of the trail geometry it serves. */
  readonly lineIndex: number;
  readonly end: "start" | "end";
  readonly sources: readonly TrailSource[];
}

/** Two sources disagreed; the higher-priority value was kept and both are recorded. */
export interface TrailConflict {
  readonly field: AttributeField;
  readonly kept: { readonly sourceId: TrailSourceId; readonly value: string };
  readonly other: { readonly sourceId: TrailSourceId; readonly value: string };
}

/** A merged trail. */
export interface Trail {
  readonly id: string;
  readonly lines: readonly (readonly Coordinate[])[];
  readonly attributes: TrailAttributes;
  readonly sources: readonly TrailSource[];
  readonly conflicts: readonly TrailConflict[];
  readonly trailheads: readonly Trailhead[];
  readonly lengthMeters: number;
}

export interface HikeRecord {
  readonly id: string;
  readonly name: string | null;
  readonly ref: string | null;
  readonly operator: string | null;
  readonly lengthMeters: number;
  readonly sacScale: string | null;
  readonly surface: string | null;
  readonly trailVisibility: string | null;
  readonly dog: string | null;
  readonly access: string | null;
  /** [west, south, east, north] of the trail geometry. */
  readonly bbox: readonly [number, number, number, number];
  readonly start: Coordinate;
  readonly end: Coordinate;
  readonly trailheadCount: number;
  readonly trailheads: readonly Trailhead[];
  readonly sources: readonly TrailSource[];
  /**
   * Elevation gain and loss belong to H1 item 5 and need the DEM. They stay
   * null here; a consumer must not read null as "flat".
   */
  readonly elevationGainMeters: number | null;
  readonly elevationLossMeters: number | null;
}

export interface HikeCatalog {
  readonly version: 1;
  readonly counts: {
    readonly trails: number;
    readonly bySource: Readonly<Record<TrailSourceId, number>>;
    readonly withTrailhead: number;
    readonly merged: number;
  };
  readonly hikes: readonly HikeRecord[];
}

export interface TrailFeatureCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly TrailFeature[];
}

export interface TrailFeature {
  readonly type: "Feature";
  readonly id: string;
  readonly geometry:
    | { readonly type: "LineString"; readonly coordinates: readonly (readonly [number, number])[] }
    | { readonly type: "MultiLineString"; readonly coordinates: readonly (readonly (readonly [number, number])[])[] };
  readonly properties: TrailProperties;
}

export interface TrailProperties extends TrailAttributes {
  readonly id: string;
  readonly lengthMeters: number;
  readonly sources: readonly TrailSource[];
  readonly conflicts: readonly TrailConflict[];
  readonly trailheads: readonly Trailhead[];
}
