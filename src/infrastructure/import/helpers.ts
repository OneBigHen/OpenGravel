import {
  MAX_NAME_BYTES,
  MAX_TIMESTAMP_BYTES,
  type ImportLimits,
} from "@/application/import/limits";
import type { Coordinate } from "@/domain/ride/types";
import { ImportCancelledError, throwIfImportCancelled } from "./types";
import type { ImportProgress } from "./types";
import type { XmlElement } from "./xml";
import { childText, textBytes } from "./xml";

export interface ParseState {
  points: number;
  tracks: number;
  segments: number;
  readonly warnings: string[];
  readonly options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: ImportProgress) => void;
  };
}

export function makeParseState(options: ParseState["options"]): ParseState {
  return { points: 0, tracks: 0, segments: 0, warnings: [], options };
}

export function checkCancelled(state: ParseState): void {
  throwIfImportCancelled(state.options.signal);
}

export function pointSeen(state: ParseState, limits: ImportLimits): void {
  checkCancelled(state);
  state.points += 1;
  if (state.points > limits.MAX_TOTAL_POINTS) {
    throw new RangeError(`Import exceeds the ${limits.MAX_TOTAL_POINTS.toLocaleString()}-point limit.`);
  }
  state.options.onProgress?.({
    phase: "parsing",
    points: state.points,
    tracks: state.tracks,
    segments: state.segments,
  });
  checkCancelled(state);
}

export function trackSeen(state: ParseState, limits: ImportLimits): void {
  checkCancelled(state);
  state.tracks += 1;
  if (state.tracks > limits.MAX_TRACKS) {
    throw new RangeError(`Import exceeds the ${limits.MAX_TRACKS}-track limit.`);
  }
}

export function segmentSeen(state: ParseState, limits: ImportLimits): void {
  checkCancelled(state);
  state.segments += 1;
  if (state.segments > limits.MAX_SEGMENTS) {
    throw new RangeError(`Import exceeds the ${limits.MAX_SEGMENTS}-segment limit.`);
  }
}

export function boundedName(
  value: string | null,
  fallback: string,
  limits: ImportLimits,
  state: ParseState,
): string {
  const candidate = value?.trim() || fallback;
  if (textBytes(candidate) <= Math.min(MAX_NAME_BYTES, limits.MAX_NAME_BYTES)) return candidate;
  const cap = Math.min(MAX_NAME_BYTES, limits.MAX_NAME_BYTES);
  let result = "";
  for (const character of candidate) {
    if (textBytes(result + character) > cap) break;
    result += character;
  }
  state.warnings.push(`A track name was truncated to ${cap} bytes.`);
  return result || "Imported track";
}

export function fileFallbackName(filename: string): string {
  const base = filename.split(/[\\/]/).at(-1) ?? filename;
  return base.replace(/\.(?:gpx|kml|kmz)$/i, "").replaceAll(/[-_]+/g, " ").trim() || "Imported track";
}

export function coordinateFromAttributes(
  element: XmlElement,
  state: ParseState,
  label: string,
): Coordinate | null {
  const latitudeText = element.attributes["lat"];
  const longitudeText = element.attributes["lon"];
  const latitude = latitudeText === undefined || latitudeText.trim() === "" ? Number.NaN : Number(latitudeText);
  const longitude = longitudeText === undefined || longitudeText.trim() === "" ? Number.NaN : Number(longitudeText);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) {
    state.warnings.push(`Dropped invalid coordinate in ${label}.`);
    return null;
  }
  return { lon: longitude, lat: latitude };
}

export function parseElevation(
  element: XmlElement,
  state: ParseState,
  label: string,
): number | null {
  const raw = childText(element, "ele");
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    state.warnings.push(`Ignored invalid elevation in ${label}.`);
    return null;
  }
  return value;
}

export function parseTimestamp(
  element: XmlElement,
  state: ParseState,
  label: string,
  limits: ImportLimits,
): string | null {
  const raw = childText(element, "time");
  if (raw === null || raw === "") return null;
  if (textBytes(raw) > Math.min(MAX_TIMESTAMP_BYTES, limits.MAX_TIMESTAMP_BYTES)) {
    state.warnings.push(`Ignored oversized timestamp in ${label}.`);
    return null;
  }
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) {
    state.warnings.push(`Ignored invalid timestamp in ${label}.`);
    return null;
  }
  return new Date(milliseconds).toISOString();
}

export function finalProgress(state: ParseState): void {
  state.options.onProgress?.({
    phase: "complete",
    points: state.points,
    tracks: state.tracks,
    segments: state.segments,
  });
}

export function ensureTrackHasGeometry(
  segments: readonly unknown[],
  name: string,
  state: ParseState,
): boolean {
  if (segments.length > 0) return true;
  state.warnings.push(`Ignored track "${name}" because it has no valid coordinates.`);
  return false;
}

export { ImportCancelledError };
