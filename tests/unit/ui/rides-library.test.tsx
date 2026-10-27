import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RidesLibrary } from "@/ui/rides/RidesLibrary";
import type { LibraryServicePort, RideSummary } from "@/application/library/library-service";
import type { ImportServicePort } from "@/application/import/import-service";
import type { ParsedImport } from "@/application/import/types";
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

function ride(overrides: Partial<RideSummary>): RideSummary {
  return { ...RIDE, ...overrides };
}

const PARSED_IMPORT = {
  tracks: [
    { name: "Weekend GPX", segments: [[{ lon: -75, lat: 40 }, { lon: -75.001, lat: 40.001 }]], timestamps: [[null, null]], elevation: [[null, null]] },
  ],
  warnings: [],
} as const satisfies ParsedImport;

function importService(): ImportServicePort {
  return {
    previewFile: vi.fn(async () => ({ parsed: PARSED_IMPORT, sizeBytes: 42 })),
    importFile: vi.fn(),
    importSwitchBackBatch: vi.fn().mockResolvedValue({ totalCount: 0, importedCount: 0, files: [] }),
    evaluateTrackSelection: vi.fn(() => ({
      canCombine: false,
      reason: "Select at least two tracks to combine them into one ride.",
    })),
  } as unknown as ImportServicePort;
}

