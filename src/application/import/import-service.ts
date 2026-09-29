import type { GeometryStore } from "@/application/geometry/geometry-store";
import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import { UniqueRideAlreadyExistsError, type LibraryServicePort, type NamedRide } from "@/application/library/library-service";
import {
  createImportArtifactFromBytes,
  importToRideDocument,
  sha256Hex,
  selectImportTracks,
  areImportTracksJoinable,
  type ImportArtifact,
  type ImportFile,
  type ImportBlobStore,
  type ImportToRideOptions,
  ImportOptionNotImplementedError,
  ImportSelectionRequiredError,
  importTrackSummary,
} from "./import-artifact";
import { MAX_FILE_BYTES } from "./limits";
import {
  ImportCancelledError,
  ImportSecurityError,
  throwIfImportCancelled,
  type ImportProgress,
  type ImportRideData,
  type ImportedTrackData,
  type ParsedImport,
  type ParsedImportTrack,
} from "./types";
import type { GeometryRef } from "@/domain/ride/ids";
import { switchBackImportReport, switchBackTrackToRideDocument } from "./switchback-import";

export type ImportFlowErrorCode =
  | "invalid-file"
  | "too-large"
  | "archive-guard"
  | "malformed-xml"
  | "no-usable-geometry"
  | "selection-required"
  | "unsupported-source-shape"
  | "option-unavailable"
  | "read-failed"
  | "persist-failed";

/** A stable, rider-facing import taxonomy. The original error is not exposed. */
export class ImportFlowError extends Error {
  readonly code: ImportFlowErrorCode;
  readonly reason: string;
  readonly title: string | null;

  constructor(code: ImportFlowErrorCode, reason: string, title: string | null = null) {
    super(reason);
    this.name = "ImportFlowError";
    this.code = code;
    this.reason = reason;
    this.title = title;
  }
}

class AlreadyImportedContentError extends Error {
  readonly title: string | null;

  constructor(title: string | null) {
    super("A SwitchBack GPX with the same content was already imported.");
    this.name = "AlreadyImportedContentError";
    this.title = title;
  }
}

export interface SwitchBackImportFileReport {
  readonly filename: string;
  readonly title: string;
  readonly status: "imported" | "already-imported" | "skipped";
  readonly reason: string | null;
  /** Notes remain attached to the ride whose intent they describe. */
  readonly warnings: readonly string[];
}

export interface SwitchBackImportBatchReport {
  readonly totalCount: number;
  readonly importedCount: number;
  readonly files: readonly SwitchBackImportFileReport[];
}

export interface ImportParserPort {
  parse(
    bytes: ArrayBuffer,
    filename: string,
    options?: {
      readonly signal?: AbortSignal;
      readonly onProgress?: (progress: ImportProgress) => void;
    },
  ): Promise<ParsedImport>;
}

export interface ImportPreview {
  readonly parsed: ParsedImport;
  readonly sizeBytes: number;
}

export interface ImportSelectionDecision {
  readonly canCombine: boolean;
  readonly reason: string | null;
}

export interface ImportFileOptions {
  readonly source?: "SwitchBack";
  readonly trackRoute?: ImportToRideOptions["trackRoute"];
  readonly trackIndex?: number;
  readonly trackIndices?: readonly number[];
  readonly combine?: boolean;
  readonly importSeparately?: boolean;
  readonly gapToleranceMeters?: number;
  readonly now?: string;
  readonly title?: string | null;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ImportProgress) => void;
}

export interface ImportOutcome {
  readonly artifact: ImportArtifact;
  readonly parsed: ParsedImport;
  readonly importData: ImportRideData;
  readonly documents: readonly ReturnType<typeof importToRideDocument>[];
  readonly namedRides: readonly NamedRide[];
  readonly document: ReturnType<typeof importToRideDocument>;
  readonly namedRide: NamedRide;
  readonly warnings: readonly string[];
}

export interface ImportServiceDependencies {
  readonly blobStore: ImportBlobStore;
  readonly geometryStore?: GeometryStore;
  readonly libraryService: LibraryServicePort;
  readonly parse: ImportParserPort;
  readonly now?: () => string;
}

const SUPPORTED_EXTENSIONS = new Set(["gpx", "kml", "kmz"]);
const SUPPORTED_MIME_TYPES = new Set([
  "application/gpx+xml",
  "application/vnd.google-earth.kml+xml",
  "application/vnd.google-earth.kmz",
  "application/zip",
  "application/xml",
  "text/xml",
  "text/plain",
  "application/octet-stream",
]);

