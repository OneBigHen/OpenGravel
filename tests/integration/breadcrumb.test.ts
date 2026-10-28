import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createRideDocument } from "@/domain/ride/create";
import { newCommandId } from "@/domain/ride/ids";
import { applyRideCommand } from "@/domain/ride/reducer";
import { straightBreadcrumb } from "@/domain/breadcrumb/route";
import { breadcrumbLine, breadcrumbMeasurements } from "@/application/breadcrumb/measurements";
import { saveBacktrack } from "@/application/breadcrumb/backtrack";
import { buildElevationProfile, sampleLine } from "@/application/elevation/profile";
import { buildPlannedTrackGpx } from "@/application/export/gpx-export";
import { createLibraryService } from "@/application/library/library-service";
import { startBreadcrumbFromPlanner } from "@/application/ride-session/ride-focus-handoff";
import { createRideSessionController } from "@/application/ride-session/ride-session-controller";
import { VNextDatabase } from "@/infrastructure/storage/db";
import { createIndexedDbGeometryStore } from "@/infrastructure/storage/indexeddb-geometry-store";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";
import { createRideSessionRepository } from "@/infrastructure/storage/ride-session-repository";
import { createLocalStorageRideFocusPointer } from "@/infrastructure/storage/ride-focus-pointer";

const points = [{ id: "a", name: "Lookout", coordinate: { lat: 40.62, lon: -75.98 } }, { id: "b", coordinate: { lat: 40.625, lon: -75.98 } }, { id: "c", coordinate: { lat: 40.63, lon: -75.98 } }];
const now = "2026-10-27T12:00:00.000Z";

function fixture() {
  const name = `breadcrumb-${crypto.randomUUID()}`;
  const db = new VNextDatabase(name);
  return { db, rides: createRideRepository({ database: db }), geometry: createIndexedDbGeometryStore({ databaseName: name }) };
}

function authored() {
  const document = createRideDocument({ now });
  const result = applyRideCommand(document, { type: "breadcrumb.set", commandId: newCommandId(), rideId: document.rideId, baseRevision: 0, source: "map", label: "Breadcrumb", breadcrumb: straightBreadcrumb(points) }, { now });
  if (result.outcome !== "applied") throw new Error("Could not create test route");
  return result.document;
}

describe("breadcrumb end-to-end data", () => {
  it("calculates walking time and steepness from sampled elevation, while preserving unknowns", () => {
    const route = straightBreadcrumb(points);
    const samples = sampleLine(breadcrumbLine(route), 20);
    const profile = buildElevationProfile(samples, samples.map((sample) => sample.distanceMeters * 0.4));
    const measured = breadcrumbMeasurements(route, profile);
    expect(measured.legs.every((leg) => leg.maxGradePercent! > 30)).toBe(true);
    expect(measured.timeSeconds).toBeGreaterThan(0);
    expect(breadcrumbMeasurements(route, null)).toMatchObject({ maxGradePercent: null, timeSeconds: null });
  });
  it("saves and exports the authored line and named waypoints", async () => {
    const { rides, geometry } = fixture();
    const document = authored();
    const line = breadcrumbLine(document.intent.breadcrumb!);
    const library = createLibraryService(rides, { geometryStore: geometry });
    const saved = await library.saveNamed(document, { title: "Ridge", plannedRoute: { geometry: line } });
    const source = await library.loadExportSource(saved.document.rideId);
    expect(source.plannedRoute?.geometry).toEqual(line);
    expect(source.plannedRoute?.waypoints).toHaveLength(3);
    expect(buildPlannedTrackGpx({ title: "Ridge", ...source.plannedRoute! })).toContain("<name>Lookout</name>");
    expect((await library.openRide(saved.document.rideId)).intent.breadcrumb).toEqual(document.intent.breadcrumb);
  });
  it("binds a local track session and reverses the recorded line into an undoable route", async () => {
    window.localStorage.clear();
    const { db, rides, geometry } = fixture();
    const document = authored();
    const pointer = createLocalStorageRideFocusPointer();
    const session = createRideSessionController({ repository: createRideSessionRepository({ database: db }) });
    const started = await startBreadcrumbFromPlanner({ document, rides, geometry, pointer, controller: session, now });
    expect(started.outcome).toBe("started");
    expect(session.snapshot()?.activity).toBe("track");
    const savedPointer = pointer.read();
    expect(savedPointer.status === "found" && savedPointer.pointer.breadcrumbWaypoints).toHaveLength(3);
    const coordinates = points.map((point) => point.coordinate);
    const back = await saveBacktrack({ rideId: document.rideId, coordinates, rides, geometry, now });
    expect(back.line).toEqual([...coordinates].reverse());
    const loaded = await rides.loadRide(document.rideId);
    expect(loaded?.ok && loaded.document.intent.breadcrumb?.legs[0]?.kind).toBe("recorded");
    expect(loaded?.ok && loaded.document.history.entries.at(-1)?.label).toBe("Back to start");
  });
});
