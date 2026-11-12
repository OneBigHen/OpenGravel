import { deepFreeze } from "@/domain/util/freeze";
import { newRideId, type GeometryRef, type RideId } from "@/domain/ride/ids";
import type { RideDocument, RideIntent, RideProvenance } from "@/domain/ride/types";
import type {
  LibrarySourceKind,
  PlannedRouteEnvelope,
  RideDerivedFrom,
  RideLibraryRepositoryPort,
  RideRecord,
  RideRepositoryPort,
  RecordedTrackEnvelope,
  RideBundleSummary,
} from "@/application/persistence/ride-repository";
import { libraryTypeForRecord, type LibraryRideType } from "./provenance";
import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { ImportBlobStore } from "@/application/import/import-artifact";
import { importBlobBytes } from "@/application/import/import-artifact";
import type { Coordinate } from "@/domain/ride/types";
import type { ImportedTrackData, ImportRideData } from "@/application/import/types";
import type { CorridorPackManifest } from "@/domain/offline/capabilities";
import type { RecordingId } from "@/domain/recording/ids";
import type { RecordingTelemetry } from "@/domain/recording/telemetry";
import type { RecordingSummary } from "@/domain/recording/types";
import { createRideDocument } from "@/domain/ride/create";
import { lineDistance } from "@/domain/breadcrumb/route";
import type { RouteEvidence, RouteInstruction } from "@/domain/route/types";

export interface NamedRide {
  readonly document: RideDocument;
  readonly savedAt: string;
}

export class UniqueRideAlreadyExistsError extends Error {
  readonly title: string | null;

  constructor(title: string | null) {
    super("A ride with the same unique save key already exists.");
    this.name = "UniqueRideAlreadyExistsError";
    this.title = title;
  }
}

export interface RideSummary {
  readonly rideId: RideId;
  readonly title: string;
  readonly type: LibraryRideType;
  readonly provenanceType: RideProvenance["type"];
  readonly sourceLabel?: RideProvenance["source"] | null;
  readonly savedAt: string;
  readonly updatedAt: string;
  readonly area: string | null;
  readonly distanceMeters: number | null;
  readonly durationSeconds: number | null;
  readonly sourceId: string | null;
  readonly exportCapabilities?: {
    readonly plannedRoute: boolean;
    readonly track: boolean;
    readonly original: boolean;
    readonly recordedRide: boolean;
  };
  readonly offlinePack?: "present" | "not-present";
  /**
   * What the card draws on its map (owner: routes need a real map): the ride's
   * line when one is stored (a track or a recording), else its authored points.
   */
  readonly mapPreview?: {
    readonly line: readonly Coordinate[];
    readonly pins: readonly Coordinate[];
  };
  /** The import's caveats (waypoints kept as metadata, etc.), kept with the ride. */
  readonly importNotes?: readonly string[];
  readonly recordedTrack?: {
    readonly summary: RecordingSummary;
    /** Bounded preview line for the library thumbnail, never the full trace. */
    readonly previewGeometry: readonly Coordinate[];
  };
}

export interface ExportWaypoint {
  readonly name: string | null;
  readonly coordinate: Coordinate;
}

export interface RideExportSource {
  readonly title: string;
  /** The ride document's creation instant, for `<metadata><time>`. */
  readonly createdTime: string;
  readonly plannedRoute: {
    readonly geometry: readonly Coordinate[];
    readonly waypoints: readonly ExportWaypoint[];
  } | null;
  readonly tracks: readonly ImportedTrackData[];
  readonly trackGeometry: Readonly<Record<string, readonly Coordinate[]>>;
  readonly waypoints: readonly ExportWaypoint[];
  readonly originalBytes: Uint8Array | null;
  readonly originalFilename: string | null;
  readonly originalMime: string | null;
  readonly recordedTrack: {
    readonly coordinates: readonly Coordinate[];
    readonly timestamps: readonly string[];
    readonly summary: RecordingSummary;
  } | null;
}

export interface SaveFreeRideSummaryInput {
  readonly document: RideDocument;
  readonly sessionId: string;
  readonly telemetry: RecordingTelemetry | null;
  readonly acceptedGeometryRefs: readonly GeometryRef[];
}

export interface SaveRecordedRideInput {
  readonly recordingId: RecordingId;
  readonly coordinates: readonly Coordinate[];
  readonly timestamps: readonly string[];
  readonly summary: RecordingSummary;
}

export interface SavedRecordedRide {
  readonly rideId: RideId;
  readonly savedAt: string;
  readonly summary: RecordingSummary;
}

export interface RideDateRange {
  readonly from?: string;
  readonly to?: string;
}

export interface RideListFilter {
  readonly type?: LibraryRideType;
  readonly text?: string;
  readonly area?: string;
  readonly dateRange?: RideDateRange;
}

