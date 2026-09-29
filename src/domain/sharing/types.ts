import type { Coordinate, RideProvenance, SurfaceIntent } from "@/domain/ride/types";

/**
 * The share snapshot's shapes (10-SHARING-AND-OFFLINE §10–§12).
 *
 * `ShareSnapshot` is a §12 allowlist as a type: title, route geometry,
 * distance/time, surface summary, opted-in author attribution, and source
 * attribution. There is deliberately no field for raw history, ride identity,
 * GPS observations, search queries, saved places, or import source ids — those
 * cannot leak through a key that does not exist.
 */

/** What the snapshot is built from: named picks, never a document spread. */
export interface ShareRoute {
  readonly segments: readonly (readonly Coordinate[])[];
}

/** §12 surface summary: the preference and the honesty policy, nothing else. */
export interface SurfaceSummary {
  readonly preference: SurfaceIntent["preference"];
  readonly unknownSurfacePolicy: SurfaceIntent["unknownSurfacePolicy"];
}

/** The aggregate, PII-free numbers a snapshot may cite (or `null` — unknown). */
export interface ShareSummary {
  readonly distanceMeters: number | null;
  readonly durationSeconds: number | null;
}

export interface ShareSource {
  /** The document revision this is derived from (snapshot immutability). */
  readonly sourceRevision: number;
  readonly title: string;
  readonly route: ShareRoute;
  readonly summary: ShareSummary | null;
  readonly surface: SurfaceSummary;
  readonly provenance: RideProvenance["type"];
  /** Opted-in pseudonym, or `null` (explicitly not included). */
  readonly authorPseudonym: string | null;
}

export const SHARE_SNAPSHOT_VERSION = 1;

/**
 * The immutable, public payload a share link exposes. Built field-by-field by
 * `buildShareSnapshot` in a pinned order so `serializeShareSnapshot` produces
 * stable bytes — the privacy preview renders those exact bytes, and the link
 * serves those exact bytes (10 §12 "preview exact before publish").
 */
export interface ShareSnapshot {
  readonly version: typeof SHARE_SNAPSHOT_VERSION;
  readonly sourceRevision: number;
  readonly title: string;
  readonly route: ShareRoute;
  /** Length of the shared (trimmed) geometry, derived from `route` itself. */
  readonly distanceMeters: number;
  readonly rideDistanceMeters: number | null;
  readonly rideDurationSeconds: number | null;
  readonly surface: SurfaceSummary;
  readonly author: { readonly pseudonym: string } | null;
  readonly source: { readonly attribution: RideProvenance["type"] };
}
