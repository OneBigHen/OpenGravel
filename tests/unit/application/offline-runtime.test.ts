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
});