export interface SaveNamedOptions {
  readonly title: string;
  readonly originalsRef?: string;
  readonly uniqueKey?: string;
  readonly importData?: ImportRideData;
  readonly offlinePack?: CorridorPackManifest;
  /** Distance and time the card shows; known at save time, not re-derived. */
  readonly bundleSummary?: RideBundleSummary;
  /** The selected route line; without it the saved ride has nothing to export. */
  readonly plannedRoute?: SavePlannedRouteInput;
}

/** A route line the rider selected in the planner, at the moment of saving. */
export interface SavePlannedRouteInput {
  readonly geometry: readonly Coordinate[];
  /** The chosen card's distance and time, so a reopen shows the same numbers. */
  readonly distanceMeters?: number;
  readonly durationSeconds?: number;
  /** The chosen card's evidence; only facts that do not go stale are kept. */
  readonly evidence?: RouteEvidence;
  readonly instructions?: readonly RouteInstruction[];
}

/**
 * Evidence that describes a day, not a road: a closure check, traffic, weather,
 * daylight and seasonal access are true when they were asked, so a saved ride
 * never carries them into a later day as if they were still checked.
 */
const TIME_SENSITIVE_EVIDENCE: ReadonlySet<string> = new Set([
  "closures",
  "traffic",
  "weatherExposure",
  "daylight",
  "access",
]);

function lastingEvidence(evidence: RouteEvidence | undefined): RouteEvidence | undefined {
  if (evidence === undefined) return undefined;
  const kept = Object.fromEntries(
    Object.entries(evidence).filter(([key]) => !TIME_SENSITIVE_EVIDENCE.has(key)),
  );
  return Object.keys(kept).length === 0 ? undefined : JSON.parse(JSON.stringify(kept)) as RouteEvidence;
}

function finitePositive(value: number | undefined | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Two ends this close are one place: the track is a loop (R3-1). */
export const LOOP_ENDS_METERS = 150;

/**
 * The line a saved or imported ride is opened on, exactly as it was kept.
 * `durationSeconds` is `null` when nothing stated a time for it (an import with
 * no timestamps); the caller decides how to say that, never this service.
 */
export interface SavedRideLine {
  readonly origin: "saved" | "import";
  readonly geometry: readonly Coordinate[];
  readonly distanceMeters: number;
  readonly durationSeconds: number | null;
  readonly evidence: RouteEvidence;
  readonly instructions?: readonly RouteInstruction[];
}

/** What opening a ride from My rides gives the planner. */
export interface OpenedLibraryRide {
  /** The working copy the planner restores; it keeps the saved ride's name. */
  readonly document: RideDocument;
  /** The ride's own line, or `null` when the planner has to plan it. */
  readonly line: SavedRideLine | null;
  /**
   * True for a planned ride saved before its line was kept: it is planned
   * again, and the rider is told why the numbers may differ.
   */
  readonly lineMissing: boolean;
}

export interface LibraryExploreRide {
  readonly summary: RideSummary;
  readonly document: RideDocument;
  /** A single contiguous imported track, or empty when no route geometry is retained. */
  readonly geometry: readonly Coordinate[];
  /** Last observed fix for an actual recording, never an import or save time. */
  readonly riddenAt?: string;
}

export interface CreateDerivativeOptions {
  readonly title?: string | null;
}

export interface LibraryServicePort {
  saveNamed(document: RideDocument, options: SaveNamedOptions): Promise<NamedRide>;
  /** Returns a saved SwitchBack import with this exact source-byte fingerprint. */
  findImportedContentHash(hash: string): Promise<{ readonly title: string | null } | null>;
  /** Idempotent for one source recording; the GeometryStore and library row commit before cleanup. */
  saveRecorded(input: SaveRecordedRideInput): Promise<SavedRecordedRide>;
  findRecorded(recordingId: RecordingId): Promise<SavedRecordedRide | null>;
  listRides(filter?: RideListFilter): Promise<readonly RideSummary[]>;
  readonly listExploreRides?: () => Promise<readonly LibraryExploreRide[]>;
  renameRide(rideId: RideId, title: string): Promise<void>;
  deleteRide(rideId: RideId): Promise<void>;
  createDerivative(
    sourceKind: LibrarySourceKind,
    sourceId: string,
    document: RideDocument,
    options?: CreateDerivativeOptions,
  ): Promise<RideDocument>;
  /** A working copy planned again from the saved request ("Plan it again"). */
  openRide(rideId: RideId): Promise<RideDocument>;
  /** A working copy that follows the saved or imported line exactly (R3-1). */
  readonly openSavedRide?: (rideId: RideId) => Promise<OpenedLibraryRide>;
  readonly loadExportSource?: (rideId: RideId) => Promise<RideExportSource>;
}

export interface LibraryServiceOptions {
  readonly now?: () => string;
  readonly blobStore?: ImportBlobStore;
  readonly geometryStore?: GeometryStore;
}

type LibraryRepository = RideRepositoryPort & RideLibraryRepositoryPort;

function requiredTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) throw new Error("A ride title is required");
  return trimmed;
}

