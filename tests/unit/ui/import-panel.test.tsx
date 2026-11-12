import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ImportPanel } from "@/ui/import/ImportPanel";
import type { ImportServicePort } from "@/application/import/import-service";
import { importBreadcrumbCandidates } from "@/application/import/import-breadcrumb";
import type { ParsedImport } from "@/application/import/types";

const parsed = {
  tracks: [
    { name: "North", segments: [[{ lon: -75, lat: 40 }, { lon: -75.001, lat: 40.001 }]], timestamps: [[null, null]], elevation: [[null, null]] },
    { name: "South", segments: [[{ lon: -75.01, lat: 40.01 }, { lon: -75.011, lat: 40.011 }]], timestamps: [[null, null]], elevation: [[null, null]] },
  ],
  warnings: ["A source coordinate was corrected."],
} as const satisfies ParsedImport;

/** One line in the file: the one-tap case. */
const single = {
  tracks: [parsed.tracks[0]],
  warnings: ["Preserved 1 GPX waypoint as metadata; they are not merged into the source track geometry."],
} as const satisfies ParsedImport;

/** A cue sheet: named waypoints and no track at all. */
const waypointOnly = {
  tracks: [],
  warnings: ["Preserved 3 GPX waypoints as metadata; they are not merged into the source track geometry."],
  waypoints: [
    { name: "Trailhead", coordinate: { lon: -75, lat: 40 }, elevation: null, timestamp: null },
    { name: "Named pass", coordinate: { lon: -75.01, lat: 40.01 }, elevation: null, timestamp: null },
    { name: "Water", coordinate: { lon: -75.02, lat: 40.02 }, elevation: null, timestamp: null },
  ],
} as const satisfies ParsedImport;

afterEach(() => cleanup());

function service(preview: ParsedImport = parsed): ImportServicePort {
  function outcomeFor(file: { readonly name: string }) {
    const rides = preview.tracks.map((track, index) => ({
      document: { title: track.name, rideId: `ride_${index}` },
      savedAt: "2026-09-17T12:00:00.000Z",
    }));
    return {
      parsed: preview,
      artifact: {
        artifactId: "import_1",
        filename: file.name,
        mime: "application/gpx+xml",
        sizeBytes: 1,
        importedAt: "2026-09-17T12:00:00.000Z",
        originalRef: "geo_original" as never,
      },
      importData: { originalRef: "geo_original" as never, tracks: [], waypoints: [] },
      documents: rides.map((ride) => ride.document),
      namedRides: rides,
      document: rides[0]?.document ?? {},
      namedRide: rides[0] ?? {},
      warnings: preview.warnings,
    };
  }

  return {
    previewFile: vi.fn(async (_file, options) => {
      options?.onProgress?.({ phase: "parsing", points: 1, tracks: 1, segments: 1 });
      return { parsed: preview, sizeBytes: 3 };
    }),
    importFile: vi.fn(async (file, options) => {
      options?.onProgress?.({ phase: "complete", points: 4, tracks: 2, segments: 2 });
      return outcomeFor(file) as never;
    }),
    importSwitchBackBatch: vi.fn().mockResolvedValue({ totalCount: 0, importedCount: 0, files: [] }),
    importFileAsBreadcrumb: vi.fn(async (file, options) => {
      const candidate = importBreadcrumbCandidates(preview, { maxWaypoints: options?.maxWaypoints })[0];
      if (candidate === undefined) throw new Error("no breadcrumb candidate");
      return {
        parsed: preview,
        artifact: {
          artifactId: "import_2",
          filename: file.name,
          mime: "application/gpx+xml",
          sizeBytes: 1,
          importedAt: "2026-09-17T12:00:00.000Z",
          originalRef: "geo_original" as never,
        },
        candidate,
        document: { title: candidate.name, rideId: "ride_breadcrumb" },
        namedRide: { document: { title: candidate.name, rideId: "ride_breadcrumb" }, savedAt: "2026-09-17T12:00:00.000Z" },
        warnings: preview.warnings,
      } as never;
    }),
    evaluateTrackSelection: vi.fn((_parsed: ParsedImport, indices: readonly number[]) => ({
      canCombine: indices.length > 1 && indices.every((index, position) => index === position),
      reason: indices.length > 1 ? "These tracks are too far apart to be one ride." : "Select at least two tracks to combine them into one ride.",
    })),
  };
}

function gpx(name = "ride.gpx"): File {
  return new File([new TextEncoder().encode("gpx")], name, { type: "application/gpx+xml" });
}

