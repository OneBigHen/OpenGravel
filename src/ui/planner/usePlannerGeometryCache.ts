import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GeometryStore } from "@/application/geometry/geometry-store";
import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { GeometryRef } from "@/domain/ride/ids";
import type { Coordinate, RideDocument } from "@/domain/ride/types";

export interface PlannerGeometryCache {
  readonly store: GeometryStore;
  readonly readGeometry: (ref: GeometryRef) => GeometryPayload | null;
  readonly sketchStrokeGeometry: readonly (readonly Coordinate[])[];
}

/**
 * Resolves rider-authored geometry handles for planner projection.
 *
 * Missing records stay missing. This cache never fabricates geometry and never
 * mutates RideDocument; provider request validation remains responsible for
 * reporting unresolved authored constraints.
 */
export function usePlannerGeometryCache(input: {
  readonly document: RideDocument;
  readonly geometryStore?: GeometryStore;
  readonly sessionGeometry: Readonly<Record<string, GeometryPayload>>;
}): PlannerGeometryCache {
  const store = useMemo(
    () => input.geometryStore ?? createMemoryGeometryStore(),
    [input.geometryStore],
  );

  const [authoredGeometry, setAuthoredGeometry] = useState<
    Readonly<Record<string, GeometryPayload>>
  >({});

  /**
   * Handles this cache has already asked the store for. A `null` answer is a
   * normal absence (the handle was reclaimed), not a reason to ask again on the
   * next render: without this, an unresolved handle made the load effect retry
   * itself forever, because each attempt wrote a fresh state object.
   */
  const requestedRefs = useRef<Set<GeometryRef>>(new Set());

  const refs = useMemo(() => {
    const sketch = input.document.intent.sketch;
    return [
      ...input.document.intent.avoidAreas.map((area) => area.geometryRef),
      ...input.document.intent.roadSpans.map((span) => span.geometryRef),
      ...(sketch === null
        ? []
        : [...sketch.rawStrokeRefs, sketch.corridorRef]),
    ];
  }, [input.document]);

  useEffect(() => {
    // A different document (or its refs) is a new question: a handle that was
    // absent before may resolve now, so answers are not remembered across it.
    requestedRefs.current = new Set();
  }, [refs]);

  useEffect(() => {
    const missing = refs.filter(
      (ref) => authoredGeometry[ref] === undefined && !requestedRefs.current.has(ref),
    );
    if (missing.length === 0) return;
    for (const ref of missing) requestedRefs.current.add(ref);

    let cancelled = false;
    void Promise.all(
      missing.map(async (ref) => [ref, await store.get(ref)] as const),
    ).then((resolved) => {
      if (cancelled) return;
      const found = resolved.filter((entry) => entry[1] !== null);
      // Nothing resolved: keep the previous state object, so React bails out of
      // the render and this effect is not asked the same question again.
      if (found.length === 0) return;
      setAuthoredGeometry((current) => {
        let changed = false;
        const next: Record<string, GeometryPayload> = { ...current };
        for (const [ref, record] of found) {
          if (record !== null && current[ref] !== record.payload) {
            next[ref] = record.payload;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    });

    return (): void => {
      cancelled = true;
    };
  }, [authoredGeometry, refs, store]);

  const sketchStrokeGeometry = useMemo(() => {
    const sketch = input.document.intent.sketch;
    if (sketch === null) return [];

    const strokes: (readonly Coordinate[])[] = [];
    for (const ref of sketch.rawStrokeRefs) {
      const payload = authoredGeometry[ref];
      if (payload !== undefined && payload.kind === "line") {
        strokes.push(payload.coordinates);
      }
    }
    return strokes;
  }, [authoredGeometry, input.document.intent.sketch]);

  const readGeometry = useCallback(
    (ref: GeometryRef): GeometryPayload | null =>
      authoredGeometry[ref] ?? input.sessionGeometry[ref] ?? null,
    [authoredGeometry, input.sessionGeometry],
  );

  return { store, readGeometry, sketchStrokeGeometry };
}
