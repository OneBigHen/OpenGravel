import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KeptRidesSection } from "@/ui/settings/KeptRidesSection";

afterEach(cleanup);

describe("Settings: rides kept for no signal", () => {
  it("is absent when nothing is kept", async () => {
    const keptRides = vi.fn().mockResolvedValue([]);
    render(<KeptRidesSection service={{ keptRides, dropRide: vi.fn() }} />);
    await vi.waitFor(() => expect(keptRides).toHaveBeenCalled());
    expect(screen.queryByTestId("settings-kept-rides")).toBeNull();
  });

  it("lists each kept ride with its size, and Remove takes it off the phone", async () => {
    let kept = [
      { rideId: "ride_a", title: "Rothrock loop", keptAt: "2026-11-14T14:00:00.000Z", bytes: 2_700_000 },
      { rideId: "ride_b", title: "Pine Creek", keptAt: "2026-11-13T14:00:00.000Z", bytes: 1_500_000 },
    ];
    const dropRide = vi.fn(async (rideId: string) => { kept = kept.filter((ride) => ride.rideId !== rideId); });
    render(<KeptRidesSection service={{ keptRides: vi.fn(async () => kept), dropRide }} />);
    const section = await screen.findByTestId("settings-kept-rides");
    expect(section).toHaveTextContent("Kept for no signal");
    expect(section).toHaveTextContent("4 MB");
    expect(section).toHaveTextContent("Rothrock loop");
    fireEvent.click(screen.getByRole("button", { name: "Remove Rothrock loop from this phone" }));
    await vi.waitFor(() => expect(screen.queryByText("Rothrock loop")).toBeNull());
    expect(dropRide).toHaveBeenCalledWith("ride_a");
    expect(screen.getByText("Pine Creek")).toBeInTheDocument();
  });
});
