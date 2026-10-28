import type { Coordinate } from "../../../src/domain/ride/types";
import type { TrailSource } from "./types";

export type TrailFeatureKind = "waterfall" | "viewpoint" | "peak" | "fire-tower" | "water" | "cave" | "historic" | "shelter" | "campsite" | "drinking-water" | "toilets" | "parking" | "trailhead";
export interface AlongTrailFeature {
  readonly id: string;
  readonly kind: TrailFeatureKind;
  readonly name: string | null;
  readonly coordinate: Coordinate;
  /** Sum of retained parts before this point; never includes a gap. */
  readonly distanceAlongMeters: number;
  readonly distanceFromTrailMeters: number;
  readonly lineIndex: number;
  readonly source: TrailSource;
  readonly wikipedia?: string;
  readonly wikidata?: string;
}
export interface RichHike {
  readonly featureKinds?: readonly TrailFeatureKind[];
  readonly featureCount?: number;
  /** Detail only: omitted by the list API. */
  readonly features?: readonly AlongTrailFeature[];
}
