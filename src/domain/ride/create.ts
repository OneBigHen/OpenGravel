/**
 * Construction of the authored ride (03-DOMAIN-MODEL §2–§3).
 *
 * Kept apart from `types.ts` so the shape module stays pure data: everything
 * here is a factory that returns deeply frozen values, never a mutation path.
 */

import { deepFreeze } from "../util/freeze";
import { newRideId, type RideId } from "./ids";
import {
  SCHEMA_VERSION,
  type BikeConstraintSnapshot,
  type RideDocument,
  type RideIntent,
  type RideProvenance,
} from "./types";

/**
 * Product defaults for a ride with no explicit bike profile.
 *
 * These are the shipped defaults, not the rider's settings: every ride stores
 * this snapshot so changing the bike elsewhere never rewrites an old ride (§10).
 */
export const DEFAULT_BIKE: BikeConstraintSnapshot = deepFreeze<BikeConstraintSnapshot>({
  bikeId: "default",
  category: "touring",
  fuelRangeMiles: 150,
  reserveMiles: 30,
  maintainedGravel: "allow",
  roughTracks: "avoid",
  unknownSurface: "allow-with-warning",
});

/**
 * A fresh intent holding every product default (§3). A new call returns a new
 * frozen intent; a half-formed destination ride is valid authored state, so
 * `start` and `finish` begin empty rather than guessed.
 */
export function defaultRideIntent(bike: BikeConstraintSnapshot = DEFAULT_BIKE): RideIntent {
  return deepFreeze<RideIntent>({
    shape: "destination",
    start: null,
    finish: null,
    stops: [],
    shaping: [],
    time: { kind: "none" },
    departure: { kind: "now" },
    roadCharacter: "balanced",
    noveltyPreference: "balanced",
    surface: { preference: "mixed", unknownSurfacePolicy: "allow-with-warning" },
    terrain: { level: "moderate" },
    traffic: "protect-ride",
    avoidHighways: false,
    tollPolicy: "avoid",
    bike: bike === DEFAULT_BIKE ? DEFAULT_BIKE : { ...bike },
    avoidAreas: [],
    roadSpans: [],
    sketch: null,
    longTrip: null,
  });
}

/** Explicit values a caller may supply when opening a new ride document. */
export interface CreateRideDocumentOverrides {
  readonly rideId?: RideId;
  /** ISO-8601 instant used for both timestamps; defaults to now. */
  readonly now?: string;
  readonly title?: string | null;
  readonly provenance?: RideProvenance;
  /** Optional garage snapshot used only when creating a new ride. */
  readonly bike?: BikeConstraintSnapshot;
}

/**
 * Opens a new authored ride at `revision: 0` with the default intent, an empty
 * history index whose base snapshot is that same initial intent, and `"new"`
 * provenance. The returned document is deeply frozen.
 */
export function createRideDocument(
  overrides: CreateRideDocumentOverrides = {},
): RideDocument {
  const now = overrides.now ?? new Date().toISOString();
  // The base snapshot is the initial authored intent; both slots share the
  // frozen value because a document that has no history has no other origin.
  const intent = defaultRideIntent(overrides.bike ?? DEFAULT_BIKE);
  return deepFreeze<RideDocument>({
    schemaVersion: SCHEMA_VERSION,
    rideId: overrides.rideId ?? newRideId(),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    title: overrides.title ?? null,
    provenance: overrides.provenance ?? { type: "new" },
    intent,
    history: { entries: [], cursor: -1, baseIntent: intent, appliedProposalIds: [] },
  });
}
