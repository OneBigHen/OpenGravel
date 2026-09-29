/**
 * The single Dexie owner for OpenGravel VNext (15-MIGRATION-AND-CUTOVER §4,
 * OGV-MIG-002 partial).
 *
 * One database, one schema declaration, one place to add a version. Every
 * storage adapter opens *this* class instead of calling `new Dexie(...)`
 * itself, so the next store (ride documents, offline packs, road constraints)
 * extends one versioned schema rather than inventing a second database with its
 * own versioning story.
 *
 * ## Namespace
 *
 * The database name is `opengravel-vnext` — a new namespace, never a legacy
 * key. Legacy OpenGravel data stays read-only during migration (15 §4, §15);
 * nothing here reads, writes or upgrades it, and the geometry adapter never
 * opens a legacy database.
 *
 * ## Ownership
 *
 * Dexie is imported only under `src/infrastructure/**`. Domain and application
 * code see the `GeometryStore` port, never this module.
 */

import Dexie, { type Table } from "dexie";

import type {
  RideDraftPointer,
  RideRecord,
} from "@/application/persistence/ride-repository";
import type { RideSessionState, RideSessionEvent } from "@/domain/ride-session/types";
import type { RideSessionId } from "@/domain/ride-session/ids";
import type { RecordingId } from "@/domain/recording/ids";
import type { RecordingPosition, RecordingSummary } from "@/domain/recording/types";
import type { GeometryRecord } from "@/domain/geometry/types";
import type { GeometryRef, RideId } from "@/domain/ride/ids";
import type { ImportBlobRecord } from "@/application/import/import-artifact";
import type { RoadSpanRecord } from "@/application/roads/road-repository";
import type { RoadEvidenceRecord } from "@/application/roads/road-evidence";
import type { RoadEntity } from "@/domain/roads/road-entity";
import type { ShareRecord } from "@/application/sharing/ports/share-repository";
import type { ShareId } from "@/domain/sharing/ids";

/** VNext database name (15-MIGRATION-AND-CUTOVER §4). */
export const VNEXT_DB_NAME = "opengravel-vnext";

/**
 * Current Dexie schema version. Bump it here when the schema changes:
 * v7 adds the share record store (Task 11.1, 10-SHARING-AND-OFFLINE §10).
 */
export const VNEXT_SCHEMA_VERSION = 7;

/** A row used only to quarantine a malformed ride record. */
export interface CorruptRideRecord {
  readonly rideId: string;
  readonly originalRideId: RideId;
  readonly corruptedAt: string;
  readonly record: unknown;
}

export type StoredRideRecord = RideRecord | CorruptRideRecord;

export type StoredRoadSpanRecord = RoadSpanRecord & { readonly id: string };

/**
 * The folded session: the journal position it has consumed plus the state. A
 * checkpoint row is the pair `(state, checkpointSeq)` — the state is only valid
 * as "everything up to `checkpointSeq`" (08 §13).
 */
export interface RideSessionCheckpointRow {
  readonly sessionId: RideSessionId;
  readonly checkpointSeq: number;
  /** Monotonic per-session revision; a late write never rewinds it. */
  readonly revision: number;
  readonly writerToken: string;
  readonly updatedAt: string;
  readonly state: RideSessionState;
}

/**
 * One journal row. `event` is optional in the stored type because a truncated
 * write is exactly the case resume must survive: the envelope is there and the
 * payload is not, which reads as a dropped event rather than a crash.
 */
export interface StoredRideSessionJournalRow {
  readonly id: string;
  readonly sessionId: RideSessionId;
  readonly seq: number;
  readonly event?: RideSessionEvent;
}

/** Small lifecycle row; raw coordinates live only in append-only batch rows. */
export interface RecordingTraceRow {
  readonly recordingId: RecordingId;
  readonly status: "open" | "sealed";
  readonly lastBatchSeq: number;
  readonly pointCount: number;
  readonly summary: RecordingSummary | null;
}

/** One atomic, bounded trace write. `points` is optional so recovery can name a truncated row. */
export interface StoredRecordingBatchRow {
  readonly id: string;
  readonly recordingId: RecordingId;
  readonly batchSeq: number;
  readonly pointCount: number;
  readonly points?: readonly RecordingPosition[];
}

/** The one active-draft pointer. It is intentionally tiny and not authoritative. */
export type DraftPointer = RideDraftPointer;

/** Small bootstrap preference storage (units, last-used start, and similar). */
export interface SettingRecord {
  readonly key: string;
  readonly value: unknown;
}