function validateSwitchBackShape(file: ImportFile, parsed: ParsedImport): ParsedImportTrack {
  if (extensionFor(file.name) !== "gpx") {
    throw new ImportFlowError("unsupported-source-shape", "Choose a SwitchBack GPX Track or Track + Waypoints export. KML and KMZ are not SwitchBack saved-ride exports.", parsed.tracks[0]?.name.trim() || null);
  }
  const track = parsed.tracks[0];
  if (
    parsed.tracks.length !== 1 ||
    track?.sourceKind !== "track" ||
    track.segments.length !== 1 ||
    (track.segments[0]?.length ?? 0) < 2
  ) {
    throw new ImportFlowError("unsupported-source-shape", "This GPX does not contain one dense SwitchBack route track. Export Track or Track + Waypoints; route and cue exports contain no saved route line.", track?.name.trim() || null);
  }
  return track;
}

function extensionFor(filename: string): string {
  return filename.toLowerCase().split(".").at(-1) ?? "";
}

function validateFile(file: ImportFile): void {
  const extension = extensionFor(file.name);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new ImportFlowError("invalid-file", "Choose a GPX, KML, or KMZ file with a supported extension.");
  }
  const mime = file.type?.trim().toLowerCase().split(";", 1)[0]?.trim() ?? "";
  if (mime !== "" && !SUPPORTED_MIME_TYPES.has(mime)) {
    throw new ImportFlowError("invalid-file", `The file MIME type "${mime}" is not supported for ${extension.toUpperCase()} imports.`);
  }
  if (file.name.trim() === "") {
    throw new ImportFlowError("invalid-file", "The import file needs a filename.");
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) {
    throw new ImportFlowError("too-large", `This file is larger than the ${MAX_FILE_BYTES / (1024 * 1024)} MB import limit.`);
  }
}

function classifyImportError(error: unknown, filename: string): ImportFlowError | ImportCancelledError {
  if (error instanceof ImportCancelledError) return error;
  if (error instanceof ImportFlowError) return error;
  if (error instanceof ImportOptionNotImplementedError) return new ImportFlowError("option-unavailable", error.message);
  if (error instanceof ImportSelectionRequiredError) return new ImportFlowError("selection-required", error.message);
  const message = error instanceof Error ? error.message : "The route file could not be imported.";
  const extension = extensionFor(filename);
  if (error instanceof ImportSecurityError && extension === "kmz") return new ImportFlowError("archive-guard", message);
  if (error instanceof ImportSecurityError) return new ImportFlowError("malformed-xml", message);
  if (/limit|larger than|10 MB|file size/i.test(message)) return new ImportFlowError("too-large", message);
  if (/no (?:valid |usable )?(?:track|route|line|string|geometry)|contains no|fewer than two/i.test(message)) {
    return new ImportFlowError("no-usable-geometry", message);
  }
  if (/malformed|utf-8|xml|root|coordinate/i.test(message)) return new ImportFlowError("malformed-xml", message);
  return new ImportFlowError("persist-failed", message);
}

async function readFile(file: ImportFile, signal: AbortSignal | undefined): Promise<ArrayBuffer> {
  validateFile(file);
  throwIfImportCancelled(signal);
  let result: ArrayBuffer;
  try {
    result = await file.arrayBuffer();
  } catch {
    throw new ImportFlowError("read-failed", "The file could not be read. Check that it is still available and try again.");
  }
  throwIfImportCancelled(signal);
  if (result.byteLength !== file.size) {
    throw new ImportFlowError("read-failed", "The file changed while it was being read. Choose it again.");
  }
  if (result.byteLength > MAX_FILE_BYTES) {
    throw new ImportFlowError("too-large", `This file is larger than the ${MAX_FILE_BYTES / (1024 * 1024)} MB import limit.`);
  }
  return result;
}

function pointsInTrack(track: ParsedImportTrack): number {
  return track.segments.reduce((total, segment) => total + segment.length, 0);
}

