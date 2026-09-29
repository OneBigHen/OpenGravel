import { describe, expect, it } from "vitest";

import {
  DEFAULT_BIKE,
  createRideDocument,
  defaultRideIntent,
} from "@/domain/ride/create";
import {
  asGeometryRef,
  asRoadEntityId,
  newAvoidAreaId,
  newCommandId,
  newHistoryEntryId,
  newPointId,
  newRideId,
  newRoadSpanId,
  newShapingId,
  newSketchId,
  newStopId,
  type AvoidAreaId,
  type GeometryRef,
  type RideId,
  type RoadSpanId,
  type ShapingId,
  type StopId,
} from "@/domain/ride/ids";
import {
  SCHEMA_VERSION,
  type Coordinate,
  type RideIntent,
  type ShapingPoint,
  type SketchIntent,
  type StopPoint,
  type SurfaceIntent,
  type TimeIntent,
} from "@/domain/ride/types";
import {
  validateCoordinate,
  validateRideIntent,
  validateSurfaceIntent,
  validateTimeIntent,
} from "@/domain/ride/validate";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAP_PROVENANCE = {
  type: "map",
  selectedAt: "2026-01-01T00:00:00.000Z",
} as const;

/**
 * Every object/array reachable from `value` that is not frozen, as a path list.
 * An empty list is the deep-frozen assertion (03-DOMAIN-MODEL §2 authored truth
 * is immutable once created).
 */
function unfrozenNodes(value: unknown, path = "$"): string[] {
  if (typeof value !== "object" || value === null) return [];
  const here = Object.isFrozen(value) ? [] : [path];
  if (Array.isArray(value)) {
    return value.reduce<string[]>(
      (paths, entry, index) => paths.concat(unfrozenNodes(entry, `${path}[${index}]`)),
      here,
    );
  }
  return Object.entries(value).reduce<string[]>(
    (paths, [key, entry]) => paths.concat(unfrozenNodes(entry, `${path}.${key}`)),
    here,
  );
}

function makeStop(id: StopId, label: string): StopPoint {
  return {
    id,
    kind: "stop",
    coordinate: { lon: -76.5, lat: 40.1 },
    label,
    arrivalIntent: "fuel",
    provenance: MAP_PROVENANCE,
  };
}

function makeSketch(): SketchIntent {
  return {
    id: newSketchId(),
    rawStrokeRefs: [asGeometryRef("geom_stroke_1")],
    corridorRef: asGeometryRef("geom_corridor_1"),
    topologyHints: [{ kind: "near-loop", at: { lon: -75.44, lat: 40.14 }, strokeIndices: [0] }],
    endpointPolicy: "derive",
  };
}

/** A fully-populated, legal intent — the acceptance counterpart to the defaults. */
function legalIntent(): RideIntent {
  return {
    ...defaultRideIntent(),
    shape: "loop",
    start: {
      id: newPointId(),
      kind: "start",
      coordinate: { lon: -76.5, lat: 40.1 },
      label: "Home",
      provenance: MAP_PROVENANCE,
    },
    finish: {
      id: newPointId(),
      kind: "finish",
      coordinate: { lon: -76.4, lat: 40.2 },
      provenance: {
        type: "search",
        provider: "nominatim",
        placeId: "W123",
        query: "Wilkes-Barre",
      },
    },
    stops: [makeStop(newStopId(), "Fuel stop")],
    shaping: [
      {
        id: newShapingId(),
        kind: "shape",
        coordinate: { lon: -76.45, lat: 40.15 },
        source: "map-drag",
      },
    ],
    time: { kind: "returnBy", localTime: "18:30", date: "2026-05-01", toleranceMinutes: 30 },
    departure: { kind: "future", at: "2026-05-01T13:00:00.000Z" },
    roadCharacter: "curvy",
    surface: {
      preference: "mixed",
      targetUnpavedShare: { min: 0.1, target: 0.3, max: 0.5 },
      unknownSurfacePolicy: "allow-with-warning",
    },
    terrain: { level: "moderate" },
    traffic: "protect-ride",
    avoidHighways: false,
    tollPolicy: "avoid",
    avoidAreas: [
      {
        id: newAvoidAreaId(),
        name: "Mud season",
        geometryRef: asGeometryRef("geom_avoid_1"),
        enabled: true,
        createdBy: "drawing",
      },
    ],
    roadSpans: [
      {
        id: newRoadSpanId(),
        mode: "prefer",
        direction: "either",
        roadEntityId: asRoadEntityId("road_1"),
        geometryRef: asGeometryRef("geom_span_1"),
        anchorRefs: [{ lon: -76.45, lat: 40.15 }],
      },
    ],
    sketch: makeSketch(),
    longTrip: { staged: true, notes: "refined by Task 7.5" },
  };
}

