import type { RideDocument } from "@/domain/ride/types";
import type { ShareRoute, ShareSource, ShareSummary } from "./types";

/**
 * The named derivation from `RideDocument` to `ShareSource` (03 §28, 10 §12).
 *
 * Each field is picked by name — a document spread is exactly how non-listed
 * data would leak into a snapshot, so there is none. Identity (ride id,
 * location ids, labels, provenance `sourceId`), raw history, and GPS
 * observations stay where they are.
 */
export function shareSourceFromRide(
  document: RideDocument,
  route: ShareRoute,
  summary: ShareSummary | null,
  authorPseudonym: string | null,
): ShareSource {
  return {
    sourceRevision: document.revision,
    title: document.title ?? "",
    route,
    summary,
    surface: {
      preference: document.intent.surface.preference,
      unknownSurfacePolicy: document.intent.surface.unknownSurfacePolicy,
    },
    provenance: document.provenance.type,
    authorPseudonym,
  };
}
