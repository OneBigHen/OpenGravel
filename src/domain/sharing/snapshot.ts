import { deepFreeze } from "@/domain/util/freeze";
import {
  PrivacyTrimError,
  applyPrivacyTrim,
  routeDistanceMeters,
  type PrivacyTrimSettings,
} from "./privacy";
import {
  SHARE_SNAPSHOT_VERSION,
  type ShareSnapshot,
  type ShareSource,
} from "./types";

/**
 * Snapshot construction (10-SHARING-AND-OFFLINE §10–§12).
 *
 * `buildShareSnapshot` is the privacy boundary made executable: it picks the
 * §12 fields by name from the source, runs the one shared privacy trim over the
 * route, and returns a frozen value. Nothing from the ride document is spread
 * in, so nothing outside the list can reach the bytes a link exposes.
 *
 * `serializeShareSnapshot` renders those bytes in a pinned key order. The
 * privacy preview shows this string verbatim and the published link serves it
 * verbatim — preview exactness before publish is a property of the pipeline,
 * not a promise in the copy (10 §12).
 */

export type ShareSnapshotErrorCode =
  | "no-route-left"
  | "empty-title"
  | "invalid-trim"
  | "invalid-summary";

export class ShareSnapshotError extends Error {
  readonly code: ShareSnapshotErrorCode;

  constructor(code: ShareSnapshotErrorCode, message: string) {
    super(message);
    this.name = "ShareSnapshotError";
    this.code = code;
  }
}

function aggregate(value: number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new ShareSnapshotError("invalid-summary", `${field} must be a finite, non-negative number.`);
  }
  return value;
}

export function buildShareSnapshot(
  source: ShareSource,
  privacy: PrivacyTrimSettings,
): ShareSnapshot {
  const title = source.title.trim();
  if (title.length === 0) {
    throw new ShareSnapshotError("empty-title", "A share needs a title to publish.");
  }

  let route;
  try {
    route = applyPrivacyTrim(source.route, privacy);
  } catch (error: unknown) {
    if (error instanceof PrivacyTrimError) {
      throw new ShareSnapshotError("invalid-trim", error.message);
    }
    throw error;
  }

  const points = route.segments.reduce((count, segment) => count + segment.length, 0);
  if (points < 2) {
    throw new ShareSnapshotError(
      "no-route-left",
      "The privacy trim hides the whole route; less trim would leave a route to share.",
    );
  }

  const pseudonym = source.authorPseudonym?.trim() ?? "";

  return deepFreeze({
    version: SHARE_SNAPSHOT_VERSION,
    sourceRevision: source.sourceRevision,
    title,
    route,
    distanceMeters: routeDistanceMeters(route),
    rideDistanceMeters: aggregate(source.summary?.distanceMeters, "summary.distanceMeters"),
    rideDurationSeconds: aggregate(source.summary?.durationSeconds, "summary.durationSeconds"),
    surface: {
      preference: source.surface.preference,
      unknownSurfacePolicy: source.surface.unknownSurfacePolicy,
    },
    author: pseudonym.length === 0 ? null : { pseudonym },
    source: { attribution: source.provenance },
  } satisfies ShareSnapshot);
}

/**
 * The canonical bytes of a snapshot. Fixed field order (the builder's own key
 * order), plain JSON: the same input always produces the same string, which is
 * what makes "the preview is byte-exact to the link" testable as equality.
 */
export function serializeShareSnapshot(snapshot: ShareSnapshot): string {
  return JSON.stringify(snapshot);
}