function intentWith(patch: Partial<RideIntent>): RideIntent {
  return { ...defaultRideIntent(), ...patch };
}

/** Simulates untrusted imported/persisted input reaching runtime validation. */
function surfaceFromImport(value: unknown): SurfaceIntent {
  return value as SurfaceIntent;
}

describe("domain ID factories (03-DOMAIN-MODEL §1)", () => {
  const FACTORIES: [string, () => string][] = [
    ["ride_", newRideId],
    ["stop_", newStopId],
    ["shape_", newShapingId],
    ["avoid_", newAvoidAreaId],
    ["span_", newRoadSpanId],
    ["cmd_", newCommandId],
    ["hist_", newHistoryEntryId],
    ["pt_", newPointId],
    ["sketch_", newSketchId],
  ];

  it.each(FACTORIES)("mints %s-prefixed identifiers", (prefix, factory) => {
    const id = factory();

    expect(id.startsWith(prefix)).toBe(true);
    expect(id).toMatch(
      new RegExp(`^${prefix}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`),
    );
  });

  it.each(FACTORIES)("mints unique %s identifiers", (_prefix, factory) => {
    const samples = Array.from({ length: 100 }, () => factory());

    expect(new Set(samples).size).toBe(100);
  });

  it("brands are compile-time distinct from plain strings", () => {
    const rideId = newRideId();
    const stopId = newStopId();

    expect(rideId).toMatch(/^ride_[0-9a-f-]{36}$/);
    expect(stopId).toMatch(/^stop_[0-9a-f-]{36}$/);

    // @ts-expect-error — a plain string is not a branded RideId.
    const rawRideId: RideId = "ride_not-branded";
    // @ts-expect-error — a plain string is not a branded StopId.
    const rawStopId: StopId = "stop_not-branded";
    // @ts-expect-error — a plain string is not a branded GeometryRef.
    const rawGeometryRef: GeometryRef = "geom_not-branded";

    expect([rawRideId, rawStopId, rawGeometryRef]).toEqual([
      "ride_not-branded",
      "stop_not-branded",
      "geom_not-branded",
    ]);
  });

  it("asGeometryRef casts an existing store handle without minting a new one", () => {
    const ref = asGeometryRef("geom_from_store");

    expect(ref).toBe("geom_from_store");
  });

  it("asRoadEntityId casts an existing road identity", () => {
    expect(asRoadEntityId("road_42")).toBe("road_42");
  });
});