async function persistTrackData(
  tracks: readonly ParsedImportTrack[],
  geometryStore: GeometryStore,
  signal: AbortSignal | undefined,
  now: string,
  refs: GeometryRef[],
): Promise<readonly ImportedTrackData[]> {
  const output: ImportedTrackData[] = [];
  for (const track of tracks) {
    const segments = [];
    for (const [index, coordinates] of track.segments.entries()) {
      throwIfImportCancelled(signal);
      const record = await geometryStore.put(
        { kind: "line", coordinates },
        { kind: "import-track", now },
      );
      refs.push(record.geometryRef);
      throwIfImportCancelled(signal);
      segments.push({
        geometryRef: record.geometryRef,
        timestamps: track.timestamps[index] ?? coordinates.map(() => null),
        elevation: track.elevation[index] ?? coordinates.map(() => null),
      });
    }
    output.push({ name: track.name, segments });
  }
  return output;
}

function selectedIndices(parsed: ParsedImport, options: ImportFileOptions): readonly number[] {
  if (options.trackIndices !== undefined) {
    if (options.trackIndices.length === 0) throw new ImportSelectionRequiredError();
    return options.trackIndices;
  }
  if (options.trackIndex !== undefined) return [options.trackIndex];
  if (parsed.tracks.length === 1) return [0];
  throw new ImportSelectionRequiredError();
}

function documentOptions(
  options: ImportFileOptions,
  index: number,
  combine: boolean,
  selected: readonly number[],
): ImportToRideOptions {
  return {
    trackRoute: options.trackRoute ?? "follow",
    ...(combine ? { combine: true, trackIndices: selected } : { trackIndices: [index] }),
    ...(options.gapToleranceMeters === undefined ? {} : { gapToleranceMeters: options.gapToleranceMeters }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.title === undefined ? {} : { title: options.title }),
  };
}

export class ImportService {
  private readonly blobStore: ImportBlobStore;
  private readonly geometryStore: GeometryStore;
  private readonly libraryService: LibraryServicePort;
  private readonly parser: ImportParserPort;
  private readonly now: () => string;