/** The migration audit row; v1 geometry needs no data migration to v2. */
export interface MigrationJournalRecord {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * The VNext database: immutable geometry keyed by its own handle.
 *
 * Adding a table means declaring it in the same `version(...).stores({...})`
 * call (or a new version) and exposing it as a readonly property; that keeps
 * one schema authority for every future store.
 */
export class VNextDatabase extends Dexie {
  /** Large geometry payloads, keyed by `geometryRef`. */
  readonly geometry: Table<GeometryRecord, GeometryRef>;
  /** Authored ride documents, keyed by `rideId`. */
  readonly rides: Table<StoredRideRecord, string>;
  /** One pointer to the active authored draft. */
  readonly draft: Table<DraftPointer, string>;
  /** Tiny non-authoritative bootstrap preferences. */
  readonly settings: Table<SettingRecord, string>;
  /** Idempotent migration records. */
  readonly migrationJournal: Table<MigrationJournalRecord, string>;
  /** Original GPX/KML/KMZ bytes, base64 encoded and never mixed with geometry. */
  readonly blobs: Table<ImportBlobRecord, GeometryRef>;
  /** Road identity metadata; derived refs are rebuilt from child rows on read. */
  readonly roadEntities: Table<RoadEntity, string>;
  /** Matched geometry span fingerprints belonging to a road entity. */
  readonly roadSpans: Table<StoredRoadSpanRecord, string>;
  /** Immutable source reports for a road entity. */
  readonly roadEvidence: Table<RoadEvidenceRecord, string>;
  /** One folded RideSession checkpoint per session (authority #3). */
  readonly rideSessions: Table<RideSessionCheckpointRow, string>;
  /** Append-only RideSession journal rows, compacted by each checkpoint. */
  readonly rideSessionJournal: Table<StoredRideSessionJournalRow, string>;
  /** One small lifecycle/summary row per local recording. */
  readonly recordings: Table<RecordingTraceRow, string>;
  /** Append-only, bounded coordinate batches belonging to a recording. */
  readonly recordingBatches: Table<StoredRecordingBatchRow, string>;
  /** Share records, looked up only by their opaque token (10 §10). */
  readonly shares: Table<ShareRecord, ShareId>;