describe("createRideDocument (03-DOMAIN-MODEL §2)", () => {
  it("creates a schema-1 revision-0 document with ISO timestamps and new provenance", () => {
    const document = createRideDocument();

    expect(document.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);
    expect(document.revision).toBe(0);
    expect(document.rideId).toMatch(/^ride_/);
    expect(document.createdAt).toMatch(ISO_TIMESTAMP);
    expect(document.updatedAt).toBe(document.createdAt);
    expect(document.title).toBeNull();
    expect(document.provenance).toEqual({ type: "new" });
    expect(document.history).toEqual({
      entries: [],
      cursor: -1,
      baseIntent: defaultRideIntent(),
      appliedProposalIds: [],
    });
    expect(document.intent).toEqual(defaultRideIntent());
  });

  it("honors explicit overrides", () => {
    const rideId = newRideId();
    const document = createRideDocument({
      rideId,
      now: "2026-05-01T12:00:00.000Z",
      title: "Alpine loop",
      provenance: { type: "import", sourceId: "gpx-1" },
    });

    expect(document.rideId).toBe(rideId);
    expect(document.createdAt).toBe("2026-05-01T12:00:00.000Z");
    expect(document.updatedAt).toBe("2026-05-01T12:00:00.000Z");
    expect(document.title).toBe("Alpine loop");
    expect(document.provenance).toEqual({ type: "import", sourceId: "gpx-1" });
  });

  it("represents a ride recreated from a track (03-DOMAIN-MODEL §28)", () => {
    const document = createRideDocument({
      provenance: { type: "recreated-from-track", sourceId: "track_9" },
    });

    expect(document.provenance).toEqual({
      type: "recreated-from-track",
      sourceId: "track_9",
    });
  });

  it("mints a distinct ride id per document", () => {
    expect(createRideDocument().rideId).not.toBe(createRideDocument().rideId);
  });

  it("returns a deeply frozen document", () => {
    const document = createRideDocument();

    expect(unfrozenNodes(document)).toEqual([]);
    expect(Reflect.set(document, "title", "mutated")).toBe(false);
    expect(Reflect.set(document.intent.bike, "fuelRangeMiles", 1)).toBe(false);
    expect(Reflect.set(document.history, "cursor", 0)).toBe(false);
  });
});

describe("defaultRideIntent (03-DOMAIN-MODEL §3)", () => {
  it("returns the documented product defaults", () => {
    expect(defaultRideIntent()).toEqual({
      shape: "destination",
      start: null,
      finish: null,
      stops: [],
      shaping: [],
      time: { kind: "none" },
      departure: { kind: "now" },
      roadCharacter: "balanced",
      surface: { preference: "mixed", unknownSurfacePolicy: "allow-with-warning" },
      terrain: { level: "moderate" },
      traffic: "protect-ride",
      avoidHighways: false,
      tollPolicy: "avoid",
      bike: DEFAULT_BIKE,
      avoidAreas: [],
      roadSpans: [],
      sketch: null,
      longTrip: null,
    });
  });

  it("snapshots the default bike constraint", () => {
    expect(DEFAULT_BIKE).toEqual({
      bikeId: "default",
      category: "touring",
      fuelRangeMiles: 150,
      reserveMiles: 30,
      maintainedGravel: "allow",
      roughTracks: "avoid",
      unknownSurface: "allow-with-warning",
    });
    expect(Object.isFrozen(DEFAULT_BIKE)).toBe(true);
  });

  it("seeds a new ride from the chosen garage bike snapshot", () => {
    const bike = { ...DEFAULT_BIKE, bikeId: "bike_short", fuelRangeMiles: 60, reserveMiles: 10 };
    const document = createRideDocument({ bike, now: "2026-09-24T12:00:00.000Z" });
    expect(document.intent.bike).toEqual(bike);
    expect(document.history.baseIntent.bike).toEqual(bike);
    expect(createRideDocument().intent.bike).toEqual(DEFAULT_BIKE);
  });

  it("hands out a fresh, frozen intent per call", () => {
    const first = defaultRideIntent();
    const second = defaultRideIntent();

    expect(first).not.toBe(second);
    expect(first.bike).toBe(DEFAULT_BIKE);
    expect(unfrozenNodes(first)).toEqual([]);
  });
});

