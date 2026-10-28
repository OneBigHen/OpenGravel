/**
 * The catalog record for one hike (HIKE-MODE-PLAN H1 item 5).
 *
 * The record keeps what was measured (`stats`, `shape`, `time`, `difficulty`)
 * beside what was mapped (`surfaceMix`, `sacMix`, `trailheads`, `features`,
 * `sources`). The derived fields are results of the pure modules in this
 * folder; a pipeline stores them so the UI never recomputes a time from a
 * different profile than the one the record was built from.
 *
 * Derived fields are nullable rather than defaulted: a record without a DEM
 * profile has `time: null`, and one that was never rated has
 * `difficulty: null`. The catalog adapter is responsible for filling them.
 */

import type { Coordinate } from "../ride/types";
import type { HikeDifficulty } from "./difficulty";
import type { ToblerTimeEstimate } from "./time";
import type {
  HikeFeature,
  HikeSacMix,
  HikeShapeClassification,
  HikeSource,
  HikeStats,
  HikeSurfaceMix,
  HikeTrailhead,
} from "./types";

export interface HikeRecord {
  readonly id: string;
  readonly name: string;
  /** Region label the catalog groups by, e.g. "Hawk Mountain"; null if unknown. */
  readonly region: string | null;
  readonly line: readonly Coordinate[];
  /** One entry per line vertex; null where the DEM has no elevation. */
  readonly elevations: readonly (number | null)[];
  readonly stats: HikeStats;
  readonly shape: HikeShapeClassification;
  readonly surfaceMix: HikeSurfaceMix;
  readonly sacMix: HikeSacMix;
  readonly trailheads: readonly HikeTrailhead[];
  readonly features: readonly HikeFeature[];
  /** Every source that contributed a fact, with its snapshot date. */
  readonly sources: readonly HikeSource[];
  /** Honest time; null until the catalog has a profile and computed one. */
  readonly time: ToblerTimeEstimate | null;
  /** Difficulty; null until the catalog rated it. */
  readonly difficulty: HikeDifficulty | null;
}
