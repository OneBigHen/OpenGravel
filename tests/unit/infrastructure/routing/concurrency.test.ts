import { describe, expect, it } from "vitest";
import { boundedRouteProvider, MAX_ROUTING_SEARCHES } from "@/infrastructure/routing/concurrency";
import type { ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";

const request: ProviderRouteRequest = {
  requestId: "queued", origin: { lon: -75, lat: 40 }, destination: { lon: -74.9, lat: 40.1 },
  stops: [], shaping: [], profile: "motorcycle_fastest", avoidPolygons: [],
  options: { includeAlternatives: false, avoidHighways: false, tollPolicy: "avoid", vehicle: "motorcycle" },
};
describe("boundedRouteProvider", () => {
  it("removes cancelled queued work, releases rejected searches and drains in order", async () => {
    const started: string[] = [];
    const release: Array<() => void> = [];
    const provider: RouteCandidateProvider = {
      id: "queued", capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }),
      async candidates(value) {
        started.push(value.requestId);
        await new Promise<void>(resolve => release.push(resolve));
        if (value.requestId === "0") throw new Error("engine failed");
        return { candidates: [] };
      },
    };
    const controller = new AbortController();
    const bounded = boundedRouteProvider(provider);
    const running = Array.from({ length: MAX_ROUTING_SEARCHES }, (_, index) => bounded.candidates({ ...request, requestId: String(index) }, controller.signal).catch(error => error));
    await Promise.resolve();
    expect(started).toHaveLength(MAX_ROUTING_SEARCHES);
    const queuedAbort = new AbortController();
    const cancelled = bounded.candidates(request, queuedAbort.signal);
    const reason = new Error("superseded");
    queuedAbort.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
    const next = boundedRouteProvider(provider).candidates({ ...request, requestId: "next" }, controller.signal);
    release[0]!();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(started).toEqual(["0", "1", "2", "next"]);
    release.slice(1).forEach(done => done());
    await expect(next).resolves.toEqual({ candidates: [] });
    await Promise.all(running);
  });
});
