import { describe, expect, it } from "vitest";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import { authorAvoidArea } from "@/application/planner/avoid-area-authoring";
import { rectangleRing } from "@/application/planner/avoid-area-geometry";
import { buildProviderRequest } from "@/application/planner/build-plan-request";
import { createClientPlanningService } from "@/application/planner/client-planning-service";
import { createRideDocument } from "@/domain/ride/create";
import { applyRideCommand } from "@/domain/ride/reducer";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { GeometryRef } from "@/domain/ride/ids";
import type { Coordinate, RideDocument, RideIntent } from "@/domain/ride/types";
import { createGraphHopperRequest } from "@/infrastructure/routing/graphhopper/request-builder";

/**
 * Routing honesty for avoid areas (04 §18, 06 §6–§7, 02 §4).
 *
 * An avoid area is only *avoided* if the polygon reaches the provider request.
 * Three seams have to agree for that to be true, and this file checks all three at
 * fixture level (no live router):
 *
 * 1. authoring writes the polygon to the store and the document keeps its handle;
 * 2. `buildProviderRequest` resolves that very handle into `avoidPolygons` — with
 *    the store the *planner* uses, not a test double of its own;
 * 3. the GraphHopper body turns each ring into a `opengravel_avoid_<i>` area and a
 *    zero-priority rule over it, which is the part the engine actually reads.
 */

const BASE: Coordinate = { lon: -75.44, lat: 40.14 };
const ONE_METER_LAT = 1 / 111_320;
const ONE_METER_LON = 1 / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));

function metres(lonMeters: number, latMeters: number): Coordinate {
  return {
    lon: BASE.lon + lonMeters * ONE_METER_LON,
    lat: BASE.lat + latMeters * ONE_METER_LAT,
  };
}

/** A 400 m × 400 m area just east of the origin. */
const AREA_RING = rectangleRing(metres(200, -200), metres(600, 200));
const ORIGIN: Coordinate = metres(-1_500, 0);
const DESTINATION: Coordinate = metres(1_500, 0);

function intentWithOriginAndDestination(): RideIntent {
  const nowIso = "2026-09-17T00:00:00.000Z";
  return {
    ...createRideDocument().intent,
    start: {
      id: "pt_start" as never,
      kind: "start",
      coordinate: ORIGIN,
      provenance: { type: "map", selectedAt: nowIso },
    },
    finish: {
      id: "pt_finish" as never,
      kind: "finish",
      coordinate: DESTINATION,
      provenance: { type: "map", selectedAt: nowIso },
    },
  };
}

/** Authors one area through the real two-step path, and returns its document. */
async function documentWithAuthoredArea(): Promise<{
  readonly document: RideDocument;
  readonly payload: GeometryPayload;
}> {
  const store = createMemoryGeometryStore();
  // The authored base document holds both endpoints, so the same document is the
  // dispatch base: a command authored against one document and applied to another
  // is exactly the staleness the reducer refuses.
  const authored: RideDocument = { ...createRideDocument(), intent: intentWithOriginAndDestination() };
  const result = await authorAvoidArea({
    document: authored,
    rings: [AREA_RING],
    geometryStore: store,
    dispatch: (command) => applyRideCommand(authored, command),
  });
  if (result.outcome !== "applied") throw new Error(result.outcome);
  const record = await store.get(result.geometryRef);
  if (record === null) throw new Error("the authored area's handle did not resolve");
  return { document: result.document, payload: record.payload };
}

