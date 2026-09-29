import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExportMenu } from "@/ui/rides/ExportMenu";

afterEach(() => cleanup());

describe("ExportMenu", () => {
  it("offers route, track, original, and recorded exports according to each capability", async () => {
    const onExport = vi.fn();
    render(<ExportMenu title="Pine Loop" capabilities={{ plannedRoute: true, track: true, original: true }} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(screen.getByRole("menuitem", { name: /planned route gpx/i })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /track gpx/i })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /original file/i })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /recorded ride gpx/i })).toBeDisabled();
    expect(screen.getByText(/no recorded track/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /planned route gpx/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /export/i })).toHaveAttribute("aria-expanded", "false"));
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /track gpx/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /export/i })).toHaveAttribute("aria-expanded", "false"));
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /original file/i }));
    expect(onExport).toHaveBeenNthCalledWith(1, "planned-route");
    expect(onExport).toHaveBeenNthCalledWith(2, "track");
    expect(onExport).toHaveBeenNthCalledWith(3, "original");
  });

  it("runs recorded GPX export when the ride has a recorded track", async () => {
    const onExport = vi.fn();
    render(<ExportMenu title="Recorded ride" capabilities={{ plannedRoute: false, track: false, original: false, recordedRide: true }} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /recorded ride gpx/i }));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith("recorded-ride"));
  });
});
