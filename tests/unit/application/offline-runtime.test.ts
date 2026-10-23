import { describe, expect, it } from "vitest";

import { readBrowserOfflineRuntime } from "@/application/offline/offline-runtime";

describe("browser offline runtime", () => {
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

  it("knows a downloaded road graph lets the planner answer with no signal", async () => {
    const snapshot = await readBrowserOfflineRuntime({ now: "2026-09-18T12:00:00.000Z", installedAreas: 2 });

    expect(snapshot.installedAreas).toBe(2);
    expect(snapshot.facts.caches.offlineGraph.presence).toBe("present");
    // Presence is a fact; the graph's data date is the region's, so the age stays
    // unknown rather than being claimed fresh by this read.
    expect(snapshot.matrix["plan.route"].state).not.toBe("requires_network");
    expect(snapshot.matrix["plan.replan"].state).not.toBe("requires_network");
  });

  it("does not invent an offline graph when the caller could not check", async () => {
    const snapshot = await readBrowserOfflineRuntime({ now: "2026-09-18T12:00:00.000Z", installedAreas: null });

    expect(snapshot.installedAreas).toBeNull();
    expect(snapshot.facts.caches.offlineGraph.presence).toBe("absent");
    expect(snapshot.matrix["plan.route"].state).toBe("requires_network");
  });
});