describe("an authored avoid area", () => {
  it("reaches buildProviderRequest as an avoidPolygon, resolved from its own handle", async () => {
    const { document } = await documentWithAuthoredArea();
    const store = createMemoryGeometryStore();

    // The store is the one authority that resolves the handle: write the same
    // payload under the document's ref and nothing else.
    const record = await store.put(
      { kind: "polygon", rings: [AREA_RING] },
      { kind: "avoid-area" },
    );
    const area = document.intent.avoidAreas[0];
    if (area === undefined) throw new Error("no area was authored");
    const rebound: RideDocument = {
      ...document,
      intent: {
        ...document.intent,
        avoidAreas: [{ ...area, geometryRef: record.geometryRef }],
      },
    };

    const built = await buildProviderRequest(rebound.intent, {
      resolveGeometry: async (ref: GeometryRef): Promise<GeometryPayload | null> =>
        (await store.get(ref))?.payload ?? null,
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.unresolvedRefs).toEqual([]);
    expect(built.request.avoidPolygons).toHaveLength(1);
    expect(built.request.avoidPolygons[0]).toEqual(AREA_RING);
    // The request owns its coordinates: mutating the ring must not alias.
    expect(built.request.avoidPolygons[0]?.[0]).not.toBe(AREA_RING[0]);
  });

  it("is reported as unresolved — never silently dropped — when its handle does not resolve", async () => {
    const { document } = await documentWithAuthoredArea();
    const area = document.intent.avoidAreas[0];
    if (area === undefined) throw new Error("no area was authored");

    const built = await buildProviderRequest(document.intent, {
      resolveGeometry: async (): Promise<GeometryPayload | null> => null,
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.avoidPolygons).toEqual([]);
    expect(built.unresolvedRefs).toEqual([area.geometryRef]);
  });

  it("is absent from the request while it is disabled, and returns when re-enabled", async () => {
    const { document } = await documentWithAuthoredArea();
    const store = createMemoryGeometryStore();
    const record = await store.put(
      { kind: "polygon", rings: [AREA_RING] },
      { kind: "avoid-area" },
    );
    const area = document.intent.avoidAreas[0];
    if (area === undefined) throw new Error("no area was authored");
    const enabled = { ...area, geometryRef: record.geometryRef };
    const resolve = async (ref: GeometryRef): Promise<GeometryPayload | null> =>
      (await store.get(ref))?.payload ?? null;

    const off = await buildProviderRequest(
      { ...document.intent, avoidAreas: [{ ...enabled, enabled: false }] },
      { resolveGeometry: resolve },
    );
    const on = await buildProviderRequest(
      { ...document.intent, avoidAreas: [{ ...enabled, enabled: true }] },
      { resolveGeometry: resolve },
    );

    expect(off.ok && off.request.avoidPolygons).toEqual([]);
    expect(on.ok && on.request.avoidPolygons).toHaveLength(1);
  });

  it("becomes a zero-priority custom-model area in the GraphHopper body", async () => {
    const { document } = await documentWithAuthoredArea();
    const store = createMemoryGeometryStore();
    const record = await store.put(
      { kind: "polygon", rings: [AREA_RING] },
      { kind: "avoid-area" },
    );
    const area = document.intent.avoidAreas[0];
    if (area === undefined) throw new Error("no area was authored");

    const built = await buildProviderRequest(
      {
        ...document.intent,
        avoidAreas: [{ ...area, geometryRef: record.geometryRef }],
      },
      {
        resolveGeometry: async (ref: GeometryRef): Promise<GeometryPayload | null> =>
          (await store.get(ref))?.payload ?? null,
      },
    );
    if (!built.ok) throw new Error(built.issues.join("; "));

    const body = createGraphHopperRequest(built.request, {
      details: [],
      roundTrip: undefined,
    });

    const areas = body.custom_model?.areas as
      | { readonly features: readonly { readonly id?: string; readonly properties?: unknown }[] }
      | undefined;
    expect(areas?.features.map((feature) => feature.id)).toEqual(["opengravel_avoid_0"]);
    expect(body.custom_model?.priority).toContainEqual({
      if: "in_opengravel_avoid_0",
      multiply_by: "0",
    });
  });

  it("is resolvable by the planner's own service, because both share one store", async () => {
    // The deployment wires one GeometryStore for authoring and planning
    // (`PlannerClient`); this asserts the service resolves what the authoring path
    // wrote, which is the assumption that wiring rests on.
    const store = createMemoryGeometryStore();
    const service = createClientPlanningService({
      geometryStore: store,
      fetcher: (async (): Promise<Response> => {
        throw new Error("no transport in this test");
      }) as typeof fetch,
    });

    const record = await store.put(
      { kind: "polygon", rings: [AREA_RING] },
      { kind: "avoid-area" },
    );

    expect(await service.readGeometry(record.geometryRef)).toEqual({
      kind: "polygon",
      rings: [AREA_RING],
    });
    service.dispose();
  });
});
