import { MAX_FILE_BYTES } from "./limits";
import type { GeometryRef } from "@/domain/ride/ids";
import { newGeometryRef, newPointId, newShapingId } from "@/domain/ride/ids";
import { createRideDocument } from "@/domain/ride/create";
import type { Coordinate, RideDocument, RidePoint, ShapingPoint } from "@/domain/ride/types";
import { deepFreeze } from "@/domain/util/freeze";
import type { ParsedImport, ParsedImportTrack } from "./types";

export { ImportCancelledError, ImportSecurityError } from "./types";

export interface ImportFile {
  readonly name: string;
  readonly type?: string;
  readonly size: number;
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface ImportBlobRecord {
  readonly originalRef: GeometryRef;
  readonly filename: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly importedAt: string;
  readonly bytesBase64: string;
}

export interface ImportBlobStore {
  put(record: ImportBlobRecord): Promise<void>;
  get(originalRef: GeometryRef): Promise<ImportBlobRecord | null>;
  /** Best-effort rollback for an artifact that has not reached the library. */
  remove?(originalRef: GeometryRef): Promise<void>;
}

export interface ImportArtifact {
  readonly artifactId: string;
  readonly filename: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly importedAt: string;
  readonly originalRef: GeometryRef;
}

export interface CreateImportArtifactOptions {
  readonly blobStore: ImportBlobStore;
  readonly now?: string;
}

export type TrackRouteOption = "follow" | "route-along" | "sketch";

export interface ImportToRideOptions {
  readonly trackRoute?: TrackRouteOption;
  /** Required for a multi-track import unless `combine` is explicitly true. */
  readonly trackIndex?: number;
  /** Explicit source-track selection, kept in source order. */
  readonly trackIndices?: readonly number[];
  /** Explicitly retain several adjacent source tracks as separate segments. */
  readonly combine?: boolean;
  readonly gapToleranceMeters?: number;
  readonly now?: string;
  readonly title?: string | null;
}

export class ImportOptionNotImplementedError extends Error {
  readonly code = "not-implemented" as const;
  readonly option: Exclude<TrackRouteOption, "follow">;

  constructor(option: Exclude<TrackRouteOption, "follow">) {
    super(`Import option "${option}" is typed but not implemented in v1.`);
    this.name = "ImportOptionNotImplementedError";
    this.option = option;
  }
}

export class ImportSelectionRequiredError extends Error {
  readonly code = "selection-required" as const;

  constructor() {
    super("Choose one imported track, or explicitly combine adjacent tracks.");
    this.name = "ImportSelectionRequiredError";
  }
}

export function mimeForImportFile(file: ImportFile): string {
  if (file.type?.trim() !== "") return file.type!.trim();
  if (/\.kmz$/i.test(file.name)) return "application/vnd.google-earth.kmz";
  if (/\.kml$/i.test(file.name)) return "application/vnd.google-earth.kml+xml";
  if (/\.gpx$/i.test(file.name)) return "application/gpx+xml";
  return "application/octet-stream";
}

function base64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const value = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    result += alphabet[(value >>> 18) & 63] ?? "";
    result += alphabet[(value >>> 12) & 63] ?? "";
    result += second === undefined ? "=" : alphabet[(value >>> 6) & 63] ?? "";
    result += third === undefined ? "=" : alphabet[value & 63] ?? "";
  }
  return result;
}

/** Decode a stored original without using Node-only Buffer APIs. */
export function importBlobBytes(record: ImportBlobRecord): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = record.bytesBase64;
  if (!Number.isSafeInteger(record.sizeBytes) || record.sizeBytes < 0 || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error("Stored import bytes are not valid base64.");
  }
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const a = alphabet.indexOf(clean[index] ?? "=");
    const b = alphabet.indexOf(clean[index + 1] ?? "=");
    const c = alphabet.indexOf(clean[index + 2] ?? "=");
    const d = alphabet.indexOf(clean[index + 3] ?? "=");
    if (a < 0 || b < 0 || (c < 0 && d >= 0)) throw new Error("Stored import bytes are not valid base64.");
    bytes.push((a << 2) | (b >>> 4));
    if (c >= 0) bytes.push(((b & 15) << 4) | (c >>> 2));
    if (d >= 0) bytes.push(((c & 3) << 6) | d);
  }
  if (bytes.length < record.sizeBytes) throw new Error("Stored import bytes are shorter than their declared size.");
  return Uint8Array.from(bytes).slice(0, record.sizeBytes);
}

/** Stable fingerprint for duplicate detection; bytes never leave the browser. */
export async function sha256Hex(source: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", source.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function artifactId(): string {
  return `import_${globalThis.crypto.randomUUID()}`;
}