function sourceReference(
  provenance: RideProvenance,
): RideDerivedFrom | undefined {
  if (provenance.sourceId === undefined) return undefined;
  if (
    provenance.type === "catalog" ||
    provenance.type === "shared" ||
    provenance.type === "recorded" ||
    provenance.type === "import"
  ) {
    return { kind: provenance.type, sourceId: provenance.sourceId };
  }
  if (provenance.type === "derived") {
    return { kind: "ride", sourceId: provenance.sourceId };
  }
  return undefined;
}

function withIdentity(
  document: RideDocument,
  values: {
    readonly rideId: RideId;
    readonly now: string;
    readonly title: string | null;
    readonly provenance: RideProvenance;
  },
): RideDocument {
  return deepFreeze<RideDocument>({
    ...document,
    rideId: values.rideId,
    createdAt: values.now,
    updatedAt: values.now,
    title: values.title,
    provenance: values.provenance,
  });
}

function updatedTitle(document: RideDocument, title: string, now: string): RideDocument {
  return deepFreeze<RideDocument>({ ...document, title, updatedAt: now });
}

function summary(record: RideRecord): RideSummary {
  return {
    rideId: record.rideId,
    title: record.document.title ?? "Untitled ride",
    type: libraryTypeForRecord(record),
    provenanceType: record.document.provenance.type,
    sourceLabel: record.document.provenance.source ?? null,
    savedAt: record.savedAt ?? record.updatedAt,
    updatedAt: record.updatedAt,
    area: record.area ?? null,
    distanceMeters: record.bundleSummary?.distanceMeters ?? null,
    durationSeconds: record.bundleSummary?.durationSeconds ?? null,
    sourceId: record.derivedFrom?.sourceId ?? record.document.provenance.sourceId ?? null,
    offlinePack: record.offlinePack === undefined ? "not-present" : "present",
    ...(record.freeRideSummary === undefined ? {} : {
      importNotes: ["Summary only. Accepted suggestions are planned lines, not a recorded track."],
    }),
    ...(record.importData?.warnings === undefined || record.importData.warnings.length === 0
      ? {}
      : { importNotes: record.importData.warnings }),
    ...(record.recordedTrack === undefined
      ? {}
      : { recordedTrack: { summary: record.recordedTrack.summary, previewGeometry: [] } }),
    exportCapabilities: {
      plannedRoute:
        record.plannedRoute !== undefined ||
        (record.importData !== undefined &&
          record.importData.tracks.length === 1 &&
          record.importData.tracks[0]?.segments.length === 1),
      track: (record.importData?.tracks.length ?? 0) > 0,
      original: record.originalsRef !== undefined,
      recordedRide: record.recordedTrack !== undefined,
    },
  };
}

function previewLine(coordinates: readonly Coordinate[], maximumPoints = 64): readonly Coordinate[] {
  if (coordinates.length <= maximumPoints) return coordinates;
  const last = coordinates.at(-1);
  if (last === undefined) return [];
  const stride = (coordinates.length - 1) / (maximumPoints - 1);
  return Array.from({ length: maximumPoints }, (_, index) => {
    const coordinate = coordinates[Math.round(index * stride)];
    return coordinate ?? last;
  });
}

function matches(record: RideRecord, filter: RideListFilter): boolean {
  if (record.savedAt === undefined) return false;
  const item = summary(record);
  if (filter.type !== undefined && item.type !== filter.type) return false;
  if (filter.text !== undefined && !item.title.toLowerCase().includes(filter.text.trim().toLowerCase())) {
    return false;
  }
  if (filter.area !== undefined && !(item.area ?? "").toLowerCase().includes(filter.area.trim().toLowerCase())) {
    return false;
  }
  const date = item.savedAt;
  if (filter.dateRange?.from !== undefined && date < filter.dateRange.from) return false;
  if (filter.dateRange?.to !== undefined && date > filter.dateRange.to) return false;
  return true;
}

/**
 * Start, stops and finish as export waypoints. A point the rider never named
 * stays unnamed: a role word ("Start") would be a name they did not give.
 */
