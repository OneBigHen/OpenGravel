import { describe, expect, it } from "vitest";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import { isSketchPreviewBundle, previewSketchIntent } from "@/application/planner/sketch-preview";
import { createRideDocument } from "@/domain/ride/create";
import { newRideId } from "@/domain/ride/ids";

const NOW = "2026-09-27T12:00:00.000Z";
const STROKE = [
  { lon: -75.9, lat: 40.4 },
  { lon: -75.89, lat: 40.405 },
  { lon: -75.88, lat: 40.4 },
];

describe("previewSketchIntent (OGV-D-285)", () => {
  it("plans a copy of the ride's intent with the draft as its sketch, leaving the ride alone", async () => {
    const document = createRideDocument({ rideId: newRideId(), now: NOW });
    const geometryStore = createMemoryGeometryStore();
    const preview = await previewSketchIntent({
      document,
      strokes: [STROKE],
      endpointPolicy: "derive",
      geometryStore,
    });

    expect(preview).not.toBeNull();
    expect(document.intent.sketch).toBeNull();
    const sketch = preview?.intent.sketch;
    expect(sketch?.endpointPolicy).toBe("derive");
    expect(preview?.geometryRefs).toEqual([...(sketch?.rawStrokeRefs ?? []), sketch?.corridorRef]);
    for (const ref of preview?.geometryRefs ?? []) {
      await expect(geometryStore.get(ref)).resolves.not.toBeNull();
    }
  });

  it("is null for a draft that is not a sketch yet", async () => {
    const document = createRideDocument({ rideId: newRideId(), now: NOW });
    const preview = await previewSketchIntent({
      document,
      strokes: [[STROKE[0]!]],
      endpointPolicy: "derive",
      geometryStore: createMemoryGeometryStore(),
    });
    expect(preview).toBeNull();
  });
});

describe("isSketchPreviewBundle", () => {
  it("recognises a preview by the planning generation it ran under", () => {
    expect(isSketchPreviewBundle({ planningGeneration: 4 }, [2, 4])).toBe(true);
    expect(isSketchPreviewBundle({ planningGeneration: 5 }, [2, 4])).toBe(false);
    expect(isSketchPreviewBundle(null, [2, 4])).toBe(false);
  });
});
