import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRideDocument } from "@/domain/ride/create";
import { RideActions } from "@/ui/planner/RideActions";

afterEach(() => cleanup());

describe("route-free ride entry points", () => {
  it("offers Record a ride and Just ride together, with distinct typed actions", async () => {
    const recordRide = vi.fn(async () => ({ outcome: "ready" as const }));
    const freeRide = vi.fn(async () => ({
      outcome: "rejected" as const,
      sessionId: null,
      message: "A ride is already in progress.",
    }));
    render(
      <RideActions
        document={createRideDocument({ now: "2026-09-24T12:00:00.000Z" })}
        libraryService={undefined}
        shareService={undefined}
        route={null}
        rideActions={{
          start: vi.fn(async () => ({ outcome: "rejected" as const, sessionId: null, message: "not used" })),
          record: recordRide,
          freeRide,
        }}
        start={null}
      />,
    );

    expect(screen.getByRole("button", { name: "Record" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Free Ride" }));
    expect(freeRide).toHaveBeenCalledOnce();
    expect(await screen.findByRole("alert")).toHaveTextContent("A ride is already in progress.");
    expect(recordRide).not.toHaveBeenCalled();
  });
});