describe("coordinate validation", () => {
  it("accepts an in-range coordinate", () => {
    expect(validateCoordinate({ lon: 0, lat: 0 })).toEqual([]);
    expect(validateCoordinate({ lon: 180, lat: 90 })).toEqual([]);
    expect(validateCoordinate({ lon: -180, lat: -90 })).toEqual([]);
  });

  it.each<[string, Coordinate, RegExp]>([
    ["lat above 90", { lon: 0, lat: 91 }, /latitude/],
    ["lat below -90", { lon: 0, lat: -91 }, /latitude/],
    ["lon above 180", { lon: 181, lat: 0 }, /longitude/],
    ["lon below -180", { lon: -181, lat: 0 }, /longitude/],
    ["NaN latitude", { lon: 0, lat: Number.NaN }, /latitude/],
    ["non-finite longitude", { lon: Number.POSITIVE_INFINITY, lat: 0 }, /longitude/],
  ])("rejects %s with an axis-specific issue", (_label, coordinate, axis) => {
    expect(validateCoordinate(coordinate)).toEqual([
      expect.stringMatching(axis),
    ]);
  });
});

describe("time intent validation (03-DOMAIN-MODEL §6)", () => {
  it("accepts every well-formed variant", () => {
    expect(validateTimeIntent({ kind: "none" })).toEqual([]);
    expect(
      validateTimeIntent({ kind: "budget", targetMinutes: 1, toleranceMinutes: 0 }),
    ).toEqual([]);
    expect(
      validateTimeIntent({
        kind: "returnBy",
        localTime: "23:59",
        date: "2026-02-28",
        toleranceMinutes: 45,
      }),
    ).toEqual([]);
    expect(
      validateTimeIntent({
        kind: "arriveBy",
        localTime: "00:00",
        date: "2028-02-29",
        toleranceMinutes: 0,
      }),
    ).toEqual([]);
  });

  it.each<[string, TimeIntent, RegExp]>([
    ["a zero budget", { kind: "budget", targetMinutes: 0, toleranceMinutes: 10 }, /budget targetMinutes/],
    ["a negative budget", { kind: "budget", targetMinutes: -5, toleranceMinutes: 10 }, /budget targetMinutes/],
    ["a negative budget tolerance", { kind: "budget", targetMinutes: 60, toleranceMinutes: -1 }, /budget toleranceMinutes/],
    ["an impossible date", { kind: "returnBy", localTime: "09:00", date: "2026-13-40", toleranceMinutes: 0 }, /returnBy date/],
    ["a nonexistent calendar day", { kind: "returnBy", localTime: "09:00", date: "2026-02-30", toleranceMinutes: 0 }, /returnBy date/],
    ["a malformed date", { kind: "returnBy", localTime: "09:00", date: "01/05/2026", toleranceMinutes: 0 }, /returnBy date/],
    ["an out-of-range clock time", { kind: "arriveBy", localTime: "25:99", date: "2026-05-01", toleranceMinutes: 0 }, /arriveBy localTime/],
    ["a malformed clock time", { kind: "arriveBy", localTime: "9am", date: "2026-05-01", toleranceMinutes: 0 }, /arriveBy localTime/],
    ["a negative arrival tolerance", { kind: "arriveBy", localTime: "09:00", date: "2026-05-01", toleranceMinutes: -1 }, /arriveBy toleranceMinutes/],
  ])("rejects %s with the failing field in the message", (_label, time, fragment) => {
    expect(validateTimeIntent(time)).toEqual([expect.stringMatching(fragment)]);
  });
});