/** Persist the untouched source bytes and return its small artifact envelope. */
export async function createImportArtifact(
  file: ImportFile,
  parsed: ParsedImport,
  options: CreateImportArtifactOptions,
): Promise<ImportArtifact> {
  const source = new Uint8Array(await file.arrayBuffer());
  return createImportArtifactFromBytes(file, source, parsed, options);
}

/** Persist a bounded, already-read source without reading a File twice. */
export async function createImportArtifactFromBytes(
  file: ImportFile,
  source: Uint8Array,
  parsed: ParsedImport,
  options: CreateImportArtifactOptions,
): Promise<ImportArtifact> {
  void parsed;
  if (file.name.trim() === "" || file.name.length > 1024) {
    throw new Error("Import filenames are limited to 1,024 characters.");
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) {
    throw new RangeError(`Import files are limited to ${MAX_FILE_BYTES / (1024 * 1024)} MB.`);
  }
  if (source.byteLength !== file.size) throw new Error("The import file changed while it was being read.");
  const importedAt = options.now ?? new Date().toISOString();
  const originalRef = newGeometryRef();
  const artifact: ImportArtifact = {
    artifactId: artifactId(),
    filename: file.name,
    mime: mimeForImportFile(file),
    sizeBytes: source.byteLength,
    importedAt,
    originalRef,
  };
  await options.blobStore.put({
    originalRef,
    filename: artifact.filename,
    mime: artifact.mime,
    sizeBytes: artifact.sizeBytes,
    importedAt,
    bytesBase64: base64(source),
  });
  return deepFreeze(artifact);
}

