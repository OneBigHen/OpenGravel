import type { ParsedImport } from "./types";

export const IMPORT_WORKER_PROTOCOL_VERSION = 1 as const;
/** Legacy-compatible export name for callers that share the worker version. */
export const ROUTE_IMPORT_WORKER_VERSION = IMPORT_WORKER_PROTOCOL_VERSION;

interface WorkerMessageBase {
  readonly version: typeof IMPORT_WORKER_PROTOCOL_VERSION;
  readonly requestId: string;
}

export interface ImportWorkerParseRequest extends WorkerMessageBase {
  readonly kind: "parse";
  readonly filename: string;
  readonly bytes: ArrayBuffer;
}

export interface ImportWorkerCancelRequest extends WorkerMessageBase {
  readonly kind: "cancel";
}

export type ImportWorkerRequest = ImportWorkerParseRequest | ImportWorkerCancelRequest;

export interface ImportWorkerProgressResponse extends WorkerMessageBase {
  readonly kind: "progress";
  readonly points: number;
  readonly tracks: number;
  readonly segments: number;
}

export interface ImportWorkerParsedResponse extends WorkerMessageBase {
  readonly kind: "parsed";
  readonly parsed: ParsedImport;
}

export type ImportWorkerErrorCode = "security-limit" | "cancelled" | "parse-failed";

export interface ImportWorkerErrorResponse extends WorkerMessageBase {
  readonly kind: "error";
  readonly code: ImportWorkerErrorCode;
  readonly message: string;
}

export type ImportWorkerResponse = ImportWorkerProgressResponse | ImportWorkerParsedResponse | ImportWorkerErrorResponse;
export type ImportWorkerResult = ImportWorkerResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isErrorCode(value: unknown): value is ImportWorkerErrorCode {
  return value === "security-limit" || value === "cancelled" || value === "parse-failed";
}

function isCoordinate(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const lon = value["lon"];
  const lat = value["lat"];
  return typeof lon === "number" && Number.isFinite(lon) && lon >= -180 && lon <= 180 && typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isParsedImport(value: unknown): value is ParsedImport {
  if (!isRecord(value) || !Array.isArray(value["tracks"]) || !Array.isArray(value["warnings"]) || !value["warnings"].every((warning) => typeof warning === "string")) return false;
  if (value["waypoints"] !== undefined && (!Array.isArray(value["waypoints"]) || !value["waypoints"].every(isWaypoint))) return false;
  return value["tracks"].every((track) => {
    if (!isRecord(track) || typeof track["name"] !== "string" || !Array.isArray(track["segments"]) || track["segments"].length === 0 || !Array.isArray(track["timestamps"]) || !Array.isArray(track["elevation"])) return false;
    const segments = track["segments"];
    const timestamps = track["timestamps"];
    const elevations = track["elevation"];
    if (segments.length !== timestamps.length || segments.length !== elevations.length) return false;
    return segments.every((segment, index) => {
      const timestampValues = timestamps[index];
      const elevationValues = elevations[index];
      return Array.isArray(segment) && segment.length > 0 && segment.every(isCoordinate) && Array.isArray(timestampValues) && timestampValues.length === segment.length && timestampValues.every((timestamp) => timestamp === null || typeof timestamp === "string") && Array.isArray(elevationValues) && elevationValues.length === segment.length && elevationValues.every((elevation) => elevation === null || typeof elevation === "number" && Number.isFinite(elevation));
    });
  });
}

function isWaypoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (value["name"] === null || typeof value["name"] === "string") && isCoordinate(value["coordinate"])
    && (value["elevation"] === null || typeof value["elevation"] === "number" && Number.isFinite(value["elevation"]))
    && (value["timestamp"] === null || typeof value["timestamp"] === "string");
}

/** Validate untrusted messages before a worker reads their payload. */
export function parseImportWorkerRequest(raw: unknown): ImportWorkerRequest | null {
  if (!isRecord(raw) || raw["version"] !== IMPORT_WORKER_PROTOCOL_VERSION || !isRequestId(raw["requestId"])) return null;
  if (raw["kind"] === "cancel") return { version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "cancel", requestId: raw["requestId"] };
  const bytes = raw["bytes"];
  return raw["kind"] === "parse" && typeof raw["filename"] === "string" && raw["filename"].length > 0 && raw["filename"].length <= 1024 && bytes instanceof ArrayBuffer
    ? { version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "parse", requestId: raw["requestId"], filename: raw["filename"], bytes }
    : null;
}

/** Validate progress/results before they cross back into UI code. */
export function parseImportWorkerResponse(raw: unknown): ImportWorkerResponse | null {
  if (!isRecord(raw) || raw["version"] !== IMPORT_WORKER_PROTOCOL_VERSION || !isRequestId(raw["requestId"])) return null;
  if (raw["kind"] === "progress" && isCount(raw["points"]) && isCount(raw["tracks"]) && isCount(raw["segments"])) {
    return { version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "progress", requestId: raw["requestId"], points: raw["points"], tracks: raw["tracks"], segments: raw["segments"] };
  }
  if (raw["kind"] === "parsed" && isParsedImport(raw["parsed"])) {
    return { version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "parsed", requestId: raw["requestId"], parsed: raw["parsed"] };
  }
  return raw["kind"] === "error" && isErrorCode(raw["code"]) && typeof raw["message"] === "string" && raw["message"].length <= 4096
    ? { version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "error", requestId: raw["requestId"], code: raw["code"], message: raw["message"] }
    : null;
}

/** Older callers use this spelling; the VNext response shape remains bounded. */
export const parseImportWorkerResult = parseImportWorkerResponse;
