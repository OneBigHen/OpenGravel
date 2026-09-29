import { useCallback, useEffect, useMemo, useState } from "react";

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
    const missing = refs.filter((ref) => authoredGeometry[ref] === undefined);
    if (missing.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missing.map(async (ref) => [ref, await store.get(ref)] as const),
    ).then((resolved) => {
      if (cancelled) return;
      setAuthoredGeometry((current) => {
        const next: Record<string, GeometryPayload> = { ...current };
        for (const [ref, record] of resolved) {
          if (record !== null) next[ref] = record.payload;
        }
        return next;
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