describe("surface intent validation (03-DOMAIN-MODEL §8)", () => {
  const base = {
    preference: "mixed",
    unknownSurfacePolicy: "allow-with-warning",
  } as const;

  it("accepts a well-formed preference envelope", () => {
    expect(validateSurfaceIntent({ ...base })).toEqual([]);
    expect(
      validateSurfaceIntent({
        ...base,
        targetUnpavedShare: { min: 0, target: 0.3, max: 1 },
      }),
    ).toEqual([]);
    expect(validateSurfaceIntent({ ...base, targetUnpavedShare: { min: 0.2 } })).toEqual([]);
  });

  it.each<[string, SurfaceIntent, RegExp]>([
    ["a share above 1", { ...base, targetUnpavedShare: { target: 1.2 } }, /unpaved share target/],
    ["a negative share", { ...base, targetUnpavedShare: { min: -0.1 } }, /unpaved share min/],
    ["min above max", { ...base, targetUnpavedShare: { min: 0.8, max: 0.2 } }, /must not exceed max/],
    ["a target outside the envelope", { ...base, targetUnpavedShare: { min: 0.1, max: 0.2, target: 0.9 } }, /must be within/],
    ["an unknown preference", surfaceFromImport({ ...base, preference: "moon-dust" }), /surface preference/],
  ])("rejects %s with the failing field in the message", (_label, surface, fragment) => {
    expect(validateSurfaceIntent(surface)).toEqual([
      expect.stringMatching(fragment),
    ]);
  });
});

describe("ride intent validation (03-DOMAIN-MODEL §3)", () => {
  it("accepts the default intent", () => {
    expect(validateRideIntent(defaultRideIntent())).toEqual([]);
  });

  it("accepts a fully-populated legal intent", () => {
    expect(validateRideIntent(legalIntent())).toEqual([]);
  });

  it("accepts a half-formed destination ride", () => {
    const halfFormed = intentWith({
      shape: "destination",
      start: {
        id: newPointId(),
        kind: "start",
        coordinate: { lon: -76.5, lat: 40.1 },
        provenance: MAP_PROVENANCE,
      },
      finish: null,
    });

    expect(validateRideIntent(halfFormed)).toEqual([]);
  });

  it("aggregates nested time and surface issues", () => {
    const issues = validateRideIntent(
      intentWith({
        time: { kind: "budget", targetMinutes: 0, toleranceMinutes: -1 },
        surface: { preference: "mixed", targetUnpavedShare: { target: 2 }, unknownSurfacePolicy: "allow-with-warning" },
      }),
    );

    expect(issues).toHaveLength(3);
  });

  it("rejects duplicate stop ids", () => {
    const stopId = newStopId();
    const issues = validateRideIntent(
      intentWith({
        stops: [makeStop(stopId, "first"), makeStop(stopId, "second")],
      }),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/duplicate stop id/i);
  });

  it("rejects duplicate shaping point ids", () => {
    const shapingId = newShapingId();
    const issues = validateRideIntent(
      intentWith({
        shaping: [
          { id: shapingId, kind: "shape", coordinate: { lon: 0, lat: 0 }, source: "map-drag" },
          { id: shapingId, kind: "shape", coordinate: { lon: 1, lat: 1 }, source: "search" },
        ],
      }),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/duplicate shaping/i);
  });

  it("rejects duplicate avoid area ids", () => {
    const areaId = newAvoidAreaId();
    const area = {
      id: areaId,
      name: null,
      geometryRef: asGeometryRef("geom_avoid_1"),
      enabled: true,
      createdBy: "drawing",
    } as const;

    const issues = validateRideIntent(intentWith({ avoidAreas: [area, area] }));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/duplicate avoid area/i);
  });

  it("rejects duplicate road span ids", () => {
    const spanId = newRoadSpanId();
    const span = {
      id: spanId,
      mode: "avoid",
      direction: "either",
      geometryRef: asGeometryRef("geom_span_1"),
      anchorRefs: [],
    } as const;

    const issues = validateRideIntent(intentWith({ roadSpans: [span, span] }));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/duplicate road span/i);
  });

  it("keeps distinct ids and distinct collections independent", () => {
    const intent = intentWith({
      stops: [makeStop(newStopId(), "first"), makeStop(newStopId(), "second")],
      shaping: [
        { id: newShapingId(), kind: "shape", coordinate: { lon: 0, lat: 0 }, source: "map-drag" },
      ],
    });

    expect(validateRideIntent(intent)).toEqual([]);
  });
});

