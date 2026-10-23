/**
 * The planner geometry cache (02-ARCHITECTURE-CONTRACT §4, OGV-ARC-007).
 *
 * A handle the store does not hold is a normal absence: the ride may name
 * geometry that was reclaimed by the repository's orphan sweep, or lost with a
 * browser storage eviction. The cache must report that absence once and then
 * stop asking, because the effect that loads handles is also re-run by the state
 * it writes: a state write on every attempt (even when nothing resolved) turned
 * one lost handle into an unbounded read/render loop that froze the planner tab.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GeometryStore } from "@/application/geometry/geometry-store";
import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import { authorAvoidArea } from "@/application/planner/avoid-area-authoring";
import { rectangleRing } from "@/application/planner/avoid-area-geometry";
import { createRideDocument } from "@/domain/ride/create";
import { applyRideCommand } from "@/domain/ride/reducer";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import { usePlannerGeometryCache } from "@/ui/planner/usePlannerGeometryCache";

const NOW = "2026-09-17T00:00:00.000Z";
const BASE: Coordinate = { lon: -75.44, lat: 40.14 };

function square(sizeMeters = 300): readonly Coordinate[] {
  const metresPerDegreeLat = 111_320;
  const metresPerDegreeLon =
    metresPerDegreeLat * Math.cos((BASE.lat * Math.PI) / 180);
  return rectangleRing(BASE, {
    lon: BASE.lon + sizeMeters / metresPerDegreeLon,
    lat: BASE.lat + sizeMeters / metresPerDegreeLat,
  });
}

/** Authors one avoid area onto `document`, returning the advanced document. */
async function withArea(
  document: RideDocument,
  store: GeometryStore,
): Promise<RideDocument> {
  const created = await authorAvoidArea({
    document,
    rings: [square()],
    geometryStore: store,
    dispatch: (command) => applyRideCommand(document, command),
  });
  if (created.outcome !== "applied") throw new Error(created.outcome);
  return created.document;
}

/** Counts `get` calls while delegating everything to a real memory store. */
function countingStore(): {
  readonly store: GeometryStore;
  readonly gets: () => number;
} {
  const memory = createMemoryGeometryStore();
  let gets = 0;
  return {
    store: {
      put: (payload, options) => memory.put(payload, options),
      get: (ref) => {
        gets += 1;
        return memory.get(ref);
      },
      has: (ref) => memory.has(ref),
      remove: (ref) => memory.remove(ref),
    },
    gets: () => gets,
  };
}

/** Lets a would-be retry loop run long enough to be visible. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe("usePlannerGeometryCache", () => {
  it("asks once for a handle the store no longer holds and stops", async () => {
    const memory = createMemoryGeometryStore();
    const document = await withArea(createRideDocument({ now: NOW }), memory);
    // The repository's orphan sweep reclaims unreferenced geometry; a restored
    // draft can therefore name a handle nothing can resolve any more.
    const ref = document.intent.avoidAreas[0]?.geometryRef;
    if (ref === undefined) throw new Error("the area was not authored");
    await memory.remove(ref);

    const counting = countingStore();
    const { result, rerender } = renderHook(
      (props: { readonly document: RideDocument }) =>
        usePlannerGeometryCache({
          document: props.document,
          geometryStore: counting.store,
          sessionGeometry: {},
        }),
      { initialProps: { document } },
    );

    await waitFor(() => expect(counting.gets()).toBeGreaterThan(0));
    await settle();
    // A rerender of the same document is the same question: no new read.
    rerender({ document });
    await settle();

    expect(counting.gets()).toBe(1);
    expect(result.current.readGeometry(ref)).toBeNull();
  });

  it("resolves a stored handle once and keeps it cached", async () => {
    const counting = countingStore();
    const document = await withArea(createRideDocument({ now: NOW }), counting.store);
    const ref = document.intent.avoidAreas[0]?.geometryRef;
    if (ref === undefined) throw new Error("the area was not authored");

    const { result, rerender } = renderHook(
      (props: { readonly document: RideDocument }) =>
        usePlannerGeometryCache({
          document: props.document,
          geometryStore: counting.store,
          sessionGeometry: {},
        }),
      { initialProps: { document } },
    );

    await waitFor(() => expect(result.current.readGeometry(ref)).not.toBeNull());
    await settle();
    rerender({ document });
    await settle();

    expect(counting.gets()).toBe(1);
  });

  it("retries an absent handle when the document changes", async () => {
    const memory = createMemoryGeometryStore();
    const first = await withArea(createRideDocument({ now: NOW }), memory);
    const ref = first.intent.avoidAreas[0]?.geometryRef;
    if (ref === undefined) throw new Error("the area was not authored");

    // Answer nothing on the first read, then resolve normally: a repaired store
    // plus a document change is a new question, not a permanent absence.
    const requested: string[] = [];
    const store: GeometryStore = {
      ...memory,
      get: async (target) => {
        requested.push(target);
        return requested.length === 1 ? null : memory.get(target);
      },
    };

    const { result, rerender } = renderHook(
      (props: { readonly document: RideDocument }) =>
        usePlannerGeometryCache({
          document: props.document,
          geometryStore: store,
          sessionGeometry: {},
        }),
      { initialProps: { document: first } },
    );

    await waitFor(() => expect(requested).toHaveLength(1));
    expect(result.current.readGeometry(ref)).toBeNull();

    const second = await withArea(first, memory);
    rerender({ document: second });

    await waitFor(() => expect(result.current.readGeometry(ref)).not.toBeNull());
    // The old handle is asked again (and now resolves), and the new document's
    // second area is asked for the first time.
    expect(requested.filter((target) => target === ref)).toHaveLength(2);
  });
});
