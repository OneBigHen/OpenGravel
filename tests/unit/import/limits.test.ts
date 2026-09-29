import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMPORT_LIMITS,
  MAX_FILE_BYTES,
  MAX_KMZ_COMPRESSION_RATIO,
  MAX_KMZ_ENTRIES,
  MAX_KMZ_UNCOMPRESSED_BYTES,
  MAX_NAME_BYTES,
  MAX_ATTRIBUTE_BYTES,
  MAX_COORDINATE_TOKEN_BYTES,
  MAX_SEGMENTS,
  MAX_STRING_BYTES,
  MAX_TIMESTAMP_BYTES,
  MAX_TOTAL_POINTS,
  MAX_TRACKS,
  MAX_XML_DEPTH,
  type ImportLimits,
  resolveImportLimits,
} from "@/application/import/limits";

describe("import limits", () => {
  it("publishes one bounded contract for every parser", () => {
    expect({
      MAX_FILE_BYTES,
      MAX_TOTAL_POINTS,
      MAX_SEGMENTS,
      MAX_TRACKS,
      MAX_KMZ_ENTRIES,
      MAX_KMZ_UNCOMPRESSED_BYTES,
      MAX_KMZ_COMPRESSION_RATIO,
      MAX_XML_DEPTH,
    }).toEqual({
      MAX_FILE_BYTES: 10 * 1024 * 1024,
      MAX_TOTAL_POINTS: 100_000,
      MAX_SEGMENTS: 200,
      MAX_TRACKS: 50,
      MAX_KMZ_ENTRIES: 32,
      MAX_KMZ_UNCOMPRESSED_BYTES: 50 * 1024 * 1024,
      MAX_KMZ_COMPRESSION_RATIO: 100,
      MAX_XML_DEPTH: 64,
    });
    expect(MAX_NAME_BYTES).toBeLessThan(MAX_STRING_BYTES);
    expect(MAX_TIMESTAMP_BYTES).toBeLessThan(MAX_STRING_BYTES);
    expect(DEFAULT_IMPORT_LIMITS.MAX_FILE_BYTES).toBe(MAX_FILE_BYTES);
    expect(DEFAULT_IMPORT_LIMITS.MAX_TOTAL_POINTS).toBe(MAX_TOTAL_POINTS);
  });

  it.each([
    ["MAX_FILE_BYTES", MAX_FILE_BYTES],
    ["MAX_TOTAL_POINTS", MAX_TOTAL_POINTS],
    ["MAX_SEGMENTS", MAX_SEGMENTS],
    ["MAX_TRACKS", MAX_TRACKS],
    ["MAX_KMZ_ENTRIES", MAX_KMZ_ENTRIES],
    ["MAX_KMZ_UNCOMPRESSED_BYTES", MAX_KMZ_UNCOMPRESSED_BYTES],
    ["MAX_KMZ_COMPRESSION_RATIO", MAX_KMZ_COMPRESSION_RATIO],
    ["MAX_XML_DEPTH", MAX_XML_DEPTH],
    ["MAX_STRING_BYTES", MAX_STRING_BYTES],
    ["MAX_NAME_BYTES", MAX_NAME_BYTES],
    ["MAX_TIMESTAMP_BYTES", MAX_TIMESTAMP_BYTES],
    ["MAX_ATTRIBUTE_BYTES", MAX_ATTRIBUTE_BYTES],
    ["MAX_COORDINATE_TOKEN_BYTES", MAX_COORDINATE_TOKEN_BYTES],
  ] as const)("accepts %s at its boundary and rejects over it", (key, value) => {
    const atBoundary = { [key]: value } as Partial<ImportLimits>;
    expect(resolveImportLimits(atBoundary)[key]).toBe(value);
    expect(() => resolveImportLimits({ [key]: value + 1 } as Partial<ImportLimits>)).toThrow(key);
  });
});
