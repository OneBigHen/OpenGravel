import type { Coordinate } from "@/domain/ride/types";
import type { GeometryRef } from "@/domain/ride/ids";

/** The parsed, source-preserving track shape shared by all import formats. */
export interface ParsedImportTrack {
  readonly name: string;
  /** Present for GPX; keeps a route-only export distinct from a dense track. */
  readonly sourceKind?: "track" | "route";
  readonly sourceType?: string;
  readonly segments: readonly (readonly Coordinate[])[];
  readonly timestamps: readonly (readonly (string | null)[])[];
  readonly elevation: readonly (readonly (number | null)[])[];
}

/** A source waypoint stays metadata, never an invented track point. */
export interface ParsedImportWaypoint {
  readonly name: string | null;
  readonly coordinate: Coordinate;
  readonly elevation: number | null;
  readonly timestamp: string | null;
}

export interface ParsedImport {
  readonly tracks: readonly ParsedImportTrack[];
  readonly warnings: readonly string[];
  readonly waypoints?: readonly ParsedImportWaypoint[];
  /** Human-readable source description, retained as report context, not policy. */
  readonly sourceDescription?: string;
}

/** Library metadata for one imported source track. Coordinates live in geometry. */
export interface ImportedTrackSegment {
  readonly geometryRef: GeometryRef;
  readonly timestamps: readonly (string | null)[];
  readonly elevation: readonly (number | null)[];
}

export interface ImportedTrackData {
  readonly name: string;
  readonly segments: readonly ImportedTrackSegment[];
}

/** The durable import envelope beside a RideDocument. */
export interface ImportRideData {
  readonly originalRef: GeometryRef;
  /** SHA-256 of the untouched source file; used to prevent repeat SwitchBack imports. */
  readonly sourceContentHash?: string;
  readonly tracks: readonly ImportedTrackData[];
  readonly waypoints: readonly ParsedImportWaypoint[];
  /** The import's caveats, kept so the saved ride can still explain them. */
  readonly warnings?: readonly string[];
}

export interface ImportProgress {
  readonly phase: "parsing" | "complete";
  readonly points: number;
  readonly tracks: number;
  readonly segments: number;
}

export interface ImportParseOptions {
  readonly filename: string;
  readonly byteLength?: number;
  readonly limits?: import("./limits").ImportLimitsOverride;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ImportProgress) => void;
}

export class ImportCancelledError extends Error {
  readonly code = "cancelled" as const;

  constructor() {
    super("Route import was cancelled.");
    this.name = "ImportCancelledError";
  }
}

export class ImportSecurityError extends Error {
  readonly code = "security-limit" as const;

  constructor(message: string) {
    super(message);
    this.name = "ImportSecurityError";
  }
}

export function throwIfImportCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ImportCancelledError();
}
