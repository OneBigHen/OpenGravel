import { describe, expect, it, vi } from "vitest";
import { createRideInterestOverlay } from "@/application/ride-interest";

describe("ride interest route geometry loading", () => {
  it("prefetches once when the active route geometry arrives after its id", async () => {
    const alongRoute = vi.fn(async () => ({ available: true, places: [] }));
    const overlay = createRideInterestOverlay({ discoverSource: { alongRoute } });
    overlay.routeChanged("ride-route", []);
    expect(alongRoute).not.toHaveBeenCalled();
    const line = [{ lon: -75.4, lat: 40.1 }, { lon: -75.3, lat: 40.2 }];
    overlay.routeChanged("ride-route", line);
    await vi.waitFor(() => expect(alongRoute).toHaveBeenCalledOnce());
    overlay.routeChanged("ride-route", [...line]);
    expect(alongRoute).toHaveBeenCalledOnce();
    overlay.dispose();
  });
});