describe("structural intent validation (03-DOMAIN-MODEL §3–§13)", () => {
  it("reports nested start coordinates with their intent slot", () => {
    const issues = validateRideIntent(
      intentWith({
        start: {
          id: newPointId(),
          kind: "start",
          coordinate: { lon: 181, lat: 91 },
          provenance: MAP_PROVENANCE,
        },
      }),
    );

    expect(issues).toContainEqual(
      expect.stringMatching(/^start\.coordinate\.lon:/),
    );
    expect(issues).toContainEqual(
      expect.stringMatching(/^start\.coordinate\.lat:/),
    );
  });

  it("validates every nested coordinate slot", () => {
    const issues = validateRideIntent(
      intentWith({
        finish: {
          id: newPointId(),
          kind: "finish",
          coordinate: { lon: 0, lat: 91 },
          provenance: MAP_PROVENANCE,
        },
        stops: [{ ...makeStop(newStopId(), "bad"), coordinate: { lon: 181, lat: 0 } }],
        shaping: [
          {
            id: newShapingId(),
            kind: "shape",
            coordinate: { lon: 0, lat: 91 },
            source: "map-drag",
          },
        ],
        roadSpans: [
          {
            id: newRoadSpanId(),
            mode: "prefer",
            direction: "either",
            geometryRef: asGeometryRef("geom_span_1"),
            anchorRefs: [{ lon: 0, lat: 91 }],
          },
        ],
      }),
    );

    expect(issues).toContainEqual(
      expect.stringMatching(/^finish\.coordinate\.lat:/),
    );
    expect(issues).toContainEqual(
      expect.stringMatching(/^stops\[0\]\.coordinate\.lon:/),
    );
    expect(issues).toContainEqual(
      expect.stringMatching(/^shaping\[0\]\.coordinate\.lat:/),
    );
    expect(issues).toContainEqual(
      expect.stringMatching(/^roadSpans\[0\]\.anchorRefs\[0\]\.lat:/),
    );
  });

  it.each([Number.POSITIVE_INFINITY, Number.NaN, Number.NEGATIVE_INFINITY])(
    "rejects the non-finite time number %s",
    (value) => {
      expect(
        validateTimeIntent({
          kind: "budget",
          targetMinutes: value,
          toleranceMinutes: 0,
        }),
      ).toEqual([expect.stringMatching(/budget targetMinutes/)]);
      expect(
        validateTimeIntent({
          kind: "budget",
          targetMinutes: 60,
          toleranceMinutes: value,
        }),
      ).toEqual([expect.stringMatching(/budget toleranceMinutes/)]);
      expect(
        validateTimeIntent({
          kind: "returnBy",
          localTime: "09:00",
          date: "2026-05-01",
          toleranceMinutes: value,
        }),
      ).toEqual([expect.stringMatching(/returnBy toleranceMinutes/)]);
    },
  );

  it("rejects a non-finite unpaved-share bound", () => {
    expect(
      validateSurfaceIntent({
        preference: "mixed",
        unknownSurfacePolicy: "allow-with-warning",
        targetUnpavedShare: { target: Number.POSITIVE_INFINITY },
      }),
    ).toEqual([expect.stringMatching(/unpaved share target/)]);
    expect(
      validateSurfaceIntent({
        preference: "mixed",
        unknownSurfacePolicy: "allow-with-warning",
        targetUnpavedShare: { min: Number.NaN },
      }),
    ).toEqual([expect.stringMatching(/unpaved share min/)]);
  });

  it("returns an issue for an unknown time kind instead of throwing", () => {
    const unknownKind = { kind: "surprise" } as unknown as TimeIntent;

    expect(validateTimeIntent(unknownKind)).toEqual([
      expect.stringMatching(/not a known time intent/),
    ]);
    expect(validateRideIntent(intentWith({ time: unknownKind }))).toContainEqual(
      expect.stringMatching(/not a known time intent/),
    );
  });

  it("rejects out-of-vocabulary intent discriminants", () => {
    const untrusted = intentWith({
      shape: "spiral" as unknown as RideIntent["shape"],
      roadCharacter: "mud" as unknown as RideIntent["roadCharacter"],
      terrain: { level: "extreme" } as unknown as RideIntent["terrain"],
      traffic: "ignore" as unknown as RideIntent["traffic"],
      tollPolicy: "free" as unknown as RideIntent["tollPolicy"],
      departure: { kind: "someday" } as unknown as RideIntent["departure"],
    });
    const issues = validateRideIntent(untrusted);

    expect(issues).toContainEqual(expect.stringMatching(/^shape /));
    expect(issues).toContainEqual(expect.stringMatching(/^roadCharacter /));
    expect(issues).toContainEqual(expect.stringMatching(/^terrain\.level /));
    expect(issues).toContainEqual(expect.stringMatching(/^traffic /));
    expect(issues).toContainEqual(expect.stringMatching(/^tollPolicy /));
    expect(issues).toContainEqual(expect.stringMatching(/^departure\.kind /));
  });

  it("rejects a point whose kind does not match its slot", () => {
    const issues = validateRideIntent(
      intentWith({
        start: {
          id: newPointId(),
          kind: "finish",
          coordinate: { lon: 0, lat: 0 },
          provenance: MAP_PROVENANCE,
        },
        finish: {
          id: newPointId(),
          kind: "start",
          coordinate: { lon: 0, lat: 0 },
          provenance: MAP_PROVENANCE,
        },
        stops: [
          {
            id: newStopId(),
            kind: "shape",
            coordinate: { lon: 0, lat: 0 },
            provenance: MAP_PROVENANCE,
          } as unknown as StopPoint,
        ],
        shaping: [
          {
            id: newShapingId(),
            kind: "stop",
            coordinate: { lon: 0, lat: 0 },
            source: "map-drag",
          } as unknown as ShapingPoint,
        ],
      }),
    );

    expect(issues).toContainEqual(expect.stringMatching(/^start\.kind /));
    expect(issues).toContainEqual(expect.stringMatching(/^finish\.kind /));
    expect(issues).toContainEqual(expect.stringMatching(/^stops\[0\]\.kind /));
    expect(issues).toContainEqual(expect.stringMatching(/^shaping\[0\]\.kind /));
  });

  it("rejects ids with the wrong prefix for their collection", () => {
    const issues = validateRideIntent(
      intentWith({
        stops: [
          {
            id: "pt_wrong" as unknown as StopId,
            kind: "stop",
            coordinate: { lon: 0, lat: 0 },
            provenance: MAP_PROVENANCE,
          },
        ],
        shaping: [
          {
            id: "stop_wrong" as unknown as ShapingId,
            kind: "shape",
            coordinate: { lon: 0, lat: 0 },
            source: "map-drag",
          },
        ],
        avoidAreas: [
          {
            id: "shape_wrong" as unknown as AvoidAreaId,
            name: null,
            geometryRef: asGeometryRef("geom_1"),
            enabled: true,
            createdBy: "drawing",
          },
        ],
        roadSpans: [
          {
            id: "avoid_wrong" as unknown as RoadSpanId,
            mode: "prefer",
            direction: "either",
            geometryRef: asGeometryRef("geom_2"),
            anchorRefs: [],
          },
        ],
      }),
    );

    expect(issues).toContainEqual(
      expect.stringMatching(/^stops\[0\]\.id .*must start with "stop_"/),
    );
    expect(issues).toContainEqual(
      expect.stringMatching(/^shaping\[0\]\.id .*must start with "shape_"/),
    );
    expect(issues).toContainEqual(
      expect.stringMatching(/^avoidAreas\[0\]\.id .*must start with "avoid_"/),
    );
    expect(issues).toContainEqual(
      expect.stringMatching(/^roadSpans\[0\]\.id .*must start with "span_"/),
    );
  });
});
