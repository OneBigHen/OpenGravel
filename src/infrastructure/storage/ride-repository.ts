/**
 * Durable RideDocument storage (02-ARCHITECTURE-CONTRACT §14–§15,
 * 11-OFFLINE-IDENTITY-SHARING-PRIVACY §17–§19).
 *
 * A ride row and the active-draft pointer are one checkpoint. The repository
 * never treats a failed transaction as a save, and a malformed row is moved to
 * a separate key before the caller is told that it was corrupt.
 */

import type { GeometryRef, RideId } from "@/domain/ride/ids";
import { isRecordingSummary } from "@/domain/recording/types";
import {
  SCHEMA_VERSION,
  type RideDocument,
  type RideIntent,
} from "@/domain/ride/types";
import { corridorPackManifestIsValid } from "@/domain/offline/capabilities";
import { isRideProvenance, validateRideIntent } from "@/domain/ride/validate";
import type {
  BootstrapPointerPort,
  LoadRideResult,
  RideDraftPointer,
  RideRepositoryPort,
  RideLibraryRepositoryPort,
  SaveLibraryRideOptions,
  RideRevision,
  RideRecord,
  SaveLibraryRideResult,
  RecordedTrackEnvelope,
  SaveResult,
  SaveRideOptions,
} from "@/application/persistence/ride-repository";
import { rideFocusGeometryRefs } from "@/application/persistence/ride-focus-pointer";
import {
  type DraftPointer,
  type CorruptRideRecord,
  type StoredRideRecord,
  VNextDatabase,
  vnextDatabase,
} from "./db";
import { createLocalStorageBootstrapPointer } from "./bootstrap-pointer";
import { createLocalStorageRideFocusPointer } from "./ride-focus-pointer";

export type {
  LoadRideResult,
  RideDraftPointer,
  RideRepositoryPort,
  RideLibraryRepositoryPort,
  RideRecord,
  RideRevision,
  SaveLibraryRideOptions,
  SaveResult,
  SaveRideOptions,
} from "@/application/persistence/ride-repository";

export const CORRUPT_RIDE_PREFIX = "rides.corrupt.";
export const STARTUP_GEOMETRY_SWEEP_LIMIT = 100;

export interface RideRepositoryOptions {
  readonly database?: VNextDatabase;
  readonly databaseName?: string;
  /**
   * The cached localStorage bootstrap hint, when this repository is the browser's.
   * Deleting a ride also drops a hint that names it: the hint is not authoritative,
   * but it is the only remaining recovery lead on the next boot (5.1t finding A2).
   */
  readonly bootstrapPointer?: BootstrapPointerPort;
  /** Geometry handles held by other durable authorities such as RideSession. */
  readonly protectedGeometryRefs?: () => readonly GeometryRef[] | null;
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * A writer token is usable only as a non-empty string. The checkpoint refuses an
 * unusable one outright, and the same-writer predicate needs the guarantee on the
 * stored side too (5.1t finding A4).
 */
function isUsableWriterToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasValidImportContentHash(value: unknown): boolean {
  if (!isRecord(value) || value.importData === undefined || !isRecord(value.importData)) return true;
  const hash = value.importData.sourceContentHash;
  return hash === undefined || (isString(hash) && /^[0-9a-f]{64}$/.test(hash));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isHistoryEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isString(value.entryId) &&
    value.entryId.startsWith("hist_") &&
    isString(value.label) &&
    isNonNegativeInteger(value.revision) &&
    rideIsValidIntent(value.intent)
  );
}

function rideIsValidIntent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  try {
    return validateRideIntent(value as unknown as RideIntent).length === 0;
  } catch {
    return false;
  }
}

function isDraftPointer(value: unknown): value is DraftPointer {
  if (!isRecord(value)) return false;
  return (
    value.id === "active" &&
    isString(value.rideId) &&
    value.rideId.startsWith("ride_") &&
    isString(value.updatedAt) &&
    value.updatedAt.length > 0 &&
    (value.geometryRefs === undefined ||
      (Array.isArray(value.geometryRefs) &&
        value.geometryRefs.every(
          (ref): ref is string => isString(ref) && ref.startsWith("geo_"),
        )))
  );
}