function distanceMeters(first: Coordinate, second: Coordinate): number {
  const radians = (value: number) => value * Math.PI / 180;
  const firstLat = radians(first.lat);
  const secondLat = radians(second.lat);
  const dLat = secondLat - firstLat;
  const dLon = radians(second.lon - first.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * What the library card shows for an import: the tracks' length and, when the
 * file carries timestamps, the time from first to last point.
 */
export function importTrackSummary(
  tracks: readonly ParsedImportTrack[],
): { readonly distanceMeters: number; readonly durationSeconds?: number } {
  let meters = 0;
  const times: number[] = [];
  for (const track of tracks) {
    for (const segment of track.segments) {
      for (let index = 1; index < segment.length; index += 1) meters += distanceMeters(segment[index - 1]!, segment[index]!);
    }
    for (const value of track.timestamps.flat()) {
      const time = value === null ? Number.NaN : Date.parse(value);
      if (Number.isFinite(time)) times.push(time);
    }
  }
  const first = times.length < 2 ? undefined : times[0];
  const last = times.at(-1);
  const seconds = first === undefined || last === undefined || last < first ? undefined : (last - first) / 1000;
  return { distanceMeters: meters, ...(seconds === undefined ? {} : { durationSeconds: seconds }) };
}

function firstPoint(track: ParsedImportTrack): Coordinate | null {
  return track.segments[0]?.[0] ?? null;
}

function lastPoint(track: ParsedImportTrack): Coordinate | null {
  const segment = track.segments.at(-1);
  return segment?.at(-1) ?? null;
}

export function selectImportTracks(parsed: ParsedImport, options: ImportToRideOptions): readonly ParsedImportTrack[] {
  if (parsed.tracks.length === 0) throw new Error("The import has no tracks that can become a ride.");
  if (options.combine === true) {
    const selectedIndices = options.trackIndices !== undefined
      ? options.trackIndices
      : options.trackIndex === undefined
      ? parsed.tracks.map((_, index) => index)
      : [options.trackIndex];
    if (selectedIndices.length === 0) throw new ImportSelectionRequiredError();
    if (new Set(selectedIndices).size !== selectedIndices.length || selectedIndices.some((index) => !Number.isSafeInteger(index) || index < 0)) {
      throw new RangeError("The selected import tracks are not valid.");
    }
    const selected = selectedIndices.map((index) => parsed.tracks[index]);
    if (selected.some((track) => track === undefined)) throw new RangeError("The selected import track does not exist.");
    const tracks = selected as readonly ParsedImportTrack[];
    const tolerance = options.gapToleranceMeters ?? 25;
    if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError("gapToleranceMeters must be finite and non-negative.");
    for (let index = 1; index < tracks.length; index += 1) {
      const previous = lastPoint(tracks[index - 1]!);
      const next = firstPoint(tracks[index]!);
      if (previous === null || next === null || distanceMeters(previous, next) > tolerance) {
        throw new Error("The selected tracks are not adjacent within the gap tolerance; no connector was created.");
      }
    }
    return tracks;
  }
  if (options.trackIndices !== undefined) {
    if (options.trackIndices.length !== 1) throw new ImportSelectionRequiredError();
    const index = options.trackIndices[0];
    if (index === undefined) throw new ImportSelectionRequiredError();
    const selected = parsed.tracks[index];
    if (selected === undefined) throw new RangeError("The selected import track does not exist.");
    return [selected];
  }
  if (options.trackIndex === undefined && parsed.tracks.length > 1) throw new ImportSelectionRequiredError();
  const index = options.trackIndex ?? 0;
  const selected = parsed.tracks[index];
  if (selected === undefined) throw new RangeError("The selected import track does not exist.");
  return [selected];
}

/** The import flow's bounded checkpoints for asking the router to follow a source line. */
export function routeAlongShapingPoints(geometry: readonly Coordinate[]): readonly ShapingPoint[] {
  const interior = geometry.slice(1, -1);
  const anchorCount = Math.min(interior.length, 32);
  if (anchorCount === 0) return [];
  return Array.from({ length: anchorCount }, (_, index) => {
    const sourceIndex = anchorCount === 1
      ? Math.floor(interior.length / 2)
      : Math.round(index * (interior.length - 1) / (anchorCount - 1));
    return { id: newShapingId(), kind: "shape" as const, coordinate: interior[sourceIndex]!, source: "import" as const };
  });
}

function routeAnchors(tracks: readonly ParsedImportTrack[]): readonly ShapingPoint[] {
  return routeAlongShapingPoints(tracks.flatMap((track) => track.segments.flatMap((segment) => segment)));
}

/** The great-circle gap between source-track endpoints, in metres. */
export function distanceBetweenImportTracks(first: ParsedImportTrack, second: ParsedImportTrack): number {
  const previous = lastPoint(first);
  const next = firstPoint(second);
  return previous === null || next === null ? Number.POSITIVE_INFINITY : distanceMeters(previous, next);
}

/** True only when every selected source-track boundary is within tolerance. */
export function areImportTracksJoinable(
  tracks: readonly ParsedImportTrack[],
  gapToleranceMeters = 25,
): boolean {
  if (!Number.isFinite(gapToleranceMeters) || gapToleranceMeters < 0) return false;
  for (let index = 1; index < tracks.length; index += 1) {
    if (distanceBetweenImportTracks(tracks[index - 1]!, tracks[index]!) > gapToleranceMeters) return false;
  }
  return true;
}

function endpoint(
  kind: "start" | "finish",
  coordinate: Coordinate,
  artifact: ImportArtifact,
): RidePoint {
  return {
    id: newPointId(),
    kind,
    coordinate,
    provenance: { type: "import", sourceId: artifact.artifactId },
  };
}

/**
 * The ride's default name: the chosen track's own name (a GPX `<trk><name>` or
 * the file's metadata name), else the filename. A combined import spans several
 * tracks, so it keeps the filename.
 */
function importTitle(artifact: ImportArtifact, parsed: ParsedImport, options: ImportToRideOptions): string {
  const fromFile = artifact.filename.replace(/\.(?:gpx|kml|kmz)$/i, "") || "Imported ride";
  if (options.combine === true && (options.trackIndices?.length ?? 0) > 1) return fromFile;
  const name = parsed.tracks[options.trackIndices?.[0] ?? 0]?.name.trim() ?? "";
  return name === "" || name === "Imported track" ? fromFile : name;
}

/**
 * Make the authored derivative. Follow seeds only endpoints; route-along seeds
 * a bounded set of imported shaping anchors so the planner can build a new
 * road route without pretending it matches the source geometry.
 */
export function importToRideDocument(
  artifact: ImportArtifact,
  parsed: ParsedImport,
  options: ImportToRideOptions = {},
): RideDocument {
  if (options.trackRoute === "sketch") throw new ImportOptionNotImplementedError("sketch");
  const base = createRideDocument({
    now: options.now ?? artifact.importedAt,
    title: options.title ?? importTitle(artifact, parsed, options),
    provenance: { type: "import", sourceId: artifact.artifactId },
  });
  if (options.trackRoute !== "follow" && options.trackRoute !== "route-along") return base;
  const tracks = selectImportTracks(parsed, options);
  const start = firstPoint(tracks[0]!);
  const finish = lastPoint(tracks.at(-1)!);
  if (start === null || finish === null) throw new Error("The selected track has no unambiguous endpoints.");
  const shaping = options.trackRoute === "route-along" ? routeAnchors(tracks) : [];
  const intent = deepFreeze({ ...base.intent, start: endpoint("start", start, artifact), finish: endpoint("finish", finish, artifact), shaping });
  return deepFreeze({ ...base, intent, history: { ...base.history, baseIntent: intent } });
}
