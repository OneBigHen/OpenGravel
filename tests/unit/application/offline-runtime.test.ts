import { afterEach, describe, expect, it, vi } from "vitest";

import { readBrowserOfflineRuntime } from "@/application/offline/offline-runtime";

afterEach(() => vi.unstubAllGlobals());

describe("browser offline runtime", () => {
  it.each([null, { scriptURL: "https://opengravel.test/ogv/sw.js?build=test" }])("requires a controller as well as cached HTML for an offline restart (%j)", async (controller) => {
    vi.stubGlobal("navigator", { onLine: false, serviceWorker: { controller, getRegistrations: async () => [{}] } });
    const match = vi.fn(async () => new Response("cached shell", { headers: { "x-og-cached-at": "2026-09-18T11:55:00.000Z" } }));
    vi.stubGlobal("caches", { match });
    const snapshot = await readBrowserOfflineRuntime({
      now: "2026-09-18T12:00:00.000Z",
      route: { rideId: "saved", routeRevision: 1, geometry: [{ lon: -75.5, lat: 40 }, { lon: -75.4, lat: 40 }], instructionsAvailable: true },
    });
    expect(snapshot.facts.serviceWorker.state).toBe(controller ? "controlled" : "registered");
    expect(snapshot.facts.caches.appShell.presence).toBe("present");
    if (!controller) expect(snapshot.matrix["nav.guidance"].state).toBe("requires_network");
    else {
      expect(match).toHaveBeenCalledWith("https://opengravel.test/ogv/");
      expect(snapshot.matrix["nav.guidance"].state).not.toBe("requires_network");
    }
  });

  it("treats missing browser caches and offline graph as network requirements", async () => {
    const snapshot = await readBrowserOfflineRuntime({ now: "2026-09-18T12:00:00.000Z" });

    expect(snapshot.matrix["plan.route"].state).toBe("requires_network");
    expect(snapshot.matrix["plan.replan"].state).toBe("requires_network");
    expect(snapshot.matrix["nav.reroute"].state).toBe("requires_network");
    expect(snapshot.matrix["explore.browse"].state).toBe("requires_network");
    expect(snapshot.matrix["weather.live"].state).toBe("requires_network");
    expect(snapshot.matrix["traffic.live"].state).toBe("requires_network");
    expect(snapshot.matrix["library.read"].state).toBe(
      typeof indexedDB === "undefined" ? "degraded" : "available",
    );
    expect(snapshot.matrix["import.export"].state).toBe("available");
    expect(snapshot.readiness).toBeNull();
  });
});
