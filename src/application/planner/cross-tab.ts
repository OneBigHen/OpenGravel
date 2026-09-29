/**
 * Cross-tab checkpoint fencing (02-ARCHITECTURE-CONTRACT §15).
 *
 * This module contains no browser or storage implementation. It only compares
 * the metadata read from a repository with the revision a tab last accepted,
 * then provides the explicit fork operation used by the UI choice panel.
 */

import { newRideId } from "@/domain/ride/ids";
import { deepFreeze } from "@/domain/util/freeze";
import type { RideDocument } from "@/domain/ride/types";

export interface CrossTabDetectionInput {
  readonly storedRevision: number;
  readonly storedWriterToken: string;
  readonly ourBaseRevision: number;
  readonly ourRevision: number;
  readonly writerToken: string;
}

export interface CrossTabConflict {
  readonly storedRevision: number;
  readonly ourRevision: number;
}

/** Returns a conflict only for a newer revision owned by another tab. */
export function detectCrossTabConflict(
  input: CrossTabDetectionInput,
): CrossTabConflict | null {
  if (
    input.storedWriterToken === input.writerToken ||
    input.storedRevision <= input.ourBaseRevision
  ) {
    return null;
  }
  return {
    storedRevision: input.storedRevision,
    ourRevision: input.ourRevision,
  };
}

/**
 * Creates the local copy selected by "Keep my copy". Geometry stays referenced
 * by the existing immutable handles; only the document identity/provenance and
 * fork timestamps change.
 */
export function forkRideDocument(
  document: RideDocument,
  now: string = new Date().toISOString(),
): RideDocument {
  return deepFreeze<RideDocument>({
    ...document,
    rideId: newRideId(),
    createdAt: now,
    updatedAt: now,
    provenance: { type: "derived", sourceId: document.rideId },
  });
}
