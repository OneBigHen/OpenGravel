import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRideDocument } from "@/domain/ride/create";
import { buildCorridorPackManifest } from "@/domain/offline/capabilities";
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

describe("a ride that was never ended", () => {
  it("offers to open it instead of a dead-end error", async () => {
    const freeRide = vi.fn(async () => ({
      outcome: "rejected" as const,
      sessionId: "session_old" as never,
      message: "A ride is already in progress. Resume it in Ride Focus before starting another.",
    }));
    render(
      <RideActions
        document={createRideDocument({ now: "2026-09-24T12:00:00.000Z" })}
        libraryService={undefined}
        shareService={undefined}
        route={null}
        rideActions={{
          start: vi.fn(async () => ({ outcome: "rejected" as const, sessionId: null, message: "not used" })),
          record: vi.fn(async () => ({ outcome: "ready" as const })),
          freeRide,
        }}
        start={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Free Ride" }));
    expect(await screen.findByTestId("just-ride-unfinished")).toHaveTextContent("never ended");
    expect(screen.getByRole("link", { name: "Open that ride" })).toHaveAttribute("href", "/ride");
    expect(screen.queryByTestId("just-ride-error")).toBeNull();
  });
});

describe("exporting a planned ride from Ride actions", () => {
  const geometry = [
    { lon: -75, lat: 40 },
    { lon: -75.1, lat: 40.1 },
    { lon: -75.2, lat: 40.2 },
  ] as const;

  const route = {
    routeKey: "route_1",
    rideId: "ride_export",
    routeRevision: 0,
    geometry,
    summary: { distanceMeters: 12_000, durationSeconds: 1_800 },
    pack: buildCorridorPackManifest({
      rideId: "ride_export",
      routeRevision: 0,
      geometry,
      createdAt: "2026-10-07T12:00:00.000Z",
    }),
    instructionsAvailable: false,
  };

  function renderActions(document = createRideDocument({ now: "2026-10-07T12:00:00.000Z", title: "Sunday loop" })) {
    return render(
      <RideActions
        document={document}
        libraryService={undefined}
        shareService={undefined}
        route={route}
        start={null}
      />,
    );
  }

  it("offers GPX track and GPX route for the route on screen", () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(screen.getByRole("menuitem", { name: /gpx track/i })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /gpx route/i })).toBeEnabled();
  });

  it("downloads the full line as a track and the bounded line as a route", async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:export";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    renderActions();

    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /gpx track/i }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /gpx route/i }));
    await waitFor(() => expect(blobs).toHaveLength(2));

    const trackXml = await blobs[0]!.text();
    const routeXml = await blobs[1]!.text();
    expect(trackXml).toContain("<trk>");
    expect(trackXml).not.toContain("<rte>");
    expect(routeXml).toContain("<rte>");
    expect(routeXml).not.toContain("<trk>");
    expect(trackXml).toContain("<name>Sunday loop</name>");
    vi.restoreAllMocks();
  });

  it("names an untitled route by date instead of leaving it unnamed", async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:export";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    renderActions(createRideDocument({ now: "2026-10-07T12:00:00.000Z" }));

    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /gpx track/i }));
    await waitFor(() => expect(blobs).toHaveLength(1));

    const xml = await blobs[0]!.text();
    expect(xml).toMatch(/<name>OpenGravel ride \d{4}-\d{2}-\d{2}<\/name>/);
    vi.restoreAllMocks();
  });
});

describe("saving a planned ride keeps its route line", () => {
  const geometry = [
    { lon: -75, lat: 40 },
    { lon: -75.1, lat: 40.1 },
  ] as const;
  const route = {
    routeKey: "route_1",
    rideId: "ride_save",
    routeRevision: 0,
    geometry,
    summary: { distanceMeters: 12_000, durationSeconds: 1_800 },
    pack: buildCorridorPackManifest({
      rideId: "ride_save",
      routeRevision: 0,
      geometry,
      createdAt: "2026-10-07T12:00:00.000Z",
    }),
    instructionsAvailable: false,
  };

  it("hands the selected geometry to saveNamed", async () => {
    const saveNamed = vi.fn<(document: unknown, options: unknown) => Promise<{ document: ReturnType<typeof createRideDocument>; savedAt: string }>>();
    saveNamed.mockResolvedValue({
      document: createRideDocument({ now: "2026-10-07T12:00:00.000Z" }),
      savedAt: "2026-10-07T12:00:00.000Z",
    });
    const base = createRideDocument({ now: "2026-10-07T12:00:00.000Z", title: "Sunday loop" });
    const document = {
      ...base,
      intent: {
        ...base.intent,
        start: {
          id: "pt_start" as never,
          kind: "start" as const,
          coordinate: geometry[0],
          provenance: { type: "map" as const, selectedAt: "2026-10-07T12:00:00.000Z" },
        },
        finish: {
          id: "pt_finish" as never,
          kind: "finish" as const,
          coordinate: geometry[1],
          provenance: { type: "map" as const, selectedAt: "2026-10-07T12:00:00.000Z" },
        },
      },
    };
    render(
      <RideActions
        document={document}
        libraryService={{ saveNamed } as never}
        shareService={undefined}
        route={route}
        start={null}
      />,
    );

    fireEvent.change(screen.getByTestId("named-ride-title"), { target: { value: "Sunday loop" } });
    fireEvent.click(screen.getByTestId("save-named-ride"));

    await waitFor(() => expect(saveNamed).toHaveBeenCalledOnce());
    expect(saveNamed.mock.calls[0]?.[1]).toMatchObject({
      title: "Sunday loop",
      plannedRoute: { geometry },
      bundleSummary: { distanceMeters: 12_000, durationSeconds: 1_800 },
    });
  });
});
