import { MAX_FILE_BYTES, resolveImportLimits, type ImportLimitsOverride } from "@/application/import/limits";
import { extractKmzKmlEntries } from "./kmz";
import { parseGpx } from "./gpx-parser";
import { parseKml } from "./kml-parser";
import type { ImportProgress, ParsedImport } from "./types";
import { throwIfImportCancelled } from "./types";
import { parseXmlDocument } from "./xml";

export interface ParseImportBytesOptions {
  readonly limits?: ImportLimitsOverride;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ImportProgress) => void;
}

function asBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array
    ? value
    : new Uint8Array(value);
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SyntaxError("The import file is not valid UTF-8 XML.");
  }
}

function mergeParsedImports(
  imports: readonly ParsedImport[],
  limits: ReturnType<typeof resolveImportLimits>,
): ParsedImport {
  const tracks = imports.flatMap((value) => value.tracks);
  const segments = tracks.reduce((total, track) => total + track.segments.length, 0);
  const points = tracks.reduce((total, track) => total + track.segments.reduce((subtotal, segment) => subtotal + segment.length, 0), 0);
  if (tracks.length > limits.MAX_TRACKS) throw new RangeError(`Import exceeds the ${limits.MAX_TRACKS}-track limit.`);
  if (segments > limits.MAX_SEGMENTS) throw new RangeError(`Import exceeds the ${limits.MAX_SEGMENTS}-segment limit.`);
  if (points > limits.MAX_TOTAL_POINTS) throw new RangeError(`Import exceeds the ${limits.MAX_TOTAL_POINTS.toLocaleString()}-point limit.`);
  return {
    tracks,
    warnings: imports.flatMap((value) => value.warnings),
    waypoints: imports.flatMap((value) => value.waypoints ?? []),
  };
}

/**
 * Parse already-read bytes. No File, fetch, or filesystem access occurs here;
 * the browser worker owns I/O and cancellation messages.
 */
export async function parseImportBytes(
  value: Uint8Array | ArrayBuffer,
  filename: string,
  options: ParseImportBytesOptions = {},
): Promise<ParsedImport> {
  const bytes = asBytes(value);
  const limits = resolveImportLimits(options.limits);
  throwIfImportCancelled(options.signal);
  if (bytes.byteLength > limits.MAX_FILE_BYTES) {
    throw new RangeError(`Import files are limited to ${Math.round(limits.MAX_FILE_BYTES / (1024 * 1024))} MB.`);
  }
  if (filename.trim() === "") throw new Error("An import filename is required.");
  if (filename.length > 1024) throw new Error("Import filenames are limited to 1,024 characters.");
  const extension = filename.toLowerCase().split(".").at(-1);
  if (extension === "kmz") {
    const entries = await extractKmzKmlEntries(bytes, options);
    const parsed: ParsedImport[] = [];
    for (const entry of entries) {
      throwIfImportCancelled(options.signal);
      parsed.push(parseKml(decodeUtf8(entry.bytes), {
        filename: entry.name,
        byteLength: entry.bytes.byteLength,
        limits: options.limits,
        signal: options.signal,
        onProgress: options.onProgress,
      }));
    }
    const result = mergeParsedImports(parsed, limits);
    options.onProgress?.({ phase: "complete", points: result.tracks.reduce((total, track) => total + track.segments.reduce((count, segment) => count + segment.length, 0), 0), tracks: result.tracks.length, segments: result.tracks.reduce((total, track) => total + track.segments.length, 0) });
    return result;
  }
  const xml = decodeUtf8(bytes);
  const parseOptions = { filename, byteLength: bytes.byteLength, limits: options.limits, signal: options.signal, onProgress: options.onProgress };
  if (extension === "gpx") return parseGpx(xml, parseOptions);
  if (extension === "kml") return parseKml(xml, parseOptions);
  let root: ReturnType<typeof parseXmlDocument>;
  try {
    root = parseXmlDocument(xml, limits);
  } catch {
    throw new Error("Choose a GPX, KML, or KMZ route file.");
  }
  if (root.localName === "gpx") return parseGpx(xml, parseOptions);
  if (root.localName === "kml") return parseKml(xml, parseOptions);
  throw new Error("Choose a GPX, KML, or KMZ route file.");
}

export { MAX_FILE_BYTES };