/**
 * Validates an untrusted persisted document, including its outer envelope and
 * the 1.x domain intent validator. It never throws and never repairs input.
 */
export function rideIsValid(value: unknown): value is RideDocument {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== SCHEMA_VERSION ||
    !isString(value.rideId) ||
    !value.rideId.startsWith("ride_") ||
    !isNonNegativeInteger(value.revision) ||
    !isString(value.createdAt) ||
    !isString(value.updatedAt) ||
    !(value.title === null || isString(value.title)) ||
    !isRideProvenance(value.provenance) ||
    !isRecord(value.history)
  ) {
    return false;
  }

  const history = value.history;
  if (
    !Array.isArray(history.entries) ||
    !isNonNegativeInteger(history.cursor) && history.cursor !== -1 ||
    !Array.isArray(history.appliedProposalIds) ||
    !history.appliedProposalIds.every(isString) ||
    !rideIsValidIntent(history.baseIntent) ||
    !history.entries.every(isHistoryEntry) ||
    !rideIsValidIntent(value.intent)
  ) {
    return false;
  }

  return true;
}

function isRideRecord(value: unknown): value is RideRecord {
  if (!isRecord(value)) return false;
  return (
    isString(value.rideId) &&
    value.rideId.startsWith("ride_") &&
    isNonNegativeInteger(value.revision) &&
    isString(value.updatedAt) &&
    value.updatedAt.length > 0 &&
    isString(value.writerToken) &&
    value.writerToken.length > 0 &&
    rideIsValid(value.document) &&
    value.document.rideId === value.rideId &&
    value.document.revision === value.revision &&
    value.document.updatedAt === value.updatedAt &&
    (value.uniqueKey === undefined || (isString(value.uniqueKey) && value.uniqueKey.length > 0)) &&
    hasValidImportContentHash(value) &&
    (value.recordedTrack === undefined || isRecordedTrackEnvelope(value.recordedTrack)) &&
    (value.offlinePack === undefined || corridorPackManifestIsValid(value.offlinePack))
  );
}

function isRecordedTrackEnvelope(value: unknown): value is RecordedTrackEnvelope {
  if (!isRecord(value)) return false;
  return (
    isString(value.recordingId) &&
    value.recordingId.startsWith("rec_") &&
    isString(value.geometryRef) &&
    value.geometryRef.startsWith("geo_") &&
    Array.isArray(value.timestamps) &&
    value.timestamps.every((timestamp) => isString(timestamp) && !Number.isNaN(Date.parse(timestamp))) &&
    isRecordingSummary(value.summary) &&
    value.summary.pointCount === value.timestamps.length &&
    value.timestamps.length >= 2
  );
}

function isQuotaError(error: unknown): boolean {
  if (error instanceof Error && error.name === "QuotaExceededError") return true;
  if (!isRecord(error)) return false;
  return error.name === "QuotaExceededError" || error.code === 22;
}

function corruptRideId(rideId: RideId): string {
  return `${CORRUPT_RIDE_PREFIX}${rideId}`;
}

function asRideRecord(value: StoredRideRecord | undefined): RideRecord | null {
  return value !== undefined && isRideRecord(value) ? value : null;
}

function sameStoredValue(left: unknown, right: unknown): boolean {
  // A replacement for the same ride arrives at a newer revision and timestamp, so
  // identity has to match before content is even considered.
  if (isRecord(left) && isRecord(right) && !sameRideStamp(left, right)) return false;
  return structurallyEqual(left, right);
}

/**
 * Whether two rows describe the same authored revision. Comparing these three
 * fields is how the quarantine decides between "still the row I just read" and
 * "someone re-authored this ride", without depending on JSON text or key order.
 */
function sameRideStamp(left: UnknownRecord, right: UnknownRecord): boolean {
  return (
    left.rideId === right.rideId &&
    left.revision === right.revision &&
    left.updatedAt === right.updatedAt
  );
}

/**
 * Structural equality that ignores property order. A structured-clone round trip does
 * not promise to preserve key order, so a row that came back re-serialized is still
 * the same row (5.1s finding 6). Values an own-key walk cannot describe — a `Date`, a
 * `Map`, a typed array, a class instance — are compared by their own semantics instead
 * of by an empty key list, which would call any two of them equal (5.1t finding A3).
 */