export function waypointsFromIntent(intent: RideIntent): readonly ExportWaypoint[] {
  if (intent.breadcrumb != null) return intent.breadcrumb.waypoints.map((point) => ({ name: point.name?.trim() || null, coordinate: point.coordinate }));
  const waypoints: ExportWaypoint[] = [];
  if (intent.start !== null) {
    waypoints.push({ name: intent.start.label?.trim() || null, coordinate: intent.start.coordinate });
  }
  for (const stop of intent.stops) {
    waypoints.push({ name: stop.label?.trim() || null, coordinate: stop.coordinate });
  }
  if (intent.finish !== null) {
    waypoints.push({ name: intent.finish.label?.trim() || null, coordinate: intent.finish.coordinate });
  }
  return waypoints;
}

export class LibraryService implements LibraryServicePort {
  private readonly repository: LibraryRepository;
  private readonly now: () => string;
  private readonly blobStore: ImportBlobStore | undefined;
  private readonly geometryStore: GeometryStore | undefined;

  constructor(repository: LibraryRepository, options: LibraryServiceOptions = {}) {
    this.repository = repository;
    this.now = options.now ?? (() => new Date().toISOString());
    this.blobStore = options.blobStore;
    this.geometryStore = options.geometryStore;
  }

  /**
   * The route line is written before the library row, exactly like a recording:
   * a row that never commits leaves only an unreferenced payload, which the
   * startup sweep reclaims.
   */
  private async storePlannedRoute(
    input: SavePlannedRouteInput | undefined,
    savedAt: string,
  ): Promise<PlannedRouteEnvelope | undefined> {
    if (input === undefined) return undefined;
    if (input.geometry.length < 2) throw new Error("A planned route needs at least two geometry points.");
    if (this.geometryStore === undefined) throw new Error("Planned route geometry storage is unavailable.");
    const geometry = await this.geometryStore.put(
      { kind: "line", coordinates: input.geometry.map((coordinate) => ({ ...coordinate })) },
      { kind: "route", now: savedAt },
    );
    const evidence = lastingEvidence(input.evidence);
    return {
      geometryRef: geometry.geometryRef,
      ...(finitePositive(input.distanceMeters) ? { distanceMeters: input.distanceMeters } : {}),
      ...(finitePositive(input.durationSeconds) ? { durationSeconds: input.durationSeconds } : {}),
      ...(evidence === undefined ? {} : { evidence }),
      ...(input.instructions === undefined || input.instructions.length === 0
        ? {}
        : { instructions: JSON.parse(JSON.stringify(input.instructions)) as readonly RouteInstruction[] }),
    };
  }

  async saveNamed(document: RideDocument, options: SaveNamedOptions): Promise<NamedRide> {
    const title = requiredTitle(options.title);
    const savedAt = this.now();
    const namedDocument = withIdentity(document, {
      rideId: newRideId(),
      now: savedAt,
      title,
      provenance: document.provenance,
    });
    const offlinePack = options.offlinePack === undefined
      ? undefined
      : { ...options.offlinePack, rideId: namedDocument.rideId };
    const plannedRoute = await this.storePlannedRoute(options.plannedRoute, savedAt);
    const saveResult = await this.repository.saveLibraryRide(namedDocument, {
      writerToken: `library-${crypto.randomUUID()}`,
      savedAt,
      ...(sourceReference(document.provenance) === undefined
        ? {}
        : { derivedFrom: sourceReference(document.provenance) }),
      ...(options.originalsRef === undefined ? {} : { originalsRef: options.originalsRef }),
      ...(options.uniqueKey === undefined ? {} : { uniqueKey: options.uniqueKey }),
      ...(options.importData === undefined ? {} : { importData: options.importData }),
      ...(offlinePack === undefined ? {} : { offlinePack }),
      ...(plannedRoute === undefined ? {} : { plannedRoute }),
      ...(options.bundleSummary === undefined ? {} : { bundleSummary: options.bundleSummary }),
    });
    if (saveResult.status === "duplicate-key") {
      throw new UniqueRideAlreadyExistsError(saveResult.title);
    }
    return { document: namedDocument, savedAt };
  }

  async findImportedContentHash(hash: string): Promise<{ readonly title: string | null } | null> {
    const records = await this.repository.listRideRecords();
    const match = records.find((record) =>
      record.savedAt !== undefined &&
      record.document.provenance.type === "import" &&
      record.document.provenance.source === "SwitchBack" &&
      record.importData?.sourceContentHash === hash,
    );
    return match === undefined ? null : { title: match.document.title };
  }

