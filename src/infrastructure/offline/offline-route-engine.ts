/**
 * The browser's offline route engine: each request runs in its own
 * `offline-routing.worker`, which reads the downloaded regions from IndexedDB.
 */

import type { OfflineRouteEngine } from "@/application/offline/offline-route-fallback";
import type { OfflineRouteRequest, OfflineRouteSuccess } from "@/domain/offline/offline-router";

export type OfflineRoutingWorkerResponse =
  | { readonly kind: "ready" }
  | { readonly kind: "route"; readonly route: OfflineRouteSuccess }
  | { readonly kind: "none"; readonly reason?: string }
  | { readonly kind: "error"; readonly message: string };

export interface OfflineWorkerLike {
  onmessage: ((event: MessageEvent<OfflineRoutingWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: { readonly request: OfflineRouteRequest }): void;
  terminate(): void;
}

function browserWorker(): OfflineWorkerLike {
  return new Worker(new URL("../../workers/offline-routing.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as OfflineWorkerLike;
}

/** A worker that has not said it is listening by now never will. */
const READY_TIMEOUT_MS = 10_000;

/** The worker-backed engine, plus a way to have a worker loaded before signal is lost. */
export interface BrowserOfflineRouteEngine extends OfflineRouteEngine {
  /**
   * Loads one worker now and keeps it listening, so the next plan needs no
   * network to start it (OF-01). With no signal the browser cannot fetch the
   * worker's script, and a plan that only then created its worker failed.
   */
  prepare(): void;
}

interface StartedWorker {
  readonly worker: OfflineWorkerLike;
  /** Settles once the worker listens; rejects when it cannot start. */
  readonly ready: Promise<void>;
}

export function createOfflineRouteEngine(
  workerFactory: () => OfflineWorkerLike = browserWorker,
  readyTimeoutMs = READY_TIMEOUT_MS,
): BrowserOfflineRouteEngine {
  let standby: StartedWorker | null = null;

  const start = (): StartedWorker => {
    const worker = workerFactory();
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Offline routing did not start.")), readyTimeoutMs);
      // The bundler's worker bootstrap loads its chunks asynchronously, and a
      // message posted before the worker listens is dropped; the worker says
      // when it is listening.
      worker.onmessage = (event): void => {
        if (event.data.kind !== "ready") return;
        clearTimeout(timer);
        resolve();
      };
      worker.onerror = (): void => {
        clearTimeout(timer);
        reject(new Error("Offline routing stopped unexpectedly."));
      };
    });
    // A rejection nobody awaits yet (a standby) is not an unhandled one.
    ready.catch(() => undefined);
    return { worker, ready };
  };

  const prepare = (): void => {
    if (standby !== null) return;
    const started = start();
    standby = started;
    started.ready.catch(() => {
      if (standby === started) standby = null;
      started.worker.terminate();
    });
  };

  return {
    prepare,
    route(request: OfflineRouteRequest, signal: AbortSignal): Promise<OfflineRouteSuccess | null> {
      if (signal.aborted) return Promise.reject(signal.reason);
      // One worker per request: cancelling terminates it outright. A standby
      // is taken, and replaced while the browser can still load one.
      const hadStandby = standby !== null;
      const { worker, ready } = standby ?? start();
      standby = null;
      if (hadStandby) prepare();
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (): void => {
          done = true;
          signal.removeEventListener("abort", onAbort);
          worker.terminate();
        };
        const onAbort = (): void => {
          if (done) return;
          finish();
          reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        ready.then(
          () => {
            if (done) return;
            worker.onmessage = (event): void => {
              const response = event.data;
              if (response.kind === "ready") return;
              finish();
              if (response.kind === "route") resolve(response.route);
              else if (response.kind === "none") resolve(null);
              else reject(new Error(response.message));
            };
            worker.onerror = (): void => {
              finish();
              reject(new Error("Offline routing stopped unexpectedly."));
            };
            worker.postMessage({ request });
          },
          (error: unknown) => {
            if (done) return;
            finish();
            reject(error);
          },
        );
      });
    },
  };
}