async function pick(importService: ImportServicePort, file = gpx()): Promise<void> {
  render(<ImportPanel service={importService} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [file] } });
}

it("adds a file with one line in one tap and says so in one line", async () => {
  const importService = service(single);
  const onImported = vi.fn();
  const onOpenInPlanner = vi.fn();

  render(<ImportPanel service={importService} onImported={onImported} onOpenInPlanner={onOpenInPlanner} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), {
    target: { files: [gpx("hilltop-loop.gpx")] },
  });

  expect(await screen.findByTestId("import-result")).toHaveTextContent("Added: North, 0.1 mi");
  await waitFor(() => expect(importService.importFile).toHaveBeenCalledWith(
    expect.objectContaining({ name: "hilltop-loop.gpx" }),
    expect.objectContaining({ trackIndices: [0], trackRoute: "follow", importSeparately: true }),
  ));
  expect(onImported).toHaveBeenCalledTimes(1);
  expect(onOpenInPlanner).toHaveBeenCalledWith(expect.anything(), "Added: North, 0.1 mi");
});

it("shows one list and one Add 3 rides button for a file with three lines", async () => {
  const three: ParsedImport = {
    tracks: [
      ...parsed.tracks,
      { name: "West", segments: [[{ lon: -75.02, lat: 40.02 }, { lon: -75.021, lat: 40.021 }]], timestamps: [[null, null]], elevation: [[null, null]] },
    ],
    warnings: [],
  };
  const importService = service(three);
  await pick(importService);
  await screen.findByRole("heading", { name: "Choose tracks" });

  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  const add = screen.getByRole("button", { name: "Add 3 rides" });
  expect(add).toBeEnabled();
  // Nothing else competes with the one choice.
  expect(screen.queryByRole("button", { name: /import separately/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /as one ride/i })).toBeNull();

  fireEvent.click(add);
  await waitFor(() => expect(importService.importFile).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ trackIndices: [0, 1, 2], importSeparately: true }),
  ));
  expect(await screen.findByTestId("import-result")).toHaveTextContent("Added: 3 rides");
});

it("keeps the extra choices behind the closed More import options line", async () => {
  const importService = service(parsed);
  await pick(importService);
  await screen.findByRole("heading", { name: "Choose tracks" });

  for (const word of [/breadcrumb/i, /geometry/i, /metadata/i, /source of truth/i]) {
    expect(screen.queryByText(word)).toBeNull();
  }

  fireEvent.click(screen.getByRole("button", { name: "More import options" }));
  expect(screen.getByRole("radio", { name: /build a road route between its points/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add them as one ride" })).toBeEnabled();
  // One track selected: the points themselves can be opened as a straight-line ride.
  fireEvent.click(screen.getByLabelText("Select South"));
  expect(screen.getByRole("button", { name: "Open as breadcrumb" })).toBeInTheDocument();
});

it("dispatches the selected tracks to the import service", async () => {
  const importService = service();
  await pick(importService);
  await screen.findByRole("heading", { name: "Choose tracks" });
  fireEvent.click(screen.getByLabelText("Select South"));
  expect(screen.getByRole("button", { name: "Add 1 ride" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Add 1 ride" }));
  await waitFor(() => expect(importService.importFile).toHaveBeenCalledWith(
    expect.objectContaining({ name: "ride.gpx" }),
    expect.objectContaining({ trackIndices: [0] }),
  ));
});

it("keeps a refresh warning beside the confirmation without rendering an import error", async () => {
  const importService = service(single);
  const onImported = vi.fn().mockRejectedValue(new Error("refresh unavailable"));
  render(<ImportPanel service={importService} onImported={onImported} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [gpx()] } });
  expect(await screen.findByTestId("import-result")).toHaveTextContent("Added: North");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("The ride was added, but the library view could not refresh yet.")).toBeInTheDocument();
  expect(document.querySelector('[data-warning-code="refresh-failed"]')).toBeInTheDocument();
});

it("aborts the first controller if import is invoked twice", async () => {
  const importService = service();
  const pending: Array<{ readonly signal: AbortSignal }> = [];
  let importButton: HTMLButtonElement | null = null;
  vi.mocked(importService.importFile).mockImplementation((_file, options) => {
    pending.push({ signal: options?.signal as AbortSignal });
    if (pending.length === 1) importButton?.click();
    return new Promise(() => undefined);
  });
  await pick(importService);
  await screen.findByRole("heading", { name: "Choose tracks" });
  importButton = screen.getByRole("button", { name: "Add 2 rides" });
  fireEvent.click(importButton);
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[0]?.signal.aborted).toBe(true);
  expect(pending[1]?.signal.aborted).toBe(false);
});

it("does not let an earlier preview replace an oversized file error", async () => {
  const importService = service();
  let complete: (value: { parsed: ParsedImport; sizeBytes: number }) => void = () => undefined;
  vi.mocked(importService.previewFile).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  render(<ImportPanel service={importService} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [new File(["x"], "ride.gpx")] } });
  const oversized = new File(["x"], "large.gpx");
  Object.defineProperty(oversized, "size", { value: 11 * 1024 * 1024 });
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [oversized] } });
  complete({ parsed, sizeBytes: 1 });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("File is too large"));
  expect(screen.queryByText("North")).not.toBeInTheDocument();
});

