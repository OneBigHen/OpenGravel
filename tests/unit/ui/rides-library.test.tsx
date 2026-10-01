import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RidesLibrary } from "@/ui/rides/RidesLibrary";
import type { LibraryServicePort, RideSummary } from "@/application/library/library-service";
import type { RoadProgressReader } from "@/application/roads/explorable-roads";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const RIDE: RideSummary = {
  rideId: "ride_library_1" as RideSummary["rideId"],
  title: "Pine Loop",
  type: "planned",
  provenanceType: "new",
  savedAt: "2026-09-17T12:00:00.000Z",
  updatedAt: "2026-09-17T12:00:00.000Z",
  area: null,
  distanceMeters: null,
  durationSeconds: null,
  sourceId: null,
};

function service(overrides: Partial<LibraryServicePort> = {}): LibraryServicePort {
  return {
    saveNamed: vi.fn().mockResolvedValue({ document: {} as never, savedAt: "" }),
    findImportedContentHash: vi.fn().mockResolvedValue(null),
    saveRecorded: vi.fn().mockResolvedValue({
      rideId: "ride_recorded" as never,
      savedAt: "",
      summary: { distanceMeters: 0, elapsedSeconds: 0, movingSeconds: 0, pointCount: 0 },
    }),
    findRecorded: vi.fn().mockResolvedValue(null),
    listRides: vi.fn().mockImplementation(async (filter) =>
      filter?.text === "missing" ? [] : [RIDE],
    ),
    renameRide: vi.fn().mockResolvedValue(undefined),
    deleteRide: vi.fn().mockResolvedValue(undefined),
    createDerivative: vi.fn().mockResolvedValue({}),
    openRide: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("RidesLibrary", () => {
  it("shows the saved recorded line, duration summary, and GPX export", async () => {
    const recorded: RideSummary = {
      ...RIDE,
      rideId: "ride_recorded_rec_1" as RideSummary["rideId"],
      title: "Recorded ride",
      type: "recorded",
      provenanceType: "recorded",
      distanceMeters: 20_000,
      durationSeconds: 102,
      recordedTrack: {
        summary: { distanceMeters: 20_000, elapsedSeconds: 125, movingSeconds: 102, pointCount: 3 },
        previewGeometry: [
          { lon: -75.5, lat: 40 },
          { lon: -75.4, lat: 40.1 },
          { lon: -75.3, lat: 40.2 },
        ],
      },
      exportCapabilities: { plannedRoute: false, track: false, original: false, recordedRide: true },
    };
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([recorded]) })} />);

    expect(await screen.findByRole("img", { name: "Recorded track preview for Recorded ride" })).toBeInTheDocument();
    expect(screen.getByTestId("recorded-ride-summary")).toHaveTextContent("Distance: 12 mi · 1:42 moving · 2:05 total");
    fireEvent.click(screen.getByRole("button", { name: "Export Recorded ride" }));
    expect(screen.getByRole("menuitem", { name: "Recorded ride GPX" })).toBeEnabled();
  });

  it("reads road progress only when recorded details are expanded", async () => {
    const recorded: RideSummary = {
      ...RIDE,
      rideId: "ride_recorded_rec_2" as RideSummary["rideId"],
      title: "Recorded ride",
      type: "recorded",
      provenanceType: "recorded",
      recordedTrack: {
        summary: { distanceMeters: 20_000, elapsedSeconds: 125, movingSeconds: 102, pointCount: 3 },
        previewGeometry: [{ lon: -75.5, lat: 40 }, { lon: -75.4, lat: 40.1 }],
      },
    };
    const reader: RoadProgressReader = {
      read: vi.fn().mockResolvedValue({
        rideId: recorded.rideId,
        qualifiedMeters: 8_000,
        newToYouMeters: 4_000,
        coverage: "partial",
        historyAvailable: true,
        matchedFeatures: [],
      }),
    };
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([recorded]) })} roadProgressReader={reader} />);

    await screen.findByRole("button", { name: "View details for Recorded ride" });
    expect(reader.read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "View details for Recorded ride" }));
    await waitFor(() => expect(screen.getByTestId("recorded-road-progress")).toHaveTextContent("New-to-you: 2.5 mi estimated"));
    expect(reader.read).toHaveBeenCalledWith(recorded.rideId, expect.any(AbortSignal));
  });

  it("aborts and discards a late result after recorded details collapse", async () => {
    const recorded: RideSummary = {
      ...RIDE,
      rideId: "ride_recorded_rec_3" as RideSummary["rideId"],
      title: "Recorded ride",
      type: "recorded",
      provenanceType: "recorded",
      recordedTrack: {
        summary: { distanceMeters: 20_000, elapsedSeconds: 125, movingSeconds: 102, pointCount: 3 },
        previewGeometry: [{ lon: -75.5, lat: 40 }, { lon: -75.4, lat: 40.1 }],
      },
    };
    let resolveFirst: ((value: Awaited<ReturnType<RoadProgressReader["read"]>>) => void) | undefined;
    const pending = new Promise<Awaited<ReturnType<RoadProgressReader["read"]>>>((resolve) => {
      resolveFirst = resolve;
    });
    const reader: RoadProgressReader = {
      read: vi.fn()
        .mockReturnValueOnce(pending)
        .mockResolvedValueOnce({
          rideId: recorded.rideId,
          qualifiedMeters: 8_000,
          newToYouMeters: 4_000,
          coverage: "partial",
          historyAvailable: true,
          matchedFeatures: [],
        }),
    };
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([recorded]) })} roadProgressReader={reader} />);

    const details = await screen.findByRole("button", { name: "View details for Recorded ride" });
    fireEvent.click(details);
    await waitFor(() => expect(reader.read).toHaveBeenCalledWith(recorded.rideId, expect.any(AbortSignal)));
    const signal = vi.mocked(reader.read).mock.calls[0]?.[1];
    fireEvent.click(screen.getByRole("button", { name: "View details for Recorded ride" }));
    expect(signal?.aborted).toBe(true);
    resolveFirst?.({
      rideId: recorded.rideId,
      qualifiedMeters: 8_000,
      newToYouMeters: 4_000,
      coverage: "partial",
      historyAvailable: true,
      matchedFeatures: [],
    });
    fireEvent.click(screen.getByRole("button", { name: "View details for Recorded ride" }));
    await waitFor(() => expect(reader.read).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("recorded-road-progress")).toHaveTextContent("New-to-you: 2.5 mi estimated");
  });

  it("hides completed progress when the reader identity changes", async () => {
    const recorded: RideSummary = {
      ...RIDE,
      rideId: "ride_recorded_rec_5" as RideSummary["rideId"],
      title: "Recorded ride",
      type: "recorded",
      provenanceType: "recorded",
      recordedTrack: {
        summary: { distanceMeters: 20_000, elapsedSeconds: 125, movingSeconds: 102, pointCount: 3 },
        previewGeometry: [{ lon: -75.5, lat: 40 }, { lon: -75.4, lat: 40.1 }],
      },
    };
    const projection = (newToYouMeters: number) => ({
      rideId: recorded.rideId,
      qualifiedMeters: 8_000,
      newToYouMeters,
      coverage: "partial" as const,
      historyAvailable: true,
      matchedFeatures: [],
    });
    const firstReader: RoadProgressReader = { read: vi.fn().mockResolvedValue(projection(4_000)) };
    const secondReader: RoadProgressReader = { read: vi.fn().mockResolvedValue(projection(800)) };
    const library = service({ listRides: vi.fn().mockResolvedValue([recorded]) });
    const view = render(<RidesLibrary service={library} roadProgressReader={firstReader} />);

    fireEvent.click(await screen.findByRole("button", { name: "View details for Recorded ride" }));
    await waitFor(() => expect(screen.getByTestId("recorded-road-progress")).toHaveTextContent("New-to-you: 2.5 mi estimated"));
    view.rerender(<RidesLibrary service={library} roadProgressReader={secondReader} />);
    expect(screen.queryByText("New-to-you: 2.5 mi estimated")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View details for Recorded ride" }));
    fireEvent.click(screen.getByRole("button", { name: "View details for Recorded ride" }));
    await waitFor(() => expect(screen.getByTestId("recorded-road-progress")).toHaveTextContent("New-to-you: 0.5 mi estimated"));
    expect(secondReader.read).toHaveBeenCalledWith(recorded.rideId, expect.any(AbortSignal));
  });

  it("cannot let an old reader overwrite the replacement reader", async () => {
    const recorded: RideSummary = {
      ...RIDE,
      rideId: "ride_recorded_rec_6" as RideSummary["rideId"],
      title: "Recorded ride",
      type: "recorded",
      provenanceType: "recorded",
      recordedTrack: {
        summary: { distanceMeters: 20_000, elapsedSeconds: 125, movingSeconds: 102, pointCount: 3 },
        previewGeometry: [{ lon: -75.5, lat: 40 }, { lon: -75.4, lat: 40.1 }],
      },
    };
    let resolveOld: ((value: Awaited<ReturnType<RoadProgressReader["read"]>>) => void) | undefined;
    const oldPending = new Promise<Awaited<ReturnType<RoadProgressReader["read"]>>>((resolve) => {
      resolveOld = resolve;
    });
    const oldReader: RoadProgressReader = { read: vi.fn().mockReturnValue(oldPending) };
    const newReader: RoadProgressReader = {
      read: vi.fn().mockResolvedValue({
        rideId: recorded.rideId,
        qualifiedMeters: 8_000,
        newToYouMeters: 800,
        coverage: "partial",
        historyAvailable: true,
        matchedFeatures: [],
      }),
    };
    const library = service({ listRides: vi.fn().mockResolvedValue([recorded]) });
    const view = render(<RidesLibrary service={library} roadProgressReader={oldReader} />);

    fireEvent.click(await screen.findByRole("button", { name: "View details for Recorded ride" }));
    await waitFor(() => expect(oldReader.read).toHaveBeenCalledOnce());
    view.rerender(<RidesLibrary service={library} roadProgressReader={newReader} />);
    fireEvent.click(screen.getByRole("button", { name: "View details for Recorded ride" }));
    fireEvent.click(screen.getByRole("button", { name: "View details for Recorded ride" }));
    await waitFor(() => expect(screen.getByTestId("recorded-road-progress")).toHaveTextContent("New-to-you: 0.5 mi estimated"));

    resolveOld?.({
      rideId: recorded.rideId,
      qualifiedMeters: 8_000,
      newToYouMeters: 4_000,
      coverage: "partial",
      historyAvailable: true,
      matchedFeatures: [],
    });
    await Promise.resolve();
    expect(screen.getByTestId("recorded-road-progress")).toHaveTextContent("New-to-you: 0.5 mi estimated");
  });

  it("aborts pending road progress when the library unmounts", async () => {
    const recorded: RideSummary = {
      ...RIDE,
      rideId: "ride_recorded_rec_4" as RideSummary["rideId"],
      title: "Recorded ride",
      type: "recorded",
      provenanceType: "recorded",
      recordedTrack: {
        summary: { distanceMeters: 20_000, elapsedSeconds: 125, movingSeconds: 102, pointCount: 3 },
        previewGeometry: [{ lon: -75.5, lat: 40 }, { lon: -75.4, lat: 40.1 }],
      },
    };
    const reader: RoadProgressReader = { read: vi.fn().mockReturnValue(new Promise(() => undefined)) };
    const view = render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([recorded]) })} roadProgressReader={reader} />);
    fireEvent.click(await screen.findByRole("button", { name: "View details for Recorded ride" }));
    await waitFor(() => expect(reader.read).toHaveBeenCalledWith(recorded.rideId, expect.any(AbortSignal)));
    const signal = vi.mocked(reader.read).mock.calls[0]?.[1];
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("uses the shared primary nav with My rides as the current page", () => {
    render(<RidesLibrary service={service()} />);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.textContent).toMatch(/Plan\s*·\s*Explore\s*·\s*My rides/);
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "My rides" })).toHaveAttribute("aria-current", "page");
  });

  it("renders a real row and filters by title without writing while browsing", async () => {
    const library = service();
    render(<RidesLibrary service={library} />);

    expect(await screen.findByRole("textbox", { name: "Rename Pine Loop" })).toHaveValue("Pine Loop");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search rides" }), {
      target: { value: "missing" },
    });
    expect(await screen.findByText("No rides match these filters.")).toBeInTheDocument();
    expect(library.renameRide).not.toHaveBeenCalled();
    expect(library.deleteRide).not.toHaveBeenCalled();
  });

  it("disables an empty inline rename and requires confirmation before delete", async () => {
    const library = service();
    render(<RidesLibrary service={library} />);
    await screen.findByRole("textbox", { name: "Rename Pine Loop" });

    const renameInput = screen.getAllByRole("textbox", { name: "Rename Pine Loop" })[0];
    if (renameInput === undefined) throw new Error("rename input not rendered");
    fireEvent.change(renameInput, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Rename Pine Loop" })).toBeDisabled();
    expect(screen.getByText("A title is required.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Pine Loop" }));
    expect(screen.getByRole("button", { name: "Confirm delete Pine Loop" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Pine Loop" }));
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Rename Pine Loop" })).not.toBeInTheDocument();
    expect(library.deleteRide).not.toHaveBeenCalled();

    // Undo brings the ride back without touching the library.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("textbox", { name: "Rename Pine Loop" })).toBeInTheDocument();
    expect(library.deleteRide).not.toHaveBeenCalled();
  });

  it("deletes for good once the undo window closes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const library = service();
      render(<RidesLibrary service={library} />);
      await screen.findByRole("textbox", { name: "Rename Pine Loop" });
      fireEvent.click(screen.getByRole("button", { name: "Delete Pine Loop" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirm delete Pine Loop" }));
      await screen.findByRole("button", { name: "Undo" });
      await vi.advanceTimersByTimeAsync(8_500);
      await waitFor(() => expect(library.deleteRide).toHaveBeenCalledWith(RIDE.rideId));
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an import's distance, time and notes, never its internal id", async () => {
    const imported: RideSummary = {
      ...RIDE,
      title: "Redacted sample loop",
      type: "imported",
      provenanceType: "import",
      distanceMeters: 20_000,
      durationSeconds: 3_900,
      sourceId: "import_d5fe3bdb-0000",
      importNotes: ["Preserved 4 GPX waypoints as metadata."],
    };
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([imported]) })} />);
    expect(await screen.findByTestId(`ride-facts-${RIDE.rideId}`)).toHaveTextContent("12 mi · 1:05 h");
    fireEvent.click(screen.getByRole("button", { name: "View details for Redacted sample loop" }));
    expect(screen.getByText("Imported from a file")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Import notes for Redacted sample loop" })).toHaveTextContent("Preserved 4 GPX waypoints");
    expect(document.body.textContent).not.toContain("import_d5fe3bdb");
  });

  it("offers Clear filters when a search matches nothing", async () => {
    const library = service();
    vi.mocked(library.listRides).mockImplementation(async (filter) =>
      filter?.text !== undefined && filter.text !== "" ? [] : [RIDE],
    );
    render(<RidesLibrary service={library} />);
    await screen.findByRole("textbox", { name: "Rename Pine Loop" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search rides" }), { target: { value: "nowhere" } });
    fireEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    expect(await screen.findByRole("textbox", { name: "Rename Pine Loop" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search rides" })).toHaveValue("");
  });
});