export function structurallyEqual(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, WeakSet<object>>(),
): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || left === null) return false;
  if (typeof right !== "object" || right === null) return false;

  const partners = seen.get(left);
  if (partners === undefined) seen.set(left, new WeakSet([right]));
  else if (partners.has(right)) return true;
  else partners.add(right);

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => structurallyEqual(item, right[index], seen));
  }

  // `Object.keys(new Date())` is `[]`, so without this every Date compares equal to
  // every other Date (and to `{}`).
  if (left instanceof Date || right instanceof Date) {
    return (
      left instanceof Date && right instanceof Date && left.getTime() === right.getTime()
    );
  }

  if (objectTag(left) !== objectTag(right)) return false;

  if (left instanceof Map && right instanceof Map) return mapsEqual(left, right, seen);
  if (left instanceof Set && right instanceof Set) return setsEqual(left, right, seen);
  if (ArrayBuffer.isView(left) && ArrayBuffer.isView(right)) return bytesEqual(left, right);
  if (left instanceof ArrayBuffer && right instanceof ArrayBuffer) {
    return bytesEqual(left, right);
  }

  // Anything else that is not a plain record — a class instance, a stream — has no key
  // semantics this comparison can trust: only an identical serialization counts.
  if (!isPlainRecord(left) || !isPlainRecord(right)) return serializedEqual(left, right);

  const leftRecord = left as UnknownRecord;
  const rightRecord = right as UnknownRecord;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    if (leftKeys[index] !== rightKeys[index]) return false;
  }
  return leftKeys.every((key) => structurallyEqual(leftRecord[key], rightRecord[key], seen));
}

/** Only `{}`-shaped records have own-key semantics worth comparing. */
function isPlainRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function objectTag(value: object): string {
  return Object.prototype.toString.call(value);
}

function serializedEqual(left: object, right: object): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    // A value with no comparable serialization (a BigInt member, a cycle) is not
    // provably the same value, so it is treated as changed rather than as equal.
    return false;
  }
}

function mapsEqual(
  left: Map<unknown, unknown>,
  right: Map<unknown, unknown>,
  seen: WeakMap<object, WeakSet<object>>,
): boolean {
  if (left.size !== right.size) return false;
  const remaining = Array.from(right.entries());
  for (const [key, value] of left) {
    const index = remaining.findIndex(([candidate]) =>
      structurallyEqual(key, candidate, seen),
    );
    const entry = remaining[index];
    if (entry === undefined) return false;
    remaining.splice(index, 1);
    if (!structurallyEqual(value, entry[1], seen)) return false;
  }
  return true;
}

