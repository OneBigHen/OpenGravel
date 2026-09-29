import { describe, expect, it, vi } from "vitest";

import {
  createOfflineRouteEngine,
  type OfflineRoutingWorkerResponse,
  type OfflineWorkerLike,
} from "@/infrastructure/offline/offline-route-engine";
import type { OfflineRouteRequest, OfflineRouteSuccess } from "@/domain/offline/offline-router";

const REQUEST: OfflineRouteRequest = {
  waypoints: [
    { lon: -75.4385, lat: 40.1385 },
    { lon: -75.4335, lat: 40.1325 },
  ],
  profile: "balanced",
  bike: "street",
};
const ROUTE: OfflineRouteSuccess = { ok: true, edgeIds: ["e"], osmWayIds: ["1"], geometry: REQUEST.waypoints, distanceMeters: 900, visitedStates: 3 };

/** A worker that listens only after its bootstrap, like the bundler's. */
function fakeWorker(answer: OfflineRoutingWorkerResponse | null, { ready = true } = {}) {
  const posted: unknown[] = [];
  const worker: OfflineWorkerLike & { posted: unknown[] } = {
    onmessage: null,
    onerror: null,
    posted,
    postMessage: (message) => {
      posted.push(message);
      if (answer !== null) queueMicrotask(() => worker.onmessage?.({ data: answer } as MessageEvent<OfflineRoutingWorkerResponse>));
    },
    terminate: vi.fn(),
  };
  if (ready) setTimeout(() => worker.onmessage?.({ data: { kind: "ready" } } as MessageEvent<OfflineRoutingWorkerResponse>), 0);
  return worker;
}

describe("createOfflineRouteEngine", () => {
  it("sends the request only once the worker is listening, and returns its route", async () => {
    const worker = fakeWorker({ kind: "route", route: ROUTE });
    const engine = createOfflineRouteEngine(() => worker);
    await expect(engine.route(REQUEST, new AbortController().signal)).resolves.toEqual(ROUTE);
    expect(worker.posted).toEqual([{ request: REQUEST }]);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("answers null when no downloaded area covers the ride", async () => {
    const engine = createOfflineRouteEngine(() => fakeWorker({ kind: "none" }));
    await expect(engine.route(REQUEST, new AbortController().signal)).resolves.toBeNull();
  });

  it("gives up on a worker that never starts", async () => {
    const worker = fakeWorker(null, { ready: false });
    const engine = createOfflineRouteEngine(() => worker, 20);
    await expect(engine.route(REQUEST, new AbortController().signal)).rejects.toThrow("did not start");
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("stops the worker when the plan is cancelled", async () => {
    const worker = fakeWorker(null);
    const controller = new AbortController();
    const pending = createOfflineRouteEngine(() => worker).route(REQUEST, controller.signal);
    controller.abort(new Error("superseded"));
    await expect(pending).rejects.toThrow("superseded");
    expect(worker.terminate).toHaveBeenCalled();
  });
  it("plans with a worker prepared earlier, without creating one at plan time (OF-01)", async () => {
    const workers: ReturnType<typeof fakeWorker>[] = [];
    let canLoad = true;
    const engine = createOfflineRouteEngine(() => {
      // With no signal the browser cannot load a new worker's script.
      const worker = fakeWorker({ kind: "route", route: ROUTE }, { ready: canLoad });
      if (!canLoad) setTimeout(() => worker.onerror?.({} as ErrorEvent), 0);
      workers.push(worker);
      return worker;
    }, 50);
    engine.prepare();
    await new Promise((resolve) => setTimeout(resolve, 5));
    canLoad = false;
    await expect(engine.route(REQUEST, new AbortController().signal)).resolves.toEqual(ROUTE);
    expect(workers[0]!.posted).toEqual([{ request: REQUEST }]);
    expect(workers[0]!.terminate).toHaveBeenCalled();
  });

  it("keeps one standby at most, and replaces it once used", async () => {
    let created = 0;
    const engine = createOfflineRouteEngine(() => { created += 1; return fakeWorker({ kind: "none" }); });
    engine.prepare();
    engine.prepare();
    expect(created).toBe(1);
    await expect(engine.route(REQUEST, new AbortController().signal)).resolves.toBeNull();
    expect(created).toBe(2);
  });

  it("drops a standby that cannot start, and the next plan starts its own worker", async () => {
    const broken = fakeWorker(null, { ready: false });
    const factories = [() => broken, () => fakeWorker({ kind: "route", route: ROUTE })];
    const engine = createOfflineRouteEngine(() => factories.shift()!(), 20);
    engine.prepare();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(broken.terminate).toHaveBeenCalled();
    await expect(engine.route(REQUEST, new AbortController().signal)).resolves.toEqual(ROUTE);
  });
});