  async saveFreeRideSummary(input: SaveFreeRideSummaryInput): Promise<RideId> {
    const rideId = (`ride_summary_${input.sessionId}`) as RideId;
    if ((await this.repository.loadRideRecord(rideId))?.savedAt !== undefined) return rideId;
    const savedAt = this.now();
    const acceptedGeometryRefs = [...new Set(input.acceptedGeometryRefs)];
    for (const ref of acceptedGeometryRefs) {
      const stored = await this.geometryStore?.get(ref);
      if (stored?.payload.kind !== "line") throw new Error("An accepted suggestion line is unavailable.");
    }
    const document = withIdentity(input.document, {
      rideId, now: savedAt, title: "Free Ride summary",
      provenance: { type: "derived", sourceId: input.document.rideId },
    });
    await this.repository.saveLibraryRide(document, {
      writerToken: `summary-${input.sessionId}`, savedAt,
      derivedFrom: { kind: "ride", sourceId: input.document.rideId },
      freeRideSummary: { telemetry: input.telemetry, acceptedGeometryRefs },
      ...(input.telemetry === null ? {} : { bundleSummary: {
        distanceMeters: input.telemetry.acceptedDistanceMeters,
        durationSeconds: input.telemetry.movingMs / 1000,
      } }),
    });
    return rideId;
  }

  async saveRecorded(input: SaveRecordedRideInput): Promise<SavedRecordedRide> {
    if (
      !input.recordingId.startsWith("rec_") ||
      input.coordinates.length < 2 ||
      input.coordinates.length !== input.timestamps.length ||
      input.summary.pointCount !== input.coordinates.length ||
      input.timestamps.some((timestamp) => Number.isNaN(Date.parse(timestamp)))
    ) {
      throw new Error("The recorded trace is incomplete or malformed.");
    }
    const rideId = (`ride_${input.recordingId}`) as RideId;
    const existing = await this.repository.loadRideRecord(rideId);
    if (existing?.recordedTrack?.recordingId === input.recordingId && existing.savedAt !== undefined) {
      return { rideId, savedAt: existing.savedAt, summary: existing.recordedTrack.summary };
    }
    if (this.geometryStore === undefined) {
      throw new Error("Recorded geometry storage is unavailable.");
    }

    const savedAt = this.now();
    const document = createRideDocument({
      rideId,
      now: savedAt,
      title: "Recorded ride",
      provenance: { type: "recorded", sourceId: input.recordingId },
    });
    const geometry = await this.geometryStore.put(
      { kind: "line", coordinates: input.coordinates.map((coordinate) => ({ ...coordinate })) },
      { kind: "recording", now: savedAt },
    );
    const recordedTrack: RecordedTrackEnvelope = {
      recordingId: input.recordingId,
      geometryRef: geometry.geometryRef,
      timestamps: [...input.timestamps],
      summary: input.summary,
    };
    await this.repository.saveLibraryRide(document, {
      writerToken: `recording-${input.recordingId}`,
      savedAt,
      derivedFrom: { kind: "recorded", sourceId: input.recordingId },
      bundleSummary: {
        distanceMeters: input.summary.distanceMeters,
        durationSeconds: input.summary.movingSeconds,
      },
      recordedTrack,
    });
    return { rideId, savedAt, summary: input.summary };
  }

  async findRecorded(recordingId: RecordingId): Promise<SavedRecordedRide | null> {
    const rideId = (`ride_${recordingId}`) as RideId;
    const record = await this.repository.loadRideRecord(rideId);
    if (
      record === null ||
      record.savedAt === undefined ||
      record.recordedTrack?.recordingId !== recordingId
    ) {
      return null;
    }
    return { rideId, savedAt: record.savedAt, summary: record.recordedTrack.summary };
  }

