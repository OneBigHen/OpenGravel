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
  return {
    previewFile: vi.fn(async (_file, options) => {
      options?.onProgress?.({ phase: "parsing", points: 1, tracks: 1, segments: 1 });
      return { parsed: preview, sizeBytes: 3 };
    }),
    importFile: vi.fn(async (_file, options) => {
      options?.onProgress?.({ phase: "complete", points: 4, tracks: 2, segments: 2 });
      return {
        parsed,
        artifact: { artifactId: "import_1", filename: "ride.gpx", mime: "application/gpx+xml", sizeBytes: 1, importedAt: "2026-09-17T12:00:00.000Z", originalRef: "geo_original" as never },
        importData: { originalRef: "geo_original" as never, tracks: [], waypoints: [] },
        documents: [],
        namedRides: [],
        document: {} as never,
        namedRide: {} as never,
        warnings: parsed.warnings,
      };
    }),
    importSwitchBackBatch: vi.fn().mockResolvedValue({ totalCount: 0, importedCount: 0, files: [] }),
    importFileAsBreadcrumb: vi.fn(async (file, options) => {
      const candidate = importBreadcrumbCandidates(preview, { maxWaypoints: options?.maxWaypoints })[0];
      if (candidate === undefined) throw new Error("no breadcrumb candidate");
      return {
        parsed: preview,
        artifact: { artifactId: "import_2", filename: file.name, mime: "application/gpx+xml", sizeBytes: 1, importedAt: "2026-09-17T12:00:00.000Z", originalRef: "geo_original" as never },
        candidate,
        document: {} as never,
        namedRide: {} as never,
        warnings: preview.warnings,
      };
    }),
    evaluateTrackSelection: vi.fn((_parsed: ParsedImport, indices: readonly number[]) => ({
      canCombine: indices.length > 1 && indices.every((index, position) => index === position),
      reason: indices.length > 1 ? "Only adjacent selected tracks within the gap tolerance can be one ride." : "Select at least two tracks to combine them into one ride.",
    })),
  };
}

it("chooses tracks, offers supported route options, and reports progress", async () => {
  const importService = service();
  const bytes = new TextEncoder().encode("gpx");
  const file = new File([bytes], "ride.gpx", { type: "application/gpx+xml" });
  render(<ImportPanel service={importService} />);

  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [file] } });
  await expect(screen.findByText("North")).resolves.toBeInTheDocument();
  expect(screen.getByText("South")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /as one ride/i })).toBeEnabled();
  expect(screen.getByRole("button", { name: /import separately/i })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: /as one ride/i }));
  expect(screen.getByRole("radio", { name: /route along roads/i })).toBeEnabled();
  expect(screen.queryAllByText(/workstreams/i)).toHaveLength(0);
  expect(screen.queryByRole("checkbox", { name: /share with everyone/i })).not.toBeInTheDocument();
  await waitFor(() => expect(importService.previewFile).toHaveBeenCalled());
});

it("dispatches the selected tracks to the import service", async () => {
  const importService = service();
  const file = new File([new TextEncoder().encode("gpx")], "ride.gpx", { type: "application/gpx+xml" });
  render(<ImportPanel service={importService} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [file] } });
  await screen.findByText("North");
  fireEvent.click(screen.getByLabelText("Select South"));
  fireEvent.click(screen.getByRole("button", { name: /import separately/i }));
  fireEvent.click(screen.getByRole("button", { name: "Import selected tracks" }));
  await waitFor(() => expect(importService.importFile).toHaveBeenCalledWith(file, expect.objectContaining({ trackIndices: [0] })));
});