  constructor(name: string = VNEXT_DB_NAME) {
    super(name);
    // v1 contained only geometry, v2 added ride/checkpoint tables, and v3 adds
    // bounded original-byte blobs. Each transition is journaled so upgrades
    // are observable and replay-safe (15-MIGRATION-AND-CUTOVER §5).
    this.version(1).stores({ geometry: "geometryRef" });
    this.version(2).stores({
      geometry: "geometryRef",
      rides: "rideId",
      draft: "id",
      settings: "key",
      migrationJournal: "id",
    }).upgrade(async (transaction) => {
      const startedAt = new Date().toISOString();
      const geometryCount = await transaction.table("geometry").count();
      await transaction.table("migrationJournal").put({
        id: "schema-1-to-2",
        from: 1,
        to: 2,
        startedAt,
        completedAt: new Date().toISOString(),
        counts: { geometry: geometryCount },
      } satisfies MigrationJournalRecord);
    });
    this.version(3).stores({
      geometry: "geometryRef",
      rides: "rideId",
      draft: "id",
      settings: "key",
      migrationJournal: "id",
      blobs: "originalRef",
    }).upgrade(async (transaction) => {
      const startedAt = new Date().toISOString();
      const blobCount = await transaction.table("blobs").count();
      await transaction.table("migrationJournal").put({
        id: "schema-2-to-3",
        from: 2,
        to: 3,
        startedAt,
        completedAt: new Date().toISOString(),
        counts: { blobs: blobCount },
      } satisfies MigrationJournalRecord);
    });
    this.version(4).stores({
      geometry: "geometryRef",
      rides: "rideId",
      draft: "id",
      settings: "key",
      migrationJournal: "id",
      blobs: "originalRef",
      roadEntities: "id",
      roadSpans: "id, entityId",
      roadEvidence: "id, entityId",
    }).upgrade(async (transaction) => {
      const startedAt = new Date().toISOString();
      const [entityCount, spanCount, evidenceCount] = await Promise.all([
        transaction.table("roadEntities").count(),
        transaction.table("roadSpans").count(),
        transaction.table("roadEvidence").count(),
      ]);
      await transaction.table("migrationJournal").put({
        id: "schema-3-to-4",
        from: 3,
        to: 4,
        startedAt,
        completedAt: new Date().toISOString(),
        counts: { roadEntities: entityCount, roadSpans: spanCount, roadEvidence: evidenceCount },
      } satisfies MigrationJournalRecord);
    });
    // v5 adds the physical-activity authority (Task 8.1): one folded checkpoint
    // row per session plus the append-only journal a checkpoint compacts. The
    // compound `[sessionId+seq]` index is what makes the tail readable in order.
    this.version(5).stores({
      geometry: "geometryRef",
      rides: "rideId",
      draft: "id",
      settings: "key",
      migrationJournal: "id",
      blobs: "originalRef",
      roadEntities: "id",
      roadSpans: "id, entityId",
      roadEvidence: "id, entityId",
      rideSessions: "sessionId",
      rideSessionJournal: "id, sessionId, [sessionId+seq]",
    }).upgrade(async (transaction) => {
      const startedAt = new Date().toISOString();
      const [sessionCount, journalCount] = await Promise.all([
        transaction.table("rideSessions").count(),
        transaction.table("rideSessionJournal").count(),
      ]);
      await transaction.table("migrationJournal").put({
        id: "schema-4-to-5",
        from: 4,
        to: 5,
        startedAt,
        completedAt: new Date().toISOString(),
        counts: { rideSessions: sessionCount, rideSessionJournal: journalCount },
      } satisfies MigrationJournalRecord);
    });
    // v6 adds local-only recording traces. Coordinates are append-only bounded
    // batch values; the trace row contains lifecycle and derived summary only.
    this.version(6).stores({
      geometry: "geometryRef",
      rides: "rideId",
      draft: "id",
      settings: "key",
      migrationJournal: "id",
      blobs: "originalRef",
      roadEntities: "id",
      roadSpans: "id, entityId",
      roadEvidence: "id, entityId",
      rideSessions: "sessionId",
      rideSessionJournal: "id, sessionId, [sessionId+seq]",
      recordings: "recordingId",
      recordingBatches: "id, recordingId, [recordingId+batchSeq]",
    }).upgrade(async (transaction) => {
      const startedAt = new Date().toISOString();
      const [recordingCount, batchCount] = await Promise.all([
        transaction.table("recordings").count(),
        transaction.table("recordingBatches").count(),
      ]);
      await transaction.table("migrationJournal").put({
        id: "schema-5-to-6",
        from: 5,
        to: 6,
        startedAt,
        completedAt: new Date().toISOString(),
        counts: { recordings: recordingCount, recordingBatches: batchCount },
      } satisfies MigrationJournalRecord);
    });
    // v7 adds the share record store (Task 11.1). Rows are keyed by the opaque
    // ShareId and indexed by the link token; there is deliberately no listable
    // index over state (10 §10 — unlistable links).
    this.version(VNEXT_SCHEMA_VERSION).stores({
      geometry: "geometryRef",
      rides: "rideId",
      draft: "id",
      settings: "key",
      migrationJournal: "id",
      blobs: "originalRef",
      roadEntities: "id",
      roadSpans: "id, entityId",
      roadEvidence: "id, entityId",
      rideSessions: "sessionId",
      rideSessionJournal: "id, sessionId, [sessionId+seq]",
      recordings: "recordingId",
      recordingBatches: "id, recordingId, [recordingId+batchSeq]",
      shares: "shareId, token",
    }).upgrade(async (transaction) => {
      const startedAt = new Date().toISOString();
      const shareCount = await transaction.table("shares").count();
      await transaction.table("migrationJournal").put({
        id: "schema-6-to-7",
        from: 6,
        to: 7,
        startedAt,
        completedAt: new Date().toISOString(),
        counts: { shares: shareCount },
      } satisfies MigrationJournalRecord);
    });
    this.geometry = this.table<GeometryRecord, GeometryRef>("geometry");
    this.rides = this.table<StoredRideRecord, string>("rides");
    this.draft = this.table<DraftPointer, string>("draft");
    this.settings = this.table<SettingRecord, string>("settings");
    this.migrationJournal = this.table<MigrationJournalRecord, string>(
      "migrationJournal",
    );
    this.blobs = this.table<ImportBlobRecord, GeometryRef>("blobs");
    this.roadEntities = this.table<RoadEntity, string>("roadEntities");
    this.roadSpans = this.table<StoredRoadSpanRecord, string>("roadSpans");
    this.roadEvidence = this.table<RoadEvidenceRecord, string>("roadEvidence");
    this.rideSessions = this.table<RideSessionCheckpointRow, string>("rideSessions");
    this.rideSessionJournal = this.table<StoredRideSessionJournalRow, string>(
      "rideSessionJournal",
    );
    this.recordings = this.table<RecordingTraceRow, string>("recordings");
    this.recordingBatches = this.table<StoredRecordingBatchRow, string>(
      "recordingBatches",
    );
    this.shares = this.table<ShareRecord, ShareId>("shares");
  }
}

let shared: VNextDatabase | null = null;

/**
 * The app-wide connection. Browser code should use this so tabs and components
 * share one Dexie instance; a caller that needs an independent connection (a
 * test, a worker, a second tab simulation) constructs `VNextDatabase` directly.
 */
export function vnextDatabase(): VNextDatabase {
  shared ??= new VNextDatabase();
  return shared;
}

/** Delete rider data and discard the closed singleton so the next route can reopen it. */
export async function deleteVNextDatabase(): Promise<void> {
  const database = shared ?? new VNextDatabase();
  await database.delete();
  if (shared === database) shared = null;
}
