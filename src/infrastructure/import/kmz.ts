import { type ImportLimits, resolveImportLimits } from "@/application/import/limits";
import { ImportSecurityError, throwIfImportCancelled, type ImportParseOptions } from "./types";

export interface KmzKmlEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

interface CentralEntry {
  readonly name: string;
  readonly compression: number;
  readonly flags: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly data: Uint8Array;
}

function readU16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) throw new ImportSecurityError("KMZ archive is truncated.");
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw new ImportSecurityError("KMZ archive is truncated.");
  return view.getUint32(offset, true);
}

function sliceChecked(bytes: Uint8Array, start: number, length: number, message: string): Uint8Array {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > bytes.byteLength) {
    throw new ImportSecurityError(message);
  }
  return bytes.slice(start, start + length);
}

function validateEntryName(name: string): void {
  if (name.length === 0 || name.includes("\0") || name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(name)) {
    throw new ImportSecurityError(`KMZ entry has an absolute or invalid path: ${name || "<empty>"}.`);
  }
  const pieces = name.split(/[\\/]/);
  if (pieces.some((piece) => piece === "..")) {
    throw new ImportSecurityError(`KMZ entry path traversal is not allowed: ${name}.`);
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const lower = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = Math.max(0, bytes.byteLength - 22); offset >= lower; offset -= 1) {
    if (offset + 22 <= bytes.byteLength && readU32(view, offset) === 0x06054b50) {
      const commentLength = readU16(view, offset + 20);
      if (offset + 22 + commentLength <= bytes.byteLength) return offset;
    }
  }
  throw new ImportSecurityError("KMZ archive has no valid central directory.");
}

function centralEntries(bytes: Uint8Array, limits: ImportLimits): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(bytes, view);
  const disk = readU16(view, end + 4);
  const directoryDisk = readU16(view, end + 6);
  const entriesOnDisk = readU16(view, end + 8);
  const entriesTotal = readU16(view, end + 10);
  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entriesTotal) {
    throw new ImportSecurityError("Multi-disk KMZ archives are not supported.");
  }
  if (entriesTotal === 0xffff || readU32(view, end + 12) === 0xffffffff || readU32(view, end + 16) === 0xffffffff) {
    throw new ImportSecurityError("ZIP64 KMZ archives are not supported.");
  }
  if (entriesTotal > limits.MAX_KMZ_ENTRIES) {
    throw new ImportSecurityError(`KMZ archives are limited to ${limits.MAX_KMZ_ENTRIES} entries.`);
  }
  const directorySize = readU32(view, end + 12);
  let directoryOffset = readU32(view, end + 16);
  if (directoryOffset + directorySize > end) throw new ImportSecurityError("KMZ central directory is outside the archive.");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: CentralEntry[] = [];
  let totalUncompressed = 0;
  for (let index = 0; index < entriesTotal; index += 1) {
    if (readU32(view, directoryOffset) !== 0x02014b50) throw new ImportSecurityError("KMZ central directory entry is invalid.");
    const flags = readU16(view, directoryOffset + 8);
    const compression = readU16(view, directoryOffset + 10);
    const compressedSize = readU32(view, directoryOffset + 20);
    const uncompressedSize = readU32(view, directoryOffset + 24);
    const nameLength = readU16(view, directoryOffset + 28);
    const extraLength = readU16(view, directoryOffset + 30);
    const commentLength = readU16(view, directoryOffset + 32);
    const localOffset = readU32(view, directoryOffset + 42);
    const nameStart = directoryOffset + 46;
    const name = decoder.decode(sliceChecked(bytes, nameStart, nameLength, "KMZ entry name is truncated."));
    validateEntryName(name);
    directoryOffset = nameStart + nameLength + extraLength + commentLength;
    if (directoryOffset > end) throw new ImportSecurityError("KMZ central directory entry exceeds its bounds.");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.MAX_KMZ_UNCOMPRESSED_BYTES) {
      throw new ImportSecurityError(`KMZ contents are limited to ${limits.MAX_KMZ_UNCOMPRESSED_BYTES / (1024 * 1024)} MB uncompressed.`);
    }
    const ratio = uncompressedSize / Math.max(1, compressedSize);
    if (ratio > limits.MAX_KMZ_COMPRESSION_RATIO) {
      throw new ImportSecurityError(`KMZ entry ${name} exceeds the ${limits.MAX_KMZ_COMPRESSION_RATIO}:1 compression ratio limit.`);
    }
    if ((flags & 0x1) !== 0) throw new ImportSecurityError("Encrypted KMZ entries cannot be imported.");
    if (compression !== 0 && compression !== 8) throw new ImportSecurityError(`KMZ entry ${name} uses an unsupported compression method.`);
    if (readU32(view, localOffset) !== 0x04034b50) throw new ImportSecurityError("KMZ local entry is invalid.");
    const localNameLength = readU16(view, localOffset + 26);
    const localExtraLength = readU16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = sliceChecked(bytes, dataStart, compressedSize, `KMZ entry ${name} is truncated.`);
    entries.push({ name, compression, flags, compressedSize, uncompressedSize, data });
  }
  return entries;
}

async function inflateRaw(entry: CentralEntry, signal: AbortSignal | undefined): Promise<Uint8Array> {
  throwIfImportCancelled(signal);
  if (entry.compression === 0) return entry.data.slice();
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot decompress deflated KMZ entries.");
  const sourceBytes = new Uint8Array(entry.data.byteLength);
  sourceBytes.set(entry.data);
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(sourceBytes);
      controller.close();
    },
  });
  // Consume the readable side while the writer/source is active. This avoids
  // the back-pressure deadlock that a sequential writer.write/close approach
  // caused in the legacy browser parser.
  const decompressed = source.pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = decompressed.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    const chunk = next.value;
    total += chunk.byteLength;
    if (total > entry.uncompressedSize) {
      await reader.cancel();
      throw new ImportSecurityError(`KMZ entry ${entry.name} expanded beyond its declared size.`);
    }
    chunks.push(chunk);
  }
  const decoded = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    decoded.set(chunk, offset);
    offset += chunk.byteLength;
  }
  throwIfImportCancelled(signal);
  if (decoded.byteLength !== entry.uncompressedSize) throw new ImportSecurityError(`KMZ entry ${entry.name} expanded to an unexpected size.`);
  return decoded;
}

/** Extract every KML entry after applying central-directory security guards. */
export async function extractKmzKmlEntries(
  bytes: Uint8Array,
  options: Pick<ImportParseOptions, "limits" | "signal"> = {},
): Promise<readonly KmzKmlEntry[]> {
  const limits = resolveImportLimits(options.limits);
  const entries = centralEntries(bytes, limits);
  const kmlEntries: KmzKmlEntry[] = [];
  for (const entry of entries) {
    throwIfImportCancelled(options.signal);
    if (!entry.name.toLowerCase().endsWith(".kml")) continue;
    const decoded = await inflateRaw(entry, options.signal);
    if (decoded.byteLength > limits.MAX_KMZ_UNCOMPRESSED_BYTES) throw new ImportSecurityError("KMZ entry is too large after decompression.");
    kmlEntries.push({ name: entry.name, bytes: decoded });
  }
  if (kmlEntries.length === 0) throw new Error("KMZ archive does not contain a KML route file.");
  return kmlEntries;
}