it("keeps a refresh warning beside success without rendering an import error", async () => {
  const importService = service();
  const onImported = vi.fn().mockRejectedValue(new Error("refresh unavailable"));
  const file = new File([new TextEncoder().encode("gpx")], "ride.gpx", { type: "application/gpx+xml" });
  render(<ImportPanel service={importService} onImported={onImported} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [file] } });
  await screen.findByText("North");
  fireEvent.click(screen.getByRole("button", { name: /import separately/i }));
  fireEvent.click(screen.getByRole("button", { name: "Import selected tracks" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Import complete" })).toBeInTheDocument());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("The ride was imported, but the library view could not refresh yet.")).toBeInTheDocument();
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
  const file = new File([new TextEncoder().encode("gpx")], "ride.gpx", { type: "application/gpx+xml" });
  render(<ImportPanel service={importService} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [file] } });
  await screen.findByText("North");
  fireEvent.click(screen.getByRole("button", { name: /import separately/i }));
  importButton = screen.getByRole("button", { name: "Import selected tracks" });
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
  const file = new File([new TextEncoder().encode("gpx")], "north-loop.gpx", { type: "application/gpx+xml" });
  render(<ImportPanel service={service()} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [file] } });
  expect(await screen.findByTestId("import-file-name")).toHaveTextContent("Selected file: north-loop.gpx");
});

it("offers a breadcrumb when the file has waypoints but no track", async () => {
  const importService = service(waypointOnly);
  const file = new File([new TextEncoder().encode("gpx")], "cue-sheet.gpx", { type: "application/gpx+xml" });
  const onImported = vi.fn();
  render(<ImportPanel service={importService} onImported={onImported} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [file] } });
  await screen.findByText("No track in this file");
  expect(screen.getByText("GPX waypoints")).toBeInTheDocument();
  expect(screen.getByText(/straight legs between them/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Open as breadcrumb" }));
  await waitFor(() => expect(importService.importFileAsBreadcrumb).toHaveBeenCalledWith(file, expect.objectContaining({ candidateId: "waypoints" })));
  const result = await screen.findByTestId("breadcrumb-import-result");
  expect(result).toHaveTextContent("Breadcrumb saved");
  expect(result).toHaveTextContent("3 waypoints added to My rides");
  expect(result).toHaveTextContent(/straight\s+lines between waypoints, not roads/i);
  expect(onImported).toHaveBeenCalledTimes(1);
});

it("keeps the waypoint names on the breadcrumb candidates it offers", async () => {
  render(<ImportPanel service={service(waypointOnly)} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [new File(["gpx"], "cue.gpx")] } });
  const options = await screen.findAllByRole("radio", { name: /open .* as a breadcrumb/i });
  expect(options).toHaveLength(1);
  expect(options[0]).toBeChecked();
  expect(screen.getByText("3 waypoints")).toBeInTheDocument();
});

it("offers the single selected track as a breadcrumb without replacing the track import", async () => {
  const importService = service();
  render(<ImportPanel service={importService} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [new File(["gpx"], "ride.gpx")] } });
  await screen.findByText("North");
  fireEvent.click(screen.getByLabelText("Select South"));
  // One track left selected: the breadcrumb alternative appears, the ordinary
  // track import stays the primary choice.
  expect(screen.getByRole("button", { name: "Import separately" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open as breadcrumb" }));
  await waitFor(() => expect(importService.importFileAsBreadcrumb).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ candidateId: "track_0" })));
  expect(await screen.findByTestId("breadcrumb-import-result")).toHaveTextContent("2 waypoints added to My rides");
});

it("offers the file's named waypoints as a breadcrumb beside its tracks", async () => {
  const withWaypoints: ParsedImport = { ...parsed, waypoints: waypointOnly.waypoints };
  const importService = service(withWaypoints);
  render(<ImportPanel service={importService} />);
  fireEvent.change(screen.getByLabelText("Import GPX, KML, or KMZ"), { target: { files: [new File(["gpx"], "track-and-waypoints.gpx")] } });
  await screen.findByText("North");

  // The track import choices stay primary; the named waypoints are an extra way in.
  expect(screen.getByRole("button", { name: "Import separately" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Open GPX waypoints as a breadcrumb" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Open as breadcrumb" }));
  await waitFor(() => expect(importService.importFileAsBreadcrumb).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ candidateId: "waypoints" }),
  ));
});