it("keeps the native file input visually hidden and opens the picker from the keyboard", () => {
  render(<ImportPanel service={service()} />);
  const input = screen.getByLabelText("Import GPX, KML, or KMZ");
  expect(input).toHaveClass("sr-only");
  expect(screen.getByText(/or drop it here/i)).toBeInTheDocument();

  const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
  try {
    input.focus();
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: " " });
    expect(click).toHaveBeenCalledTimes(2);
  } finally {
    click.mockRestore();
  }
});

it("shows the chosen file's name in the drop zone", async () => {
  render(<ImportPanel service={service()} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [gpx("north-loop.gpx")] } });
  expect(await screen.findByTestId("import-file-name")).toHaveTextContent("Selected file: north-loop.gpx");
});

it("offers a breadcrumb for a file with waypoints but no track", async () => {
  const importService = service(waypointOnly);
  const onImported = vi.fn();
  render(<ImportPanel service={importService} onImported={onImported} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [gpx("cue-sheet.gpx")] } });
  expect(await screen.findByText("No ride line in this file")).toBeInTheDocument();
  // The only way on is the one inside the options, and it is shown, not hidden.
  expect(screen.getByRole("button", { name: "More import options" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("GPX waypoints")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Open as breadcrumb" }));
  await waitFor(() => expect(importService.importFileAsBreadcrumb).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ candidateId: "waypoints" })));
  const result = await screen.findByTestId("breadcrumb-import-result");
  expect(result).toHaveTextContent("Added: 3 points to My rides.");
  expect(result).toHaveTextContent(/straight lines join the points, not roads/i);
  expect(onImported).toHaveBeenCalledTimes(1);
});

it("keeps the waypoint names on the breadcrumb candidates it offers", async () => {
  await pick(service(waypointOnly));
  expect(await screen.findByText("No ride line in this file")).toBeInTheDocument();
  const options = screen.getAllByRole("radio", { name: /open .* as a breadcrumb/i });
  expect(options).toHaveLength(1);
  expect(options[0]).toBeChecked();
  expect(screen.getByText("3 waypoints")).toBeInTheDocument();
});

it("offers the single selected track as a breadcrumb without replacing the track import", async () => {
  const importService = service();
  await pick(importService);
  await screen.findByRole("heading", { name: "Choose tracks" });
  fireEvent.click(screen.getByLabelText("Select South"));
  // One track left selected: the ordinary Add button stays the primary choice.
  expect(screen.getByRole("button", { name: "Add 1 ride" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "More import options" }));
  fireEvent.click(screen.getByRole("button", { name: "Open as breadcrumb" }));
  await waitFor(() => expect(importService.importFileAsBreadcrumb).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ candidateId: "track_0" })));
  expect(await screen.findByTestId("breadcrumb-import-result")).toHaveTextContent("Added: 2 points to My rides.");
});

it("offers the file's named waypoints as a breadcrumb beside its tracks", async () => {
  const withWaypoints: ParsedImport = { ...parsed, waypoints: waypointOnly.waypoints };
  const importService = service(withWaypoints);
  await pick(importService);
  await screen.findByRole("heading", { name: "Choose tracks" });

  // The track import stays primary; the named waypoints are an extra way in.
  expect(screen.getByRole("button", { name: "Add 2 rides" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "More import options" }));
  expect(screen.getByRole("radio", { name: "Open GPX waypoints as a breadcrumb" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Open as breadcrumb" }));
  await waitFor(() => expect(importService.importFileAsBreadcrumb).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ candidateId: "waypoints" }),
  ));
});