  async listRides(filter: RideListFilter = {}): Promise<readonly RideSummary[]> {
    const records = await this.repository.listRideRecords();
    const summaries = await Promise.all(
      records
        .filter((record) => matches(record, filter))
        .map(async (record): Promise<RideSummary> => {
          const item = await this.withMapPreview(record, summary(record));
          if (record.recordedTrack === undefined || this.geometryStore === undefined) return item;
          const stored = await this.geometryStore.get(record.recordedTrack.geometryRef);
          const coordinates =
            stored !== null && stored.payload.kind === "line" ? stored.payload.coordinates : [];
          return {
            ...item,
            mapPreview: { line: previewLine(coordinates), pins: [] },
            recordedTrack: {
              summary: record.recordedTrack.summary,
              previewGeometry: previewLine(coordinates),
            },
          };
        }),
    );
    return summaries.sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.rideId.localeCompare(a.rideId),
    );
  }

  async listExploreRides(): Promise<readonly LibraryExploreRide[]> {
    const records = await this.repository.listRideRecords();
    const savedRecords = records.filter((record) => record.savedAt !== undefined);
    return Promise.all(savedRecords.map(async (record): Promise<LibraryExploreRide> => ({
      summary: summary(record),
      document: record.document,
      geometry: await this.exploreGeometry(record),
      ...(record.recordedTrack === undefined ? {} : { riddenAt: record.recordedTrack.timestamps.at(-1) }),
    })));
  }

  async renameRide(rideId: RideId, title: string): Promise<void> {
    const record = await this.repository.loadRideRecord(rideId);
    if (record === null || record.savedAt === undefined) throw new Error("Ride not found");
    const renamed = updatedTitle(record.document, requiredTitle(title), this.now());
    await this.repository.saveLibraryRide(renamed, {
      writerToken: `library-${crypto.randomUUID()}`,
      savedAt: record.savedAt,
      ...(record.derivedFrom === undefined ? {} : { derivedFrom: record.derivedFrom }),
      ...(record.uniqueKey === undefined ? {} : { uniqueKey: record.uniqueKey }),
      ...(record.originalsRef === undefined ? {} : { originalsRef: record.originalsRef }),
      ...(record.area === undefined ? {} : { area: record.area }),
      ...(record.bundleSummary === undefined ? {} : { bundleSummary: record.bundleSummary }),
      ...(record.recordedTrack === undefined ? {} : { recordedTrack: record.recordedTrack }),
      ...(record.freeRideSummary === undefined ? {} : { freeRideSummary: record.freeRideSummary }),
      ...(record.offlinePack === undefined ? {} : { offlinePack: record.offlinePack }),
      ...(record.importData === undefined ? {} : { importData: record.importData }),
      ...(record.plannedRoute === undefined ? {} : { plannedRoute: record.plannedRoute }),
    });
  }

  async deleteRide(rideId: RideId): Promise<void> {
    const record = await this.repository.loadRideRecord(rideId);
    if (record === null || record.savedAt === undefined) throw new Error("Ride not found");
    if (record.document.provenance.type === "catalog" && record.derivedFrom === undefined) {
      throw new Error("Catalog source rides cannot be deleted");
    }
    await this.repository.deleteRide(rideId);
  }

  async createDerivative(
    sourceKind: LibrarySourceKind,
    sourceId: string,
    document: RideDocument,
    options: CreateDerivativeOptions = {},
  ): Promise<RideDocument> {
    const now = this.now();
    const provenance: RideProvenance =
      sourceKind === "ride"
        ? { type: "derived", sourceId }
        : { type: sourceKind, sourceId };
    const derivative = withIdentity(document, {
      rideId: newRideId(),
      now,
      title: options.title ?? null,
      provenance,
    });
    const result = await this.repository.saveRide(derivative, {
      writerToken: `library-derivative-${crypto.randomUUID()}`,
    });
    if (!result.ok) throw new Error("Could not create ride derivative");
    return derivative;
  }

  /** An import's first stored segment, else the ride's authored points. */
  private async withMapPreview(record: RideRecord, item: RideSummary): Promise<RideSummary> {
    const segment = record.importData?.tracks[0]?.segments[0];
    if (segment !== undefined && this.geometryStore !== undefined) {
      const stored = await this.geometryStore.get(segment.geometryRef).catch(() => null);
      if (stored !== null && stored.payload.kind === "line" && stored.payload.coordinates.length >= 2) {
        return { ...item, mapPreview: { line: previewLine(stored.payload.coordinates), pins: [] } };
      }
    }
    const acceptedRef = record.freeRideSummary?.acceptedGeometryRefs[0];
    if (acceptedRef !== undefined && this.geometryStore !== undefined) {
      const stored = await this.geometryStore.get(acceptedRef);
      if (stored?.payload.kind === "line") return { ...item, mapPreview: { line: previewLine(stored.payload.coordinates), pins: [] } };
    }
    if (record.plannedRoute !== undefined && this.geometryStore !== undefined) {
      const stored = await this.geometryStore.get(record.plannedRoute.geometryRef).catch(() => null);
      if (stored !== null && stored.payload.kind === "line" && stored.payload.coordinates.length >= 2) {
        return { ...item, mapPreview: { line: previewLine(stored.payload.coordinates), pins: [] } };
      }
    }
    if (record.freeRideSummary !== undefined) return item;
    const intent = record.document.intent;
    const pins = [intent.start, ...intent.stops, intent.finish]
      .filter((point) => point !== null)
      .map((point) => point.coordinate);
    return pins.length === 0 ? item : { ...item, mapPreview: { line: [], pins } };
  }

  private async exploreGeometry(record: RideRecord): Promise<readonly Coordinate[]> {
    if (this.geometryStore === undefined) return [];

    // A recorded ride is the rider's strongest local history signal. Prefer its
    // full trace over any import-derived geometry on the same library record.
    if (record.recordedTrack !== undefined) {
      const stored = await this.geometryStore.get(record.recordedTrack.geometryRef);
      if (stored !== null && stored.payload.kind === "line") return stored.payload.coordinates;
    }

    const importData = record.importData;
    const firstTrack = importData?.tracks.length === 1 ? importData.tracks[0] : undefined;
    const segment = firstTrack?.segments.length === 1 ? firstTrack.segments[0] : undefined;
    if (segment === undefined) return [];
    const stored = await this.geometryStore.get(segment.geometryRef);
    return stored?.payload.kind === "line" ? stored.payload.coordinates : [];
  }

  async openRide(rideId: RideId): Promise<RideDocument> {
    const record = await this.repository.loadRideRecord(rideId);
    if (record === null || record.savedAt === undefined) throw new Error("Ride not found");
    // The opened working copy keeps the saved ride's name, so the planner can say what is open (RS-08).
    return this.createDerivative("ride", rideId, record.document, { title: record.document.title });
  }

  /**
   * Open a saved ride as the line it was saved with (R3-1, "saved means exact").
   *
   * A ride saved from the planner reopens on its stored line with the card's own
   * numbers and measured facts; an imported track reopens on its own track.
   * Nothing here asks a router. What still has to be planned:
   *
   * - a breadcrumb, which the planner draws from its own points;
   * - an import the rider asked to be routed along roads (it has shaping);
   * - a planned ride saved before lines were kept (`lineMissing`).
   */
  async openSavedRide(rideId: RideId): Promise<OpenedLibraryRide> {
    const record = await this.repository.loadRideRecord(rideId);
    if (record === null || record.savedAt === undefined) throw new Error("Ride not found");
    const intent = record.document.intent;
    const breadcrumb = intent.breadcrumb != null;
    const line = breadcrumb ? null : await this.savedLine(record);
    const source = line?.origin === "import" && loopEnds(line.geometry)
      ? asImportedLoop(record.document)
      : record.document;
    const document = await this.createDerivative("ride", rideId, source, { title: record.document.title });
    const lineMissing = line === null && !breadcrumb && record.importData === undefined &&
      record.recordedTrack === undefined && record.freeRideSummary === undefined;
    return { document, line, lineMissing };
  }

  /**
   * A saved ride's own line and facts, read only (R3-7 "Keep for no signal").
   * `null` for a ride with no stored line: there is nothing exact to keep.
   */
  async savedRideLine(rideId: RideId): Promise<{ readonly title: string; readonly line: SavedRideLine } | null> {
    const record = await this.repository.loadRideRecord(rideId);
    if (record === null || record.savedAt === undefined || record.document.intent.breadcrumb != null) return null;
    const line = await this.savedLine(record);
    return line === null ? null : { title: record.document.title ?? "Saved ride", line };
  }

  private async readLine(ref: GeometryRef): Promise<readonly Coordinate[] | null> {
    if (this.geometryStore === undefined) return null;
    const stored = await this.geometryStore.get(ref).catch(() => null);
    if (stored === null || stored.payload.kind !== "line" || stored.payload.coordinates.length < 2) return null;
    return stored.payload.coordinates;
  }

  private async savedLine(record: RideRecord): Promise<SavedRideLine | null> {
    const importData = record.importData;
    if (importData !== undefined) {
      // "Route along roads" asked the planner for a new road route; that ask stands.
      if (record.document.intent.shaping.length > 0) return null;
      const coordinates: Coordinate[] = [];
      for (const track of importData.tracks) {
        for (const segment of track.segments) {
          const part = await this.readLine(segment.geometryRef);
          if (part === null) return null;
          coordinates.push(...part);
        }
      }
      if (coordinates.length < 2) return null;
      const distanceMeters = finitePositive(record.bundleSummary?.distanceMeters)
        ? record.bundleSummary.distanceMeters
        : lineDistance(coordinates);
      if (!finitePositive(distanceMeters)) return null;
      return {
        origin: "import",
        geometry: coordinates,
        distanceMeters,
        durationSeconds: finitePositive(record.bundleSummary?.durationSeconds) ? record.bundleSummary.durationSeconds : null,
        evidence: {},
      };
    }
    const planned = record.plannedRoute;
    if (planned === undefined) return null;
    const geometry = await this.readLine(planned.geometryRef);
    if (geometry === null) return null;
    // The card's own numbers, else the library card's, else the line itself.
    const distanceMeters = finitePositive(planned.distanceMeters)
      ? planned.distanceMeters
      : finitePositive(record.bundleSummary?.distanceMeters)
      ? record.bundleSummary.distanceMeters
      : lineDistance(geometry);
    if (!finitePositive(distanceMeters)) return null;
    const durationSeconds = finitePositive(planned.durationSeconds)
      ? planned.durationSeconds
      : finitePositive(record.bundleSummary?.durationSeconds)
      ? record.bundleSummary.durationSeconds
      : null;
    return {
      origin: "saved",
      geometry,
      distanceMeters,
      durationSeconds,
      evidence: planned.evidence ?? {},
      ...(planned.instructions === undefined ? {} : { instructions: planned.instructions }),
    };
  }

  async loadExportSource(rideId: RideId): Promise<RideExportSource> {
    const record = await this.repository.loadRideRecord(rideId);
    if (record === null || record.savedAt === undefined) throw new Error("Ride not found");
    const importData = record.importData;
    const trackGeometry: Record<string, readonly Coordinate[]> = {};
    const hasTrackGeometry = importData?.tracks.some((track) => track.segments.length > 0) ?? false;
    if (hasTrackGeometry && this.geometryStore === undefined) {
      throw new Error("Imported ride geometry storage is unavailable.");
    }
    if (record.originalsRef !== undefined && this.blobStore === undefined) {
      throw new Error("The original import file storage is unavailable.");
    }
    if (importData !== undefined && this.geometryStore !== undefined) {
      for (const track of importData.tracks) {
        for (const segment of track.segments) {
          const geometry = await this.geometryStore.get(segment.geometryRef);
          if (geometry === null || geometry.payload.kind !== "line") {
            throw new Error(`Imported track geometry ${segment.geometryRef} is unavailable.`);
          }
          trackGeometry[segment.geometryRef] = geometry.payload.coordinates;
        }
      }
    }
    const documentWaypoints = waypointsFromIntent(record.document.intent);
    const waypoints: ExportWaypoint[] = importData?.waypoints.map((waypoint) => ({
        name: waypoint.name?.trim() || null,
        coordinate: waypoint.coordinate,
      })) ?? [];
    const routeWaypoints = [...waypoints, ...documentWaypoints];
    // The line the rider selected at save time wins over an import's single
    // track: it is the geometry they actually saw on the map.
    let plannedCoordinates: readonly Coordinate[] | null = null;
    if (record.plannedRoute !== undefined) {
      if (this.geometryStore === undefined) throw new Error("Planned route geometry storage is unavailable.");
      const stored = await this.geometryStore.get(record.plannedRoute.geometryRef);
      if (stored === null || stored.payload.kind !== "line") {
        throw new Error("The planned route geometry is unavailable.");
      }
      plannedCoordinates = stored.payload.coordinates;
    } else {
      const firstTrack = importData?.tracks.length === 1 ? importData.tracks[0] : undefined;
      const plannedSegment = firstTrack?.segments.length === 1 ? firstTrack.segments[0] : undefined;
      plannedCoordinates = plannedSegment === undefined ? null : trackGeometry[plannedSegment.geometryRef] ?? null;
    }
    const originalRecord = record.originalsRef === undefined || this.blobStore === undefined
      ? null
      : await this.blobStore.get(record.originalsRef as GeometryRef);
    let recordedTrack: RideExportSource["recordedTrack"] = null;
    if (record.recordedTrack !== undefined) {
      const geometry = await this.geometryStore?.get(record.recordedTrack.geometryRef);
      if (geometry === null || geometry === undefined || geometry.payload.kind !== "line") {
        throw new Error("The recorded ride geometry is unavailable.");
      }
      recordedTrack = {
        coordinates: geometry.payload.coordinates,
        timestamps: record.recordedTrack.timestamps,
        summary: record.recordedTrack.summary,
      };
    }
    return {
      title: record.document.title ?? "Ride",
      createdTime: record.document.createdAt,
      plannedRoute: plannedCoordinates === null ? null : { geometry: plannedCoordinates, waypoints: routeWaypoints },
      tracks: importData?.tracks ?? [],
      trackGeometry,
      waypoints,
      originalBytes: originalRecord === null ? null : importBlobBytes(originalRecord),
      originalFilename: originalRecord?.filename ?? null,
      originalMime: originalRecord?.mime ?? null,
      recordedTrack,
    };
  }
}

function loopEnds(geometry: readonly Coordinate[]): boolean {
  const first = geometry[0];
  const last = geometry.at(-1);
  if (first === undefined || last === undefined || geometry.length < 3) return false;
  return lineDistance([first, last]) <= LOOP_ENDS_METERS;
}

/**
 * An imported track whose ends meet is a loop from its start, not a ride "to"
 * the place it began (R3-1): the working copy says so, so the planner names it
 * "Loop from <place>".
 */
function asImportedLoop(document: RideDocument): RideDocument {
  if (document.intent.start === null) return document;
  const intent = deepFreeze<RideIntent>({ ...document.intent, shape: "loop", finish: null });
  return deepFreeze<RideDocument>({ ...document, intent, history: { ...document.history, baseIntent: intent } });
}

export function createLibraryService(
  repository: LibraryRepository,
  options: LibraryServiceOptions = {},
): LibraryService {
  return new LibraryService(repository, options);
}