async function expandDetails(title: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: `More actions for ${title}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Details" }));
}

function collapseDetails(title: string): void {
  fireEvent.click(screen.getByRole("button", { name: `More actions for ${title}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Hide details" }));
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
    expect(screen.getByTestId("recorded-ride-summary")).toHaveTextContent("12 mi · 1:42 moving · 2:05 total");
    fireEvent.click(screen.getByRole("button", { name: "More actions for Recorded ride" }));
    expect(screen.getByRole("menuitem", { name: "Download GPX" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: "Other formats" })).not.toBeInTheDocument();
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

    await screen.findByRole("button", { name: "Open Recorded ride" });
    expect(reader.read).not.toHaveBeenCalled();
    await expandDetails("Recorded ride");
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

    await expandDetails("Recorded ride");
    await waitFor(() => expect(reader.read).toHaveBeenCalledWith(recorded.rideId, expect.any(AbortSignal)));
    const signal = vi.mocked(reader.read).mock.calls[0]?.[1];
    collapseDetails("Recorded ride");
    expect(signal?.aborted).toBe(true);
    resolveFirst?.({
      rideId: recorded.rideId,
      qualifiedMeters: 8_000,
      newToYouMeters: 4_000,
      coverage: "partial",
      historyAvailable: true,
      matchedFeatures: [],
    });
    await expandDetails("Recorded ride");
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

    await expandDetails("Recorded ride");
    await waitFor(() => expect(screen.getByTestId("recorded-road-progress")).toHaveTextContent("New-to-you: 2.5 mi estimated"));
    view.rerender(<RidesLibrary service={library} roadProgressReader={secondReader} />);
    expect(screen.queryByText("New-to-you: 2.5 mi estimated")).not.toBeInTheDocument();

    collapseDetails("Recorded ride");
    await expandDetails("Recorded ride");
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

    await expandDetails("Recorded ride");
    await waitFor(() => expect(oldReader.read).toHaveBeenCalledOnce());
    view.rerender(<RidesLibrary service={library} roadProgressReader={newReader} />);
    collapseDetails("Recorded ride");
    await expandDetails("Recorded ride");
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
    await expandDetails("Recorded ride");
    await waitFor(() => expect(reader.read).toHaveBeenCalledWith(recorded.rideId, expect.any(AbortSignal)));
    const signal = vi.mocked(reader.read).mock.calls[0]?.[1];
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("uses the shared primary nav with My rides as the current page", () => {
    render(<RidesLibrary service={service()} />);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.textContent).toMatch(/Plan\s*·\s*Explore\s*·\s*My rides/);
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "My rides" })).toHaveAttribute("aria-current", "page");
  });

  it("opens a ride when its row is tapped", async () => {
    const library = service();
    render(<RidesLibrary service={library} />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Pine Loop" }));
    await waitFor(() => expect(library.openRide).toHaveBeenCalledWith(RIDE.rideId));
    expect(library.renameRide).not.toHaveBeenCalled();
    expect(library.deleteRide).not.toHaveBeenCalled();
  });

  it("splits Planned and Recorded into two newest-first segments", async () => {
    const oldPlan = ride({ rideId: "ride_plan_old" as RideSummary["rideId"], title: "Old plan", updatedAt: "2026-09-01T12:00:00.000Z" });
    const newPlan = ride({ rideId: "ride_plan_new" as RideSummary["rideId"], title: "New plan", updatedAt: "2026-09-18T12:00:00.000Z" });
    const oldRide = ride({
      rideId: "ride_recorded_old" as RideSummary["rideId"],
      title: "Old recording",
      type: "recorded",
      provenanceType: "recorded",
      updatedAt: "2026-09-02T12:00:00.000Z",
      recordedTrack: {
        summary: { distanceMeters: 10_000, elapsedSeconds: 3_000, movingSeconds: 2_400, pointCount: 4 },
        previewGeometry: [{ lon: -75.5, lat: 40 }, { lon: -75.4, lat: 40.1 }],
      },
    });
    const newRide = ride({
      rideId: "ride_recorded_new" as RideSummary["rideId"],
      title: "New recording",
      type: "recorded",
      provenanceType: "recorded",
      updatedAt: "2026-09-20T12:00:00.000Z",
      recordedTrack: {
        summary: { distanceMeters: 20_000, elapsedSeconds: 4_000, movingSeconds: 3_600, pointCount: 4 },
        previewGeometry: [{ lon: -75.5, lat: 40 }, { lon: -75.4, lat: 40.1 }],
      },
    });
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([oldPlan, oldRide, newPlan, newRide]) })} />);

    await screen.findByRole("button", { name: "Open New plan" });
    const labels = () => screen.getAllByRole("button", { name: /^Open / }).map((button) => button.getAttribute("aria-label"));
    expect(labels()).toEqual(["Open New plan", "Open Old plan"]);
    expect(screen.queryByRole("button", { name: "Open New recording" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Recorded" }));
    expect(await screen.findByRole("button", { name: "Open New recording" })).toBeInTheDocument();
    expect(labels()).toEqual(["Open New recording", "Open Old recording"]);
  });

  it("shows the search box only when a segment holds more than eight rides", async () => {
    const eight = Array.from({ length: 8 }, (_, index) => ride({
      rideId: `ride_short_${index}` as RideSummary["rideId"],
      title: `Short ride ${index}`,
      updatedAt: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    }));
    const short = render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue(eight) })} />);
    await screen.findByRole("button", { name: "Open Short ride 0" });
    expect(screen.queryByRole("searchbox", { name: "Search rides" })).not.toBeInTheDocument();
    short.unmount();

    const nine = [...eight, ride({
      rideId: "ride_short_8" as RideSummary["rideId"],
      title: "Short ride 8",
      updatedAt: "2026-09-09T12:00:00.000Z",
    })];
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue(nine) })} />);
    expect(await screen.findByRole("searchbox", { name: "Search rides" })).toBeInTheDocument();
  });

  it("searches a long library and clears the search without writing", async () => {
    const library = service({ listRides: vi.fn().mockResolvedValue(
      Array.from({ length: 9 }, (_, index) => ride({
        rideId: `ride_search_${index}` as RideSummary["rideId"],
        title: index === 0 ? "Pine Loop" : `Other ride ${index}`,
        updatedAt: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
      })),
    ) });
    render(<RidesLibrary service={library} />);

    await screen.findByRole("searchbox", { name: "Search rides" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search rides" }), { target: { value: "nowhere" } });
    expect(await screen.findByText("No rides match this search.")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search rides" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(await screen.findByRole("button", { name: "Open Pine Loop" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search rides" })).toHaveValue("");
    expect(library.renameRide).not.toHaveBeenCalled();
    expect(library.deleteRide).not.toHaveBeenCalled();
  });

  it("keeps the empty library to one line and one button", async () => {
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([]) })} />);

    const heading = await screen.findByRole("heading", { name: "No saved rides yet" });
    const emptyState = heading.closest("section");
    expect(emptyState).not.toBeNull();
    expect(within(emptyState!).getByRole("link", { name: "Plan a ride" })).toHaveAttribute("href", "/");
    expect(within(emptyState!).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "Search rides" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Planned" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    // The upload card's own heading is gone: the secure file input still exists.
    expect(screen.getByLabelText("Import GPX, KML, or KMZ")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Upload your GPX ride" })).not.toBeInTheDocument();
  });

  it("opens the file picker from the header and keeps the older import quiet", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click");
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([]) })} importService={importService()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Import GPX" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Import GPX, KML, or KMZ")).toBeInTheDocument();

    // The SwitchBack import is a link at the foot of the page, not a third card.
    const legacy = screen.getByText("Import from an older version");
    expect(legacy.closest("details")).not.toBeNull();
    click.mockRestore();
  });

  it("starts the import flow with a file dropped on the empty state", async () => {
    const imports = importService();
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([]) })} importService={imports} />);

    const heading = await screen.findByRole("heading", { name: "No saved rides yet" });
    const emptyState = heading.closest("section");
    expect(emptyState).not.toBeNull();
    const file = new File([new TextEncoder().encode("gpx")], "weekend.gpx", { type: "application/gpx+xml" });
    fireEvent.drop(emptyState!, { dataTransfer: { files: [file] } });

    expect(await screen.findByRole("heading", { name: "Choose tracks" })).toBeInTheDocument();
    expect(imports.previewFile).toHaveBeenCalledWith(file, expect.anything());
  });

  it("renames a ride from the overflow menu", async () => {
    const library = service();
    render(<RidesLibrary service={library} />);

    fireEvent.click(await screen.findByRole("button", { name: "More actions for Pine Loop" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: "Rename Pine Loop" });
    fireEvent.change(input, { target: { value: "Pine Loop renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(library.renameRide).toHaveBeenCalledWith(RIDE.rideId, "Pine Loop renamed"));
  });

  it("requires a title, confirms delete in the page, and offers undo", async () => {
    const library = service();
    render(<RidesLibrary service={library} />);
    await screen.findByRole("button", { name: "Open Pine Loop" });

    fireEvent.click(screen.getByRole("button", { name: "More actions for Pine Loop" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const renameInput = await screen.findByRole("textbox", { name: "Rename Pine Loop" });
    fireEvent.change(renameInput, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("A title is required.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("button", { name: "Open Pine Loop" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More actions for Pine Loop" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Confirm delete Pine Loop" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Pine Loop" }));
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Pine Loop" })).not.toBeInTheDocument();
    expect(library.deleteRide).not.toHaveBeenCalled();

    // Undo brings the ride back without touching the library.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("button", { name: "Open Pine Loop" })).toBeInTheDocument();
    expect(library.deleteRide).not.toHaveBeenCalled();
  });

  it("deletes for good once the undo window closes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const library = service();
      render(<RidesLibrary service={library} />);
      await screen.findByRole("button", { name: "Open Pine Loop" });
      fireEvent.click(screen.getByRole("button", { name: "More actions for Pine Loop" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
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
    expect(await screen.findByTestId(`ride-facts-${RIDE.rideId}`)).toHaveTextContent("12 mi · 1 h 5 min");
    await expandDetails("Redacted sample loop");
    expect(screen.getByText("From a file")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Import notes for Redacted sample loop" })).toHaveTextContent("Preserved 4 GPX waypoints");
    expect(document.body.textContent).not.toContain("import_d5fe3bdb");
  });

  it("puts the day, distance and time on one line and leaves the paperwork behind details", async () => {
    const planned: RideSummary = {
      ...RIDE,
      distanceMeters: 20_000,
      durationSeconds: 3_900,
      area: "Lehigh Valley",
    };
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([planned]) })} />);

    const facts = await screen.findByTestId(`ride-facts-${planned.rideId}`);
    expect(facts).toHaveTextContent("Sep 17, 2026");
    expect(facts).toHaveTextContent("12 mi");
    expect(facts).toHaveTextContent("1 h 5 min");
    expect(facts.textContent ?? "").not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(document.querySelector(".og-library__badge")).toBeNull();
    expect(screen.queryByTestId(`offline-pack-${planned.rideId}`)).toBeNull();

    await expandDetails("Pine Loop");
    expect(screen.queryByTestId(`offline-pack-${planned.rideId}`)).toBeNull();
  });

  it("shows known offline state in plain words and says nothing when it is unknown", async () => {
    const saved = ride({
      rideId: "ride_offline_saved" as RideSummary["rideId"],
      title: "Saved offline ride",
      offlinePack: "present",
      updatedAt: "2026-09-18T12:00:00.000Z",
    });
    const unsaved = ride({
      rideId: "ride_offline_unsaved" as RideSummary["rideId"],
      title: "Online only ride",
      offlinePack: "not-present",
      updatedAt: "2026-09-17T12:00:00.000Z",
    });
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([saved, unsaved]) })} />);

    await expandDetails("Saved offline ride");
    expect(screen.getByTestId(`offline-pack-${saved.rideId}`)).toHaveTextContent("Saved for offline");
    await expandDetails("Online only ride");
    expect(screen.getByTestId(`offline-pack-${unsaved.rideId}`)).toHaveTextContent("Not saved for offline");
    expect(document.body.textContent).not.toContain("Offline pack");
  });

  it("reads provenance in the same plain words everywhere in My rides", async () => {
    const catalog = ride({
      rideId: "ride_catalog" as RideSummary["rideId"],
      title: "Explore route",
      type: "catalog-derivative",
      provenanceType: "catalog",
      updatedAt: "2026-09-19T12:00:00.000Z",
    });
    const shared = ride({
      rideId: "ride_shared" as RideSummary["rideId"],
      title: "Shared route",
      type: "shared-derivative",
      provenanceType: "shared",
      updatedAt: "2026-09-18T12:00:00.000Z",
    });
    const opened = ride({
      rideId: "ride_opened" as RideSummary["rideId"],
      title: "Opened route",
      provenanceType: "derived",
      updatedAt: "2026-09-17T12:00:00.000Z",
    });
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([catalog, shared, opened]) })} />);

    await expandDetails("Explore route");
    expect(screen.getByText("From Explore")).toBeInTheDocument();
    await expandDetails("Shared route");
    expect(screen.getByText("Shared with you")).toBeInTheDocument();
    await expandDetails("Opened route");
    expect(screen.getByText("Opened from My rides")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Catalog derivative");
    expect(document.body.textContent).not.toContain("Shared derivative");
    expect(document.body.textContent).not.toContain("Copied from another ride");
  });

  it("opens Share from the overflow menu and loads the ride once", async () => {
    const recorded = ride({
      rideId: "ride_share_1" as RideSummary["rideId"],
      title: "Shared loop",
      type: "recorded",
      provenanceType: "recorded",
      exportCapabilities: { plannedRoute: false, track: false, original: false, recordedRide: true },
      recordedTrack: {
        summary: { distanceMeters: 20_000, elapsedSeconds: 125, movingSeconds: 102, pointCount: 3 },
        previewGeometry: [{ lon: -75.5, lat: 40 }, { lon: -75.4, lat: 40.1 }],
      },
    });
    const loadExportSource = vi.fn().mockResolvedValue({
      title: "Shared loop",
      createdTime: "2026-09-17T12:00:00.000Z",
      plannedRoute: null,
      tracks: [],
      trackGeometry: {},
      waypoints: [],
      originalBytes: null,
      originalFilename: null,
      originalMime: null,
      recordedTrack: {
        coordinates: [{ lon: -75.5, lat: 40 }, { lon: -75.4, lat: 40.1 }],
        timestamps: ["2026-09-17T12:00:00.000Z", "2026-09-17T12:01:00.000Z"],
        summary: { distanceMeters: 20_000, elapsedSeconds: 60, movingSeconds: 60, pointCount: 2 },
      },
    });
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([recorded]), loadExportSource })} />);

    await screen.findByRole("button", { name: "Open Shared loop" });
    fireEvent.click(screen.getByRole("button", { name: "More actions for Shared loop" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));

    expect(await screen.findByRole("button", { name: "Share it" })).toBeInTheDocument();
    expect(loadExportSource).toHaveBeenCalledTimes(1);
    expect(loadExportSource).toHaveBeenCalledWith(recorded.rideId);
  });
});
describe("RidesLibrary planned-ride export", () => {
  it("keeps Download GPX disabled when the ride has nothing exportable", async () => {
    render(<RidesLibrary service={service({ listRides: vi.fn().mockResolvedValue([RIDE]) })} />);
    await screen.findByRole("button", { name: "Open Pine Loop" });
    fireEvent.click(screen.getByRole("button", { name: "More actions for Pine Loop" }));
    expect(screen.getByRole("menuitem", { name: "Download GPX" })).toBeDisabled();
    expect(screen.queryByRole("menuitem", { name: "Other formats" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^export/i })).not.toBeInTheDocument();
  });

  it("exports a planned ride from the route line stored with it", async () => {
    const planned: RideSummary = {
      ...RIDE,
      exportCapabilities: { plannedRoute: true, track: false, original: false, recordedRide: false },
    };
    const geometry = [
      { lon: -75, lat: 40 },
      { lon: -75.1, lat: 40.1 },
      { lon: -75.2, lat: 40.2 },
    ] as const;
    const loadExportSource = vi.fn().mockResolvedValue({
      title: "Pine Loop",
      createdTime: "2026-09-17T12:00:00.000Z",
      plannedRoute: {
        geometry,
        waypoints: [
          { name: "Ranger station", coordinate: geometry[0] },
          { name: null, coordinate: geometry[2] },
        ],
      },
      tracks: [],
      trackGeometry: {},
      waypoints: [],
      originalBytes: null,
      originalFilename: null,
      originalMime: null,
      recordedTrack: null,
    });
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:export";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    render(<RidesLibrary service={service({
      listRides: vi.fn().mockResolvedValue([planned]),
      loadExportSource,
    })} />);

    fireEvent.click(await screen.findByRole("button", { name: "More actions for Pine Loop" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download GPX" }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Pine Loop" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Other formats" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /gpx route/i }));
    await waitFor(() => expect(blobs).toHaveLength(2));

    const trackXml = await blobs[0]!.text();
    const routeXml = await blobs[1]!.text();
    expect(trackXml).toContain("<trk>");
    expect(trackXml).toContain("<wpt");
    expect(trackXml).toContain("<name>Ranger station</name>");
    expect(trackXml).toContain("<time>2026-09-17T12:00:00.000Z</time>");
    expect(routeXml).toContain("<rte>");
    expect(routeXml).not.toContain("<trk>");
    expect(loadExportSource).toHaveBeenCalledWith(planned.rideId);
    vi.restoreAllMocks();
  });
});