  constructor(dependencies: ImportServiceDependencies) {
    this.blobStore = dependencies.blobStore;
    this.geometryStore = dependencies.geometryStore ?? createMemoryGeometryStore();
    this.libraryService = dependencies.libraryService;
    this.parser = dependencies.parse;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  evaluateTrackSelection(
    parsed: ParsedImport,
    trackIndices: readonly number[],
    gapToleranceMeters: number,
  ): ImportSelectionDecision {
    if (trackIndices.length < 2) return { canCombine: false, reason: "Select at least two tracks to combine them into one ride." };
    const tracks = trackIndices.map((index) => parsed.tracks[index]);
    if (tracks.some((track) => track === undefined)) return { canCombine: false, reason: "The selected track is no longer available." };
    if (!areImportTracksJoinable(tracks as readonly ParsedImportTrack[], gapToleranceMeters)) {
      return { canCombine: false, reason: "Only adjacent selected tracks within the gap tolerance can be one ride." };
    }
    return { canCombine: true, reason: null };
  }

  async previewFile(file: ImportFile, options: Pick<ImportFileOptions, "signal" | "onProgress"> = {}): Promise<ImportPreview> {
    let bytes: ArrayBuffer;
    try {
      bytes = await readFile(file, options.signal);
      const sizeBytes = bytes.byteLength;
      const parsed = await this.parser.parse(bytes, file.name, options);
      throwIfImportCancelled(options.signal);
      if (parsed.tracks.length === 0) throw new ImportFlowError("no-usable-geometry", "The file has no usable track geometry.");
      return { parsed, sizeBytes };
    } catch (error: unknown) {
      throw classifyImportError(error, file.name);
    }
  }

  async importFile(file: ImportFile, options: ImportFileOptions = {}): Promise<ImportOutcome> {
    let parsed: ParsedImport;
    let bytes: ArrayBuffer;
    let sourceContentHash: string | undefined;
    const refs: GeometryRef[] = [];
    let artifact: ImportArtifact | null = null;
    const savedRides: NamedRide[] = [];
    try {
      bytes = await readFile(file, options.signal);
      // Worker parsers transfer their input buffer, which detaches it in the
      // caller. Keep the exact source bytes on this side of that boundary for
      // artifact persistence and original-file export.
      const sourceBytes = new Uint8Array(bytes.slice(0));
      if (options.source === "SwitchBack") {
        sourceContentHash = await sha256Hex(sourceBytes);
        const existing = await this.libraryService.findImportedContentHash(sourceContentHash);
        if (existing !== null) throw new AlreadyImportedContentError(existing.title);
      }
      parsed = await this.parser.parse(bytes, file.name, options);
      throwIfImportCancelled(options.signal);
      if (parsed.tracks.length === 0) throw new ImportFlowError("no-usable-geometry", "The file has no usable track geometry.");

      const switchBackTrack = options.source === "SwitchBack" ? validateSwitchBackShape(file, parsed) : undefined;

      const selected = switchBackTrack === undefined ? selectedIndices(parsed, options) : [0];
      const trackOptions: ImportToRideOptions = {
        trackRoute: options.trackRoute ?? "follow",
        trackIndices: selected,
        ...(options.combine === true ? { combine: true } : {}),
        ...(options.gapToleranceMeters === undefined ? {} : { gapToleranceMeters: options.gapToleranceMeters }),
      };
      const tracks = switchBackTrack !== undefined
        ? [switchBackTrack]
        : options.importSeparately === true
        ? selected.map((index) => {
            const track = parsed.tracks[index];
            if (track === undefined) throw new ImportFlowError("no-usable-geometry", "The selected imported track does not exist.");
            return track;
          })
        : selectImportTracks(parsed, trackOptions);
      const selectedSet = new Set(selected);
      if (tracks.length !== selectedSet.size) throw new ImportFlowError("no-usable-geometry", "The selected imported tracks are not valid.");

      artifact = await createImportArtifactFromBytes(file, sourceBytes, parsed, {
        blobStore: this.blobStore,
        now: options.now ?? this.now(),
      });
      throwIfImportCancelled(options.signal);
      const importTracks = await persistTrackData(tracks, this.geometryStore, options.signal, artifact.importedAt, refs);
      throwIfImportCancelled(options.signal);
      const importData: ImportRideData = {
        originalRef: artifact.originalRef,
        ...(sourceContentHash === undefined ? {} : { sourceContentHash }),
        tracks: importTracks,
        waypoints: parsed.waypoints ?? [],
      };
      const warnings: readonly string[] = switchBackTrack !== undefined
        ? [...parsed.warnings, ...switchBackImportReport(parsed)]
        : options.trackRoute === "route-along"
        ? [...parsed.warnings, "Route along roads used bounded imported anchors; the planned road route may deviate from the original track."]
        : parsed.warnings;
      const combine = options.combine === true;
      const indexes = options.importSeparately === true ? selected : [selected[0]!];
      if (options.importSeparately !== true && indexes[0] === undefined) throw new ImportFlowError("no-usable-geometry", "Choose at least one imported track.");
      for (const index of indexes) {
        throwIfImportCancelled(options.signal);
        const document = switchBackTrack !== undefined
          ? switchBackTrackToRideDocument(
              artifact,
              switchBackTrack,
              parsed.waypoints ?? [],
              { title: options.title ?? switchBackTrack.name, now: artifact.importedAt },
            )
          : importToRideDocument(artifact, parsed, documentOptions(options, index, combine, selected));
        throwIfImportCancelled(options.signal);
        const metadata: ImportRideData = {
          ...importData,
          tracks: options.importSeparately === true
            ? importTracks.filter((_, trackIndex) => trackIndex === selected.indexOf(index))
            : importTracks,
        };
        const savedTracks = options.importSeparately === true
          ? tracks.filter((_, trackIndex) => trackIndex === selected.indexOf(index))
          : tracks;
        const named = await this.libraryService.saveNamed(document, {
          title: document.title ?? `Imported ${file.name.replace(/\.(?:gpx|kml|kmz)$/i, "")}`,
          originalsRef: artifact.originalRef,
          ...(sourceContentHash === undefined ? {} : { uniqueKey: `switchback-import:${sourceContentHash}` }),
          importData: warnings.length === 0 ? metadata : { ...metadata, warnings },
          bundleSummary: importTrackSummary(savedTracks),
        });
        savedRides.push(named);
        throwIfImportCancelled(options.signal);
      }
      const first = savedRides[0];
      if (first === undefined || artifact === null) throw new Error("The import did not create a ride.");
      return {
        artifact,
        parsed,
        importData: {
          originalRef: artifact.originalRef,
          ...(sourceContentHash === undefined ? {} : { sourceContentHash }),
          tracks: options.importSeparately === true
            ? importTracks.filter((_, index) => index === selected.indexOf(selected[0]!))
            : importTracks,
          waypoints: parsed.waypoints ?? [],
        },
        documents: savedRides.map((ride) => ride.document),
        namedRides: savedRides,
        document: first.document,
        namedRide: first,
        warnings,
      };
    } catch (error: unknown) {
      const rollbackFailures: string[] = [];
      for (const ride of savedRides) {
        try {
          await this.libraryService.deleteRide(ride.document.rideId);
        } catch (rollbackError: unknown) {
          rollbackFailures.push(`ride ${ride.document.rideId}: ${rollbackError instanceof Error ? rollbackError.message : "delete failed"}`);
        }
      }
      for (const ref of refs) {
        try {
          await this.geometryStore.remove(ref);
        } catch (rollbackError: unknown) {
          rollbackFailures.push(`geometry ${ref}: ${rollbackError instanceof Error ? rollbackError.message : "delete failed"}`);
        }
      }
      if (artifact !== null && this.blobStore.remove !== undefined) {
        try {
          await this.blobStore.remove(artifact.originalRef);
        } catch (rollbackError: unknown) {
          rollbackFailures.push(`original ${artifact.originalRef}: ${rollbackError instanceof Error ? rollbackError.message : "delete failed"}`);
        }
      }
      const classified = classifyImportError(error, file.name);
      if (rollbackFailures.length === 0) {
        if (error instanceof AlreadyImportedContentError) throw error;
        if (error instanceof UniqueRideAlreadyExistsError && sourceContentHash !== undefined) {
          throw new AlreadyImportedContentError(error.title);
        }
        throw classified;
      }
      const residue = `Import cleanup failed (${rollbackFailures.join("; ")}). Partial data may remain and should be removed before retrying.`;
      if (classified instanceof ImportFlowError) throw new ImportFlowError(classified.code, `${classified.reason} ${residue}`, classified.title);
      throw new ImportFlowError("persist-failed", `${classified.message} ${residue}`);
    }
  }

  /** Imports every selected SwitchBack file in order, isolating failures by file. */
  async importSwitchBackBatch(
    files: readonly ImportFile[],
    options: Pick<ImportFileOptions, "signal" | "onProgress"> = {},
  ): Promise<SwitchBackImportBatchReport> {
    const reports: SwitchBackImportFileReport[] = [];
    let importedCount = 0;
    for (const file of files) {
      const fallbackTitle = file.name.replace(/\.[^.]*$/, "").trim() || "SwitchBack ride";
      try {
        const outcome = await this.importFile(file, { ...options, source: "SwitchBack" });
        const title = outcome.document.title ?? fallbackTitle;
        importedCount += 1;
        reports.push({
          filename: file.name,
          title,
          status: "imported",
          reason: null,
          warnings: outcome.warnings,
        });
      } catch (caught: unknown) {
        if (caught instanceof AlreadyImportedContentError) {
          reports.push({
            filename: file.name,
            title: caught.title ?? fallbackTitle,
            status: "already-imported",
            reason: caught.message,
            warnings: [],
          });
          continue;
        }
        const classified = classifyImportError(caught, file.name);
        reports.push({
          filename: file.name,
          title: classified instanceof ImportFlowError && classified.title !== null
            ? classified.title
            : fallbackTitle,
          status: "skipped",
          reason: classified instanceof ImportCancelledError
            ? "Import was cancelled."
            : classified.reason,
          warnings: [],
        });
      }
    }
    return { totalCount: reports.length, importedCount, files: reports };
  }
}

export interface ImportServicePort {
  readonly previewFile: ImportService["previewFile"];
  readonly importFile: ImportService["importFile"];
  readonly importSwitchBackBatch: ImportService["importSwitchBackBatch"];
  readonly evaluateTrackSelection: ImportService["evaluateTrackSelection"];
}

export function createImportService(dependencies: ImportServiceDependencies): ImportService {
  return new ImportService(dependencies);
}

/** Functional seam for callers that prefer not to retain a service object. */
export async function importFile(
  file: ImportFile,
  options: ImportFileOptions,
  dependencies: ImportServiceDependencies,
): Promise<ImportOutcome> {
  return createImportService(dependencies).importFile(file, options);
}

export function pointsForImportTrack(track: ParsedImportTrack): number {
  return pointsInTrack(track);
}
