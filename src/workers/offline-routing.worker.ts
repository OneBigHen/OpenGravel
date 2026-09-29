/**
 * Plans one route from the downloaded offline regions, off the main thread.
 * One worker per request: cancelling a plan terminates it outright, which is
 * the only way to stop a search that is mid-loop.
 */

import { offlineSearchArea } from "@/domain/offline/graph-tile";
import { routeOffline, type OfflineRouteRequest } from "@/domain/offline/offline-router";
import { RegionDownloadStore } from "@/infrastructure/offline/region-download-store";
import type { OfflineRoutingWorkerResponse } from "@/infrastructure/offline/offline-route-engine";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<{ request: OfflineRouteRequest }>) => void): void;
  postMessage(message: OfflineRoutingWorkerResponse): void;
}

export function installOfflineRoutingWorker(scope: WorkerScope, store = new RegionDownloadStore()): void {
  scope.addEventListener("message", (event) => {
    const { request } = event.data;
    void (async (): Promise<OfflineRoutingWorkerResponse> => {
      const area = offlineSearchArea(request.waypoints);
      if (area === null) return { kind: "none" };
      const tiles = await store.tilesFor(area);
      if (tiles.length === 0) return { kind: "none" };
      const result = routeOffline(tiles, request);
      return result.ok ? { kind: "route", route: result } : { kind: "none", reason: result.kind };
    })()
      .catch((error: unknown) => ({ kind: "error", message: error instanceof Error ? error.message : "Offline routing failed." }) as const)
      .then((response) => scope.postMessage(response));
  });
  scope.postMessage({ kind: "ready" });
}

// Only `self`: the bundler inlines `typeof window` as "object" in client code,
// so a window check here would compile the install away.
if (typeof self !== "undefined") installOfflineRoutingWorker(self as unknown as WorkerScope);
