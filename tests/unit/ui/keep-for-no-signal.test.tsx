import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RidePackService } from "@/application/offline/ride-pack";
import { KeepForNoSignal } from "@/ui/offline/KeepForNoSignal";

afterEach(cleanup);

function service(overrides: Partial<RidePackService> = {}): RidePackService {
  return {
    keepRide: vi.fn().mockResolvedValue({ status: "kept", bytes: 31_000_000, tiles: 150 }),
    dropRide: vi.fn().mockResolvedValue(undefined),
    rideIsKept: vi.fn().mockResolvedValue(false),
    keptRides: vi.fn().mockResolvedValue([]),
    keptPackForLine: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("Keep for no signal", () => {
  it("is off until every tile is on the device, then says Kept with the size", async () => {
    let kept = false;
    const packs = service({
      rideIsKept: vi.fn(async () => kept),
      keepRide: vi.fn(async (_id, options) => {
        options?.onProgress?.({ done: 75, total: 150, bytes: 1 });
        kept = true;
        return { status: "kept" as const, bytes: 31_000_000, tiles: 150 };
      }),
    });
    render(<KeepForNoSignal rideId="ride_a" service={packs} />);
    const toggle = await screen.findByRole("switch", { name: "Keep for no signal" });
    await vi.waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(/Kept,/)).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByText("Kept, 31 MB")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("a full phone says so and the switch stays off", async () => {
    const packs = service({
      keepRide: vi.fn().mockResolvedValue({ status: "failed", reason: "storage-full", message: "There is not enough storage on this phone to keep this ride." }),
    });
    render(<KeepForNoSignal rideId="ride_a" service={packs} />);
    const toggle = await screen.findByRole("switch", { name: "Keep for no signal" });
    await vi.waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
    expect(await screen.findByText("There is not enough storage on this phone to keep this ride.")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("a keep that reports success but is missing a tile is not shown as kept", async () => {
    const packs = service({ rideIsKept: vi.fn().mockResolvedValue(false) });
    render(<KeepForNoSignal rideId="ride_a" service={packs} />);
    const toggle = await screen.findByRole("switch", { name: "Keep for no signal" });
    await vi.waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(packs.keepRide).toHaveBeenCalled());
    await vi.waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(screen.queryByText(/Kept,/)).toBeNull();
  });

  it("turning it off removes the kept ride", async () => {
    const packs = service({
      rideIsKept: vi.fn().mockResolvedValue(true),
      keptRides: vi.fn().mockResolvedValue([{ rideId: "ride_a", title: "Loop", keptAt: "2026-11-14T14:00:00.000Z", bytes: 2_000_000 }]),
    });
    render(<KeepForNoSignal rideId="ride_a" service={packs} />);
    expect(await screen.findByText("Kept, 2 MB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Keep for no signal" }));
    await vi.waitFor(() => expect(packs.dropRide).toHaveBeenCalledWith("ride_a"));
    await vi.waitFor(() => expect(screen.queryByText(/Kept,/)).toBeNull());
  });
});
