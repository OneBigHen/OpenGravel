import { describe, expect, it } from "vitest";

import {
  IMPORT_WORKER_PROTOCOL_VERSION,
  parseImportWorkerRequest,
  parseImportWorkerResponse,
  type ImportWorkerResponse,
} from "@/infrastructure/import/import-worker-protocol";

describe("import worker protocol", () => {
  it("validates parse, cancel, progress, parsed and error messages", () => {
    const bytes = new ArrayBuffer(2);
    const request = parseImportWorkerRequest({
      version: IMPORT_WORKER_PROTOCOL_VERSION,
      kind: "parse",
      requestId: "request-1",
      filename: "ride.gpx",
      bytes,
    });
    expect(request).toMatchObject({ kind: "parse", filename: "ride.gpx" });
    expect(parseImportWorkerRequest({
      version: IMPORT_WORKER_PROTOCOL_VERSION,
      kind: "cancel",
      requestId: "request-1",
    })).toMatchObject({ kind: "cancel" });

    const responses: readonly ImportWorkerResponse[] = [
      { version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "progress", requestId: "request-1", points: 2, tracks: 1, segments: 1 },
      { version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "parsed", requestId: "request-1", parsed: { tracks: [], warnings: [] } },
      { version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "error", requestId: "request-1", code: "security-limit", message: "bad archive" },
    ];
    for (const response of responses) {
      expect(parseImportWorkerResponse(response)).toEqual(response);
    }
  });

  it("preserves the worker error code instead of flattening it", () => {
    const response = parseImportWorkerResponse({
      version: IMPORT_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: "request-1",
      code: "security-limit",
      message: "KMZ archive exceeds the expansion limit.",
    });
    expect(response).toMatchObject({ kind: "error", code: "security-limit" });
  });

  it("rejects malformed or mismatched messages", () => {
    expect(parseImportWorkerRequest({ kind: "parse", requestId: "x", filename: "x.gpx", bytes: new ArrayBuffer(1) })).toBeNull();
    expect(parseImportWorkerRequest({
      version: IMPORT_WORKER_PROTOCOL_VERSION,
      kind: "parse",
      requestId: "x",
      filename: "x.gpx",
      bytes: new Uint8Array([1]),
    })).toBeNull();
    expect(parseImportWorkerResponse({
      version: IMPORT_WORKER_PROTOCOL_VERSION,
      kind: "parsed",
      requestId: "x",
      parsed: { tracks: [{ name: "bad", segments: [], timestamps: [], elevation: [] }], warnings: [] },
    })).toBeNull();
  });
});
