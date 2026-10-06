/**
 * The one import-safety budget shared by GPX, KML and KMZ.
 *
 * The legacy implementation exposed 5 MiB/50,000-point GPX constants from one
 * parser while its file wrapper enforced the same byte limit and its KML/KMZ
 * paths did not share all of those guards. VNext deliberately publishes the
 * build-package budget below as the single contract: 10 MiB and 100,000 points
 * are the per-file limits, while archive expansion and structural limits remain
 * independently bounded. A caller may tighten a budget for a test or a
 * deployment, but no parser may widen these defaults. This reconciles the
 * legacy divergence at one boundary instead of letting format-specific limits
 * drift again.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_POINTS = 100_000;
export const MAX_SEGMENTS = 200;
export const MAX_TRACKS = 50;
export const MAX_KMZ_ENTRIES = 32;
export const MAX_KMZ_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_KMZ_COMPRESSION_RATIO = 100;
export const MAX_XML_DEPTH = 64;
/** Bounds allocation for ignored extensions as well as route points. */
export const MAX_XML_ELEMENTS = 500_000;

/** Maximum text held by one XML element or attribute value. */
export const MAX_STRING_BYTES = 64 * 1024;
/** Maximum bytes retained for a track, route, document or waypoint name. */
export const MAX_NAME_BYTES = 512;
/** Maximum bytes retained for one timestamp value. */
export const MAX_TIMESTAMP_BYTES = 128;
/** Maximum bytes retained for one XML attribute value. */
export const MAX_ATTRIBUTE_BYTES = 4 * 1024;
/** Maximum bytes in one KML coordinate token. */
export const MAX_COORDINATE_TOKEN_BYTES = 512;

export interface ImportLimits {
  readonly MAX_FILE_BYTES: number;
  readonly MAX_TOTAL_POINTS: number;
  readonly MAX_SEGMENTS: number;
  readonly MAX_TRACKS: number;
  readonly MAX_KMZ_ENTRIES: number;
  readonly MAX_KMZ_UNCOMPRESSED_BYTES: number;
  readonly MAX_KMZ_COMPRESSION_RATIO: number;
  readonly MAX_XML_DEPTH: number;
  readonly MAX_XML_ELEMENTS: number;
  readonly MAX_STRING_BYTES: number;
  readonly MAX_NAME_BYTES: number;
  readonly MAX_TIMESTAMP_BYTES: number;
  readonly MAX_ATTRIBUTE_BYTES: number;
  readonly MAX_COORDINATE_TOKEN_BYTES: number;
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  MAX_FILE_BYTES,
  MAX_TOTAL_POINTS,
  MAX_SEGMENTS,
  MAX_TRACKS,
  MAX_KMZ_ENTRIES,
  MAX_KMZ_UNCOMPRESSED_BYTES,
  MAX_KMZ_COMPRESSION_RATIO,
  MAX_XML_DEPTH,
  MAX_XML_ELEMENTS,
  MAX_STRING_BYTES,
  MAX_NAME_BYTES,
  MAX_TIMESTAMP_BYTES,
  MAX_ATTRIBUTE_BYTES,
  MAX_COORDINATE_TOKEN_BYTES,
};

export type ImportLimitsOverride = Partial<ImportLimits>;

/** Applies only tighter, positive integer overrides to the shared budget. */
export function resolveImportLimits(
  override: ImportLimitsOverride = {},
): ImportLimits {
  const entries = Object.entries(DEFAULT_IMPORT_LIMITS).map(([key, value]) => {
    const candidate = override[key as keyof ImportLimits];
    if (candidate === undefined) return [key, value] as const;
    if (!Number.isSafeInteger(candidate) || candidate <= 0 || candidate > value) {
      throw new RangeError(`${key} override must be a positive integer no greater than ${value}`);
    }
    return [key, candidate] as const;
  });
  return Object.fromEntries(entries) as ImportLimits;
}
