import { ImportCancelledError, ImportSecurityError } from "@/application/import/types";
import { parseImportBytes } from "@/infrastructure/import/import-bytes";
import {
  IMPORT_WORKER_PROTOCOL_VERSION,
  parseImportWorkerRequest,
  type ImportWorkerErrorCode,
  type ImportWorkerResponse,
} from "@/infrastructure/import/import-worker-protocol";

export interface RouteImportWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: ImportWorkerResponse): void;
}

function errorCode(error: unknown): ImportWorkerErrorCode {
  if (error instanceof ImportSecurityError) return error.code;
  if (error instanceof ImportCancelledError) return error.code;
  return "parse-failed";
}

export function installRouteImportWorker(workerScope: RouteImportWorkerScope): void {
  const activeRequests = new Map<string, AbortController>();
  const MAX_ACTIVE_IMPORTS = 1;

  workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
    const request = parseImportWorkerRequest(event.data);
    if (request === null) return;
    if (request.kind === "cancel") {
      activeRequests.get(request.requestId)?.abort();
      return;
    }
    if (activeRequests.size >= MAX_ACTIVE_IMPORTS) {
      workerScope.postMessage({ version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "error", requestId: request.requestId, code: "parse-failed", message: "The route import worker is already processing a file." });
      return;
    }
    const controller = new AbortController();
    activeRequests.set(request.requestId, controller);
    const postProgress = (points: number, tracks: number, segments: number): void => {
      workerScope.postMessage({ version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "progress", requestId: request.requestId, points, tracks, segments });
    };
    void parseImportBytes(request.bytes, request.filename, {
      signal: controller.signal,
      onProgress: (progress) => postProgress(progress.points, progress.tracks, progress.segments),
    }).then((parsed) => {
      if (controller.signal.aborted) return;
      workerScope.postMessage({ version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "parsed", requestId: request.requestId, parsed });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      workerScope.postMessage({ version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "error", requestId: request.requestId, code: errorCode(error), message: error instanceof Error ? error.message : "The route file could not be imported." });
    }).finally(() => {
      activeRequests.delete(request.requestId);
    });
  });
}

if (typeof self !== "undefined") installRouteImportWorker(self as unknown as RouteImportWorkerScope);
