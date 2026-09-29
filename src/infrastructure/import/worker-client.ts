import type { ImportParserPort } from "@/application/import/import-service";
import { ImportCancelledError, ImportSecurityError } from "@/application/import/types";
import {
  IMPORT_WORKER_PROTOCOL_VERSION,
  parseImportWorkerResponse,
} from "./import-worker-protocol";
import type { ImportProgress, ParsedImport } from "./types";

function rehydrateWorkerError(code: "security-limit" | "cancelled" | "parse-failed", message: string): Error {
  if (code === "security-limit") return new ImportSecurityError(message);
  if (code === "cancelled") return new ImportCancelledError();
  return new Error(message);
}

export interface ImportWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
  terminate(): void;
}

export interface WorkerImportParserOptions {
  readonly workerFactory?: () => ImportWorkerLike;
}

/** Browser parser adapter; tests inject the pure parser instead of a Worker. */
export function createWorkerImportParser(options: WorkerImportParserOptions = {}): ImportParserPort {
  const workerFactory = options.workerFactory ?? (() => new Worker(
    new URL("../../workers/route-import.worker.ts", import.meta.url),
    { type: "module" },
  ) as unknown as ImportWorkerLike);

  return {
    parse: (bytes, filename, parseOptions) => new Promise<ParsedImport>((resolve, reject) => {
      if (parseOptions?.signal?.aborted) {
        reject(new ImportCancelledError());
        return;
      }
      const worker = workerFactory();
      const requestId = `request_${globalThis.crypto.randomUUID()}`;
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        parseOptions?.signal?.removeEventListener("abort", onAbort);
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
        callback();
      };
      const onAbort = (): void => {
        worker.postMessage({ version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "cancel", requestId });
        finish(() => reject(new ImportCancelledError()));
      };
      parseOptions?.signal?.addEventListener("abort", onAbort, { once: true });
      worker.onmessage = (event): void => {
        const response = parseImportWorkerResponse(event.data);
        if (response === null || response.requestId !== requestId) return;
        if (response.kind === "progress") {
          parseOptions?.onProgress?.({
            phase: "parsing",
            points: response.points,
            tracks: response.tracks,
            segments: response.segments,
          } satisfies ImportProgress);
          return;
        }
        if (response.kind === "parsed") {
          finish(() => resolve(response.parsed));
          return;
        }
        finish(() => reject(rehydrateWorkerError(response.code, response.message)));
      };
      worker.onerror = (): void => finish(() => reject(new Error("The route import worker stopped unexpectedly.")));
      worker.postMessage({ version: IMPORT_WORKER_PROTOCOL_VERSION, kind: "parse", requestId, filename, bytes }, [bytes]);
    }),
  };
}