function setsEqual(
  left: Set<unknown>,
  right: Set<unknown>,
  seen: WeakMap<object, WeakSet<object>>,
): boolean {
  if (left.size !== right.size) return false;
  const remaining = Array.from(right.values());
  for (const value of left) {
    const index = remaining.findIndex((candidate) =>
      structurallyEqual(value, candidate, seen),
    );
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return true;
}

function bytesEqual(
  left: ArrayBufferView | ArrayBuffer,
  right: ArrayBufferView | ArrayBuffer,
): boolean {
  const leftBytes = asBytes(left);
  const rightBytes = asBytes(right);
  if (leftBytes.length !== rightBytes.length) return false;
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

function asBytes(value: ArrayBufferView | ArrayBuffer): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

/**
 * Whether the stored row is this writer's own earlier checkpoint and the incoming
 * document is a strictly newer revision of it. A usable token is required on *both*
 * sides: `previous.writerToken === options.writerToken` alone reads two absent tokens
 * as the same writer, and then any strictly newer revision supersedes the row — the
 * cross-tab clobber the conflict check exists to prevent (5.1t finding A4).
 */
export function isSameWriterAdvance(
  previous: RideRecord | null,
  writerToken: unknown,
  revision: number,
): boolean {
  return (
    previous !== null &&
    isUsableWriterToken(writerToken) &&
    isUsableWriterToken(previous.writerToken) &&
    previous.writerToken === writerToken &&
    revision > previous.revision
  );
}

function collectGeometryRefs(
  value: unknown,
  refs = new Set<GeometryRef>(),
  seen = new Set<object>(),
): Set<GeometryRef> {
  if (Array.isArray(value)) {
    for (const item of value) collectGeometryRefs(item, refs, seen);
    return refs;
  }
  if (!isRecord(value)) return refs;
  if (seen.has(value)) return refs;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (
      (key === "geometryRef" || key === "corridorRef") &&
      typeof child === "string" &&
      child.startsWith("geo_")
    ) {
      refs.add(child as GeometryRef);
      continue;
    }
    if (key === "rawStrokeRefs" && Array.isArray(child)) {
      for (const ref of child) {
        if (typeof ref === "string" && ref.startsWith("geo_")) refs.add(ref as GeometryRef);
      }
      continue;
    }
    collectGeometryRefs(child, refs, seen);
  }
  return refs;
}

function referencedGeometryRefs(records: readonly StoredRideRecord[]): Set<GeometryRef> {
  const refs = new Set<GeometryRef>();
  for (const record of records) {
    if (!isRideRecord(record)) continue;
    collectGeometryRefs(record.document, refs);
    if (record.importData !== undefined) collectGeometryRefs(record.importData, refs);
    if (record.recordedTrack !== undefined) refs.add(record.recordedTrack.geometryRef);
  }
  return refs;
}

export class RideRepository implements RideRepositoryPort, RideLibraryRepositoryPort {
  readonly database: VNextDatabase;
  private readonly bootstrapPointer: BootstrapPointerPort | undefined;
  private readonly protectedGeometryRefs: RideRepositoryOptions["protectedGeometryRefs"];

  constructor(options: RideRepositoryOptions = {}) {
    this.bootstrapPointer = options.bootstrapPointer;
    this.protectedGeometryRefs = options.protectedGeometryRefs;
    this.database =
      options.database ??
      (options.databaseName === undefined
        ? vnextDatabase()
        : new VNextDatabase(options.databaseName));
    // Startup cleanup is deliberately bounded so opening the app cannot turn a
    // large old geometry backlog into an unbounded boot transaction.
    void this.sweepUnreferencedGeometry(STARTUP_GEOMETRY_SWEEP_LIMIT).catch(() => undefined);
  }

  async saveRide(
    document: RideDocument,
    options: SaveRideOptions,
  ): Promise<SaveResult> {
    if (!rideIsValid(document) || !isUsableWriterToken(options.writerToken)) {
      return {
        ok: false,
        reason: "write-failed",
        error: new Error("cannot checkpoint an invalid ride or empty writer token"),
      };
    }

    let preservedRevision: number | null = null;
    let conflict: { readonly storedRevision: number; readonly ourRevision: number } | null = null;
    const baseRecord: RideRecord = {
      rideId: document.rideId,
      revision: document.revision,
      updatedAt: document.updatedAt,
      writerToken: options.writerToken,
      document,
    };
    const documentGeometryRefs = Array.from(collectGeometryRefs(document));
    const pointer: RideDraftPointer = {
      id: "active",
      rideId: document.rideId,
      updatedAt: document.updatedAt,
      ...(documentGeometryRefs.length === 0
        ? {}
        : { geometryRefs: documentGeometryRefs }),
    };

    try {
      await this.database.transaction(
        "rw",
        this.database.rides,
        this.database.draft,
        // The draft pointer written below carries this document's `geometryRefs`,
        // and the geometry sweep computes liveness from committed rows plus that
        // pointer. Locking geometry keeps a sweep started while this write is in
        // flight from reclaiming a blob this document is about to reference
        // (5.1s finding 2).
        this.database.geometry,
        async () => {
          const previous = asRideRecord(await this.database.rides.get(document.rideId));
          preservedRevision = previous?.revision ?? null;
          const expectedBaseRevision =
            options.baseRevision ?? Math.max(0, document.revision - 1);
          // This tab's own stored row is never a foreign advance. When an earlier
          // checkpoint of this writer already advanced the store (committed, or still
          // committing while a lifecycle flush supersedes it), a strictly newer
          // revision from the same writer supersedes that row. Without this rule the
          // flush write would be refused as a conflict against its own predecessor and
          // the newest edit would stay unsaved. A stale or foreign row still conflicts:
          // `sameWriterAdvance` requires a strictly newer revision.
          const sameWriterAdvance = isSameWriterAdvance(
            previous,
            options.writerToken,
            document.revision,
          );
          if (
            previous !== null &&
            !sameWriterAdvance &&
            (previous.revision > expectedBaseRevision || previous.revision > document.revision)
          ) {
            conflict = {
              storedRevision: previous.revision,
              ourRevision: document.revision,
            };
            return;
          }
          const record: RideRecord = {
            ...baseRecord,
            ...(previous?.savedAt === undefined ? {} : { savedAt: previous.savedAt }),
            ...(previous?.uniqueKey === undefined ? {} : { uniqueKey: previous.uniqueKey }),
            ...(previous?.derivedFrom === undefined
              ? {}
              : { derivedFrom: previous.derivedFrom }),
            ...(previous?.originalsRef === undefined
              ? {}
              : { originalsRef: previous.originalsRef }),
            ...(previous?.area === undefined ? {} : { area: previous.area }),
            ...(previous?.bundleSummary === undefined
              ? {}
              : { bundleSummary: previous.bundleSummary }),
            ...(previous?.offlinePack === undefined
              ? {}
              : { offlinePack: previous.offlinePack }),
            ...(previous?.importData === undefined
              ? {}
              : { importData: previous.importData }),
            ...(previous?.recordedTrack === undefined
              ? {}
              : { recordedTrack: previous.recordedTrack }),
          };
          await this.database.rides.put(record);
          await this.database.draft.put(pointer);
        },
      );
      if (conflict !== null) return { ok: false, reason: "conflict", conflict };
      return { ok: true };
    } catch (error: unknown) {
      if (isQuotaError(error)) {
        return { ok: false, reason: "quota", preservedRevision };
      }
      return { ok: false, reason: "write-failed", error };
    }
  }

  async loadRide(rideId: RideId): Promise<LoadRideResult> {
    let result: LoadRideResult = null;
    await this.database.transaction("rw", this.database.rides, async () => {
      // The read, validation, quarantine write and conditional delete share one
      // read-write transaction. A replacement cannot slip between them.
      const stored = await this.database.rides.get(rideId);
      if (stored === undefined) return;
      if (isRideRecord(stored)) {
        result = { ok: true, document: stored.document };
        return;
      }
      const quarantined: CorruptRideRecord = {
        rideId: corruptRideId(rideId),
        originalRideId: rideId,
        corruptedAt: new Date().toISOString(),
        record: stored,
      };
      await this.database.rides.put(quarantined);
      const current = await this.database.rides.get(rideId);
      if (current !== undefined && sameStoredValue(current, stored)) {
        await this.database.rides.delete(rideId);
      }
      result = { ok: false, reason: "corrupt" };
    });
    return result;
  }

  async loadDraftPointer(): Promise<DraftPointer | null> {
    const pointer = await this.database.draft.get("active");
    return isDraftPointer(pointer) ? pointer : null;
  }

  async saveLibraryRide(
    document: RideDocument,
    options: SaveLibraryRideOptions,
  ): Promise<SaveLibraryRideResult> {
    if (!rideIsValid(document) || options.writerToken.length === 0) {
      throw new Error("cannot checkpoint an invalid ride or empty writer token");
    }
    const record: RideRecord = {
      rideId: document.rideId,
      revision: document.revision,
      updatedAt: document.updatedAt,
      writerToken: options.writerToken,
      document,
      savedAt: options.savedAt,
      ...(options.derivedFrom === undefined ? {} : { derivedFrom: options.derivedFrom }),
      ...(options.uniqueKey === undefined ? {} : { uniqueKey: options.uniqueKey }),
      ...(options.originalsRef === undefined ? {} : { originalsRef: options.originalsRef }),
      ...(options.area === undefined ? {} : { area: options.area }),
      ...(options.bundleSummary === undefined ? {} : { bundleSummary: options.bundleSummary }),
      ...(options.offlinePack === undefined ? {} : { offlinePack: options.offlinePack }),
      ...(options.importData === undefined ? {} : { importData: options.importData }),
      ...(options.recordedTrack === undefined ? {} : { recordedTrack: options.recordedTrack }),
    };
    let result: SaveLibraryRideResult = { status: "saved" };
    const uniqueKey = options.uniqueKey;
    if (uniqueKey === undefined) {
      await this.database.rides.put(record);
      return { status: "saved" };
    }
    await this.database.transaction("rw", this.database.rides, async () => {
      const duplicate = (await this.database.rides.toArray()).find((stored): stored is RideRecord =>
        isRideRecord(stored) &&
        stored.savedAt !== undefined &&
        stored.rideId !== record.rideId &&
        stored.uniqueKey === uniqueKey,
      );
      if (duplicate !== undefined) {
        result = { status: "duplicate-key", title: duplicate.document.title };
        return;
      }
      await this.database.rides.put(record);
    });
    return result;
  }

  async loadRideRecord(rideId: RideId): Promise<RideRecord | null> {
    return asRideRecord(await this.database.rides.get(rideId));
  }

  async listRideRecords(): Promise<readonly RideRecord[]> {
    const stored = await this.database.rides.toArray();
    return stored.filter((record): record is RideRecord => isRideRecord(record));
  }

  async deleteRide(rideId: RideId): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.rides,
      this.database.draft,
      this.database.geometry,
      async () => {
        await this.database.rides.delete(rideId);
        const pointer = await this.database.draft.get("active");
        if (pointer?.rideId === rideId) await this.database.draft.delete("active");
        await this.sweepUnreferencedGeometryInTransaction();
      },
    );
    // The hint is not authoritative, but it is the only remaining recovery lead on the
    // next boot: one that names the ride that just went away must not survive the
    // delete, or a boot with a lost IndexedDB pointer can recover a deleted ride
    // (5.1t finding A2). Failure to clear the cache never fails the delete itself.
    this.invalidateHintFor(rideId);
  }

  /** Drops a cached bootstrap hint that names `rideId`; unrelated hints are kept. */
  private invalidateHintFor(rideId: RideId): void {
    const pointer = this.bootstrapPointer;
    if (pointer === undefined) return;
    try {
      const read = pointer.read();
      if (read.status === "found" && read.hint.rideId === rideId) pointer.invalidate();
    } catch {
      // The row and the IndexedDB pointer are already gone, and the next boot's
      // `loadRide` refuses a tombstoned id: an unreadable hint is not a failed delete.
    }
  }

  /** Reclaims geometry no longer reachable from any durable ride document. */
  async sweepUnreferencedGeometry(limit?: number): Promise<number> {
    let removed = 0;
    await this.database.transaction(
      "rw",
      this.database.rides,
      this.database.draft,
      this.database.geometry,
      async () => {
        removed = await this.sweepUnreferencedGeometryInTransaction(limit);
      },
    );
    return removed;
  }

  private async sweepUnreferencedGeometryInTransaction(limit?: number): Promise<number> {
    const records = await this.database.rides.toArray();
    const refs = referencedGeometryRefs(records);
    const draft = await this.database.draft.get("active");
    for (const ref of draft?.geometryRefs ?? []) refs.add(ref);
    if (this.protectedGeometryRefs !== undefined) {
      try {
        const protectedRefs = this.protectedGeometryRefs();
        // A corrupt or temporarily unreadable external owner must not make its
        // geometry look orphaned. Defer reclamation until liveness is knowable.
        if (protectedRefs === null) return 0;
        for (const ref of protectedRefs) refs.add(ref);
      } catch {
        return 0;
      }
    }
    const keys = await this.database.geometry.toCollection().primaryKeys();
    const candidates = limit === undefined ? keys : keys.slice(0, limit);
    let removed = 0;
    for (const key of candidates) {
      if (!refs.has(key)) {
        await this.database.geometry.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async readRideRevision(rideId: RideId): Promise<RideRevision | null> {
    const record = asRideRecord(await this.database.rides.get(rideId));
    return record === null
      ? null
      : { revision: record.revision, writerToken: record.writerToken };
  }
}

export function createRideRepository(options: RideRepositoryOptions = {}): RideRepository {
  return new RideRepository(options);
}

/** Process-wide browser repository; stores share the singleton Dexie connection. */
const rideFocusPointer = createLocalStorageRideFocusPointer();
export const rideRepository: RideRepository = createRideRepository({
  bootstrapPointer: createLocalStorageBootstrapPointer(),
  protectedGeometryRefs: () => rideFocusGeometryRefs(rideFocusPointer),
});
