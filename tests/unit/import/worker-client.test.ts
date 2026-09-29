import { describe, expect, it, vi } from "vitest";

import { createImportService } from "@/application/import/import-service";
import { ImportCancelledError, type ImportFile } from "@/application/import/import-artifact";
import { createRideDocument } from "@/domain/ride/create";
import { createWorkerImportParser, type ImportWorkerLike } from "@/infrastructure/import/worker-client";
import { installRouteImportWorker, type RouteImportWorkerScope } from "@/workers/route-import.worker";

function workerFactory(): () => ImportWorkerLike {
  return () => {
    let listener: ((event: MessageEvent<unknown>) => void) | null = null;
    const worker: ImportWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(message) {
        listener?.({ data: message } as MessageEvent<unknown>);
      },
      terminate: vi.fn(),
    };
    const scope: RouteImportWorkerScope = {
      addEventListener: (_type, next) => { listener = next; },
      postMessage: (message) => worker.onmessage?.({ data: message } as MessageEvent<unknown>),
    };
    installRouteImportWorker(scope);
    return worker;
  };
}

function file(name: string, bytes: Uint8Array): ImportFile {
  return {
    name,
    type: name.endsWith(".kmz") ? "application/vnd.google-earth.kmz" : "application/gpx+xml",
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

function zipWithEntry(name: string, data = new Uint8Array()): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + nameBytes.length + data.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(8, 0, true);
  localView.setUint32(18, data.length, true);
  localView.setUint32(22, data.length, true);
  localView.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(data, 30 + nameBytes.length);
  const central = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint32(20, data.length, true);
  centralView.setUint32(24, data.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  centralView.setUint32(42, 0, true);
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);
  const result = new Uint8Array(local.length + central.length + end.length);
  result.set(local, 0);
  result.set(central, local.length);
  result.set(end, local.length + central.length);
  return result;
}

function serviceWithWorker() {
  const parser = createWorkerImportParser({ workerFactory: workerFactory() });
  return createImportService({
    blobStore: {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
    },
    libraryService: {
      saveRecorded: vi.fn().mockRejectedValue(new Error("recorded ride save is not used by import tests")),
      findRecorded: vi.fn().mockResolvedValue(null),
      saveNamed: vi.fn().mockResolvedValue({ document: createRideDocument(), savedAt: "2026-09-17T12:00:00.000Z" }),
      findImportedContentHash: vi.fn().mockResolvedValue(null),
      listRides: vi.fn().mockResolvedValue([]),
      renameRide: vi.fn().mockResolvedValue(undefined),
      deleteRide: vi.fn().mockResolvedValue(undefined),
      createDerivative: vi.fn().mockResolvedValue(createRideDocument()),
      openRide: vi.fn().mockResolvedValue(createRideDocument()),
    },
    parse: parser,
  });
}

describe("worker import parser", () => {
  it("rejects an already-cancelled parse before creating a worker", async () => {
    const factory = vi.fn(workerFactory());
    const parser = createWorkerImportParser({ workerFactory: factory });
    const controller = new AbortController();
    controller.abort();

    await expect(parser.parse(new ArrayBuffer(0), "ride.gpx", { signal: controller.signal })).rejects.toBeInstanceOf(ImportCancelledError);
    expect(factory).not.toHaveBeenCalled();
  });

  it("preserves security guard taxonomy through the worker and service", async () => {
    const service = serviceWithWorker();
    await expect(service.previewFile(file("bomb.kmz", Uint8Array.from([0])))).rejects.toMatchObject({ code: "archive-guard" });

    await expect(service.previewFile(file("traversal.kmz", zipWithEntry("../doc.kml")))).rejects.toMatchObject({ code: "archive-guard" });
  });
});
