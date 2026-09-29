/**
 * The application-facing ride persistence port. Infrastructure supplies the
 * IndexedDB implementation; stores and planner actions depend on this contract
 * rather than on Dexie or a concrete database connection.
 */

import type { GeometryRef, RideId } from "@/domain/ride/ids";
import type { RideDocument } from "@/domain/ride/types";
import type { ImportRideData } from "@/application/import/types";
import type { CorridorPackManifest } from "@/domain/offline/capabilities";
import type { RecordingId } from "@/domain/recording/ids";
import type { RecordingSummary } from "@/domain/recording/types";

export interface BootstrapPointerPort {
  /**
   * Reads the cached hint, distinguishing "nothing usable is cached" from "this
   * storage could not be read at all": the first may be dropped, the second must be
   * kept so the next boot can try again (5.1t finding A6).
   */
  read(): BootstrapHintRead;
  /** Cache the IDB-authoritative pointer; never use this hint to restore a ride. */
  write(pointer: Pick<BootstrapPointerHint, "rideId" | "updatedAt">): void;
  invalidate(): void;
}

/**
 * The outcome of reading the cached bootstrap hint. `absent` and `corrupt` are both
 * "there is no lead here" (an invalid cache is worth dropping); `unreadable` is a
 * failed read that says nothing about the hint's value.
 */
export type BootstrapHintRead =
  | { readonly status: "found"; readonly hint: BootstrapPointerHint }
  | { readonly status: "absent" }
  | { readonly status: "corrupt" }
  | { readonly status: "unreadable" };

export interface BootstrapPointerHint {
  readonly version: 1;
  readonly rideId: RideId;
  readonly updatedAt: string;
}

export interface RideDraftPointer {
  readonly id: "active";
  readonly rideId: RideId;
  readonly updatedAt: string;
  /** Geometry handles retained by the active draft/session. */
  readonly geometryRefs?: readonly GeometryRef[];
}

export type LibrarySourceKind = "catalog" | "shared" | "recorded" | "import" | "ride";

export interface RideDerivedFrom {
  readonly kind: LibrarySourceKind;
  readonly sourceId: string;
}

export interface RideBundleSummary {
  readonly distanceMeters?: number;
  readonly durationSeconds?: number;
}

/** Library-owned recording data committed independently of RideDocument intent. */
export interface RecordedTrackEnvelope {
  readonly recordingId: RecordingId;
  readonly geometryRef: GeometryRef;
  /** One observation instant for each coordinate in the referenced line. */
  readonly timestamps: readonly string[];
  readonly summary: RecordingSummary;
}

/** The optional library envelope lives beside the authored document. */
export interface RideRecord {
  readonly rideId: RideId;
  readonly revision: number;
  readonly updatedAt: string;
  readonly writerToken: string;
  readonly document: RideDocument;
  readonly savedAt?: string;
  readonly derivedFrom?: RideDerivedFrom;
  /** Application-supplied idempotency key; the repository enforces uniqueness atomically. */
  readonly uniqueKey?: string;
  readonly originalsRef?: string;
  readonly area?: string;
  readonly bundleSummary?: RideBundleSummary;
  /** Durable description of route data needed offline; downloads are separate. */
  readonly offlinePack?: CorridorPackManifest;
  readonly importData?: ImportRideData;
  readonly recordedTrack?: RecordedTrackEnvelope;
}

export interface SaveLibraryRideOptions {
  readonly writerToken: string;
  readonly savedAt: string;
  readonly derivedFrom?: RideDerivedFrom;
  readonly uniqueKey?: string;
  readonly originalsRef?: string;
  readonly area?: string;
  readonly bundleSummary?: RideBundleSummary;
  readonly offlinePack?: CorridorPackManifest;
  readonly importData?: ImportRideData;
  readonly recordedTrack?: RecordedTrackEnvelope;
}

export type SaveLibraryRideResult =
  | { readonly status: "saved" }
  | { readonly status: "duplicate-key"; readonly title: string | null };

export type SaveResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "quota";
      readonly preservedRevision: number | null;
    }
  | {
      readonly ok: false;
      readonly reason: "write-failed";
      readonly error: unknown;
    }
  | {
      readonly ok: false;
      readonly reason: "conflict";
      readonly conflict: { readonly storedRevision: number; readonly ourRevision: number };
    };

export type LoadRideResult =
  | { readonly ok: true; readonly document: RideDocument }
  | { readonly ok: false; readonly reason: "corrupt" }
  | null;

export interface RideRevision {
  readonly revision: number;
  readonly writerToken: string;
}

export interface SaveRideOptions {
  readonly writerToken: string;
  /** Revision this tab last accepted before making the pending edit. */
  readonly baseRevision?: number;
}

export interface RideRepositoryPort {
  saveRide(document: RideDocument, options: SaveRideOptions): Promise<SaveResult>;
  loadRide(rideId: RideId): Promise<LoadRideResult>;
  loadDraftPointer(): Promise<RideDraftPointer | null>;
  deleteRide(rideId: RideId): Promise<void>;
  readRideRevision?(rideId: RideId): Promise<RideRevision | null>;
}

export interface RideLibraryRepositoryPort {
  saveLibraryRide(
    document: RideDocument,
    options: SaveLibraryRideOptions,
  ): Promise<SaveLibraryRideResult>;
  loadRideRecord(rideId: RideId): Promise<RideRecord | null>;
  listRideRecords(): Promise<readonly RideRecord[]>;
}
