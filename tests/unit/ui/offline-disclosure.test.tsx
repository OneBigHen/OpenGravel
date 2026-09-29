import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OfflineDisclosure } from "@/ui/preparation/OfflineDisclosure";
import type { CapabilityMatrix, RouteReadiness } from "@/domain/offline/capabilities";

const matrix: CapabilityMatrix = {
  "plan.route": { state: "requires_network", reason: "No offline route engine is installed." },
  "plan.replan": { state: "requires_network", reason: "Offline rerouting is unavailable." },
  "nav.guidance": { state: "degraded", reason: "Turn instructions are not cached." },
  "nav.reroute": { state: "requires_network", reason: "No offline graph covers this route." },
  "explore.browse": { state: "requires_network", reason: "Explore data is not cached." },
  "library.read": { state: "available" },
  "weather.live": { state: "requires_network", reason: "Live weather needs a network." },
  "traffic.live": { state: "requires_network", reason: "Live traffic needs a network." },
  "import.export": { state: "available" },
};

const readiness: RouteReadiness = {
  state: "not_ready",
  ready: false,
  coveragePercent: 50,
  stalePercent: 0,
  pieces: [
    { ref: "tile:1", kind: "map-tile", lengthMeters: 50, state: "cached", ready: true, reason: "Cached." },
    { ref: "tile:2", kind: "map-tile", lengthMeters: 50, state: "uncached", ready: false, reason: "This tile is not cached." },
  ],
  reasons: ["This tile is not cached."],
};

describe("OfflineDisclosure", () => {
  afterEach(() => cleanup());

  it("renders coverage, degraded state, and explicit needs-network rows", () => {
    render(<OfflineDisclosure matrix={matrix} readiness={readiness} />);

    expect(screen.getByTestId("offline-disclosure")).toBeInTheDocument();
    expect(screen.getByText("Route corridor: 50% cached · Not ready")).toBeInTheDocument();
    expect(screen.getByText("Turn instructions are not cached.")).toBeInTheDocument();
    expect(screen.getAllByText("Needs network", { selector: "span" })).not.toHaveLength(0);
    expect(screen.queryByText("Offline ready")).not.toBeInTheDocument();
  });
});
