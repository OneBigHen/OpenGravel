/**
 * Route-plan input validation (23-API-CONTRACTS §14).
 *
 * The server rejects malformed input *before* any provider work: bounded
 * coordinate ranges, bounded stops/shaping points, bounded polygon size and a
 * bounded field count over the whole body — an unbounded body is a denial of
 * service on the routing engine, not a routing problem.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_BODY_FIELDS,
  MAX_POLYGON_POINTS,
  MAX_SHAPING_POINTS,
  MAX_STOPS,
  parseRoutePlanRequestBody,
  validateRoutePlanRequestBody,
} from "@/server/planning/validation";

function coordinate(lon: number, lat: number): { lon: number; lat: number } {
  return { lon, lat };
}

function validBody(): Record<string, unknown> {
  return {
    identity: { rideId: "ride_test", rideRevision: 2, planningGeneration: 3 },
    request: {
      requestId: "req_test",
      origin: coordinate(-75.16, 39.95),
      destination: coordinate(-74.8, 40.2),
      stops: [],
      shaping: [],
      profile: "motorcycle_fastest",
      avoidPolygons: [],
      options: {
        includeAlternatives: true,
        avoidHighways: false,
        tollPolicy: "avoid",
        vehicle: "motorcycle",
      },
    },
  };
}

function codes(body: unknown): readonly string[] {
  return validateRoutePlanRequestBody(body).map((issue) => issue.code);
}

describe("validateRoutePlanRequestBody — bounds and shapes", () => {
  it("accepts a well-formed body", () => {
    expect(validateRoutePlanRequestBody(validBody())).toEqual([]);
  });

  it("preserves bounded loop-discovery timebox metadata for the routing provider", () => {
    const body = validBody();
    const request = body["request"] as Record<string, unknown>;
    request["origin"] = coordinate(-75.16, 39.95);
    request["destination"] = coordinate(-75.16, 39.95);
    request["discovery"] = { targetMinutes: 90, toleranceMinutes: 15 };

    const parsed = parseRoutePlanRequestBody(body);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.request.discovery).toEqual({ targetMinutes: 90, toleranceMinutes: 15 });
    }
  });

  it("rejects an unbounded loop-discovery timebox", () => {
    const body = validBody();
    const request = body["request"] as Record<string, unknown>;
    request["destination"] = request["origin"];
    request["discovery"] = { targetMinutes: 900, toleranceMinutes: -1 };

    const issues = validateRoutePlanRequestBody(body);

    expect(issues.map((entry) => entry.path)).toEqual([
      "request.discovery.targetMinutes",
      "request.discovery.toleranceMinutes",
    ]);
  });

  it("rejects discovery metadata on a point-to-point request", () => {
    const body = validBody();
    const request = body["request"] as Record<string, unknown>;
    request["discovery"] = { targetMinutes: 90, toleranceMinutes: 15 };

    expect(validateRoutePlanRequestBody(body).map((entry) => entry.path)).toContain(
      "request.discovery",
    );
  });

  it("rejects a body that is not an object", () => {
    expect(codes(null)).toContain("missing-input");
    expect(codes("route please")).toContain("missing-input");
  });

  it("requires ownership identity", () => {
    const body = validBody();
    delete body["identity"];

    expect(codes(body)).toContain("missing-input");
  });

  it("rejects a malformed ownership identity", () => {
    const body = validBody();
    body["identity"] = { rideId: "", rideRevision: -1, planningGeneration: 1.5 };

    const issues = validateRoutePlanRequestBody(body);

    expect(issues.filter((issue) => issue.code === "invalid-identity")).toHaveLength(3);
  });

  it("rejects coordinates outside WGS84 ranges", () => {
    const body = validBody();
    (body["request"] as Record<string, unknown>)["origin"] = coordinate(-181, 200);

    expect(codes(body)).toContain("invalid-coordinate");
  });

  it("rejects non-finite coordinates", () => {
    const body = validBody();
    (body["request"] as Record<string, unknown>)["destination"] = coordinate(
      Number.NaN,
      40,
    );

    expect(codes(body)).toContain("invalid-coordinate");
  });

  it(`bounds stops at ${MAX_STOPS}`, () => {
    const body = validBody();
    const request = body["request"] as Record<string, unknown>;
    request["stops"] = Array.from({ length: MAX_STOPS + 1 }, (_, index) =>
      coordinate(-75 + index * 0.01, 40),
    );

    expect(codes(body)).toContain("limit-exceeded");
  });

  it(`bounds shaping points at ${MAX_SHAPING_POINTS}`, () => {
    const body = validBody();
    const request = body["request"] as Record<string, unknown>;
    request["shaping"] = Array.from({ length: MAX_SHAPING_POINTS + 1 }, (_, index) =>
      coordinate(-75 + index * 0.001, 40),
    );

    expect(codes(body)).toContain("limit-exceeded");
  });

  it(`bounds an avoid ring at ${MAX_POLYGON_POINTS} points`, () => {
    const body = validBody();
    const request = body["request"] as Record<string, unknown>;
    request["avoidPolygons"] = [
      Array.from({ length: MAX_POLYGON_POINTS + 1 }, (_, index) =>
        coordinate(-75 + index * 0.0001, 40),
      ),
    ];

    expect(codes(body)).toContain("limit-exceeded");
  });

  it(`rejects a body with more than ${MAX_BODY_FIELDS} fields`, () => {
    const body = validBody();
    for (let index = 0; index < MAX_BODY_FIELDS; index += 1) {
      body[`junk_${index}`] = index;
    }

    const issues = validateRoutePlanRequestBody(body);

    expect(issues.map((issue) => issue.code)).toContain("limit-exceeded");
    expect(issues.some((issue) => issue.path === "body")).toBe(true);
  });

  it("requires a non-empty provider profile", () => {
    const body = validBody();
    (body["request"] as Record<string, unknown>)["profile"] = "";

    expect(codes(body)).toContain("invalid-value");
  });

  it("accepts a resolved sketch and narrows it onto the port", () => {
    const body = validBody();
    (body["request"] as Record<string, unknown>)["sketch"] = {
      anchors: [coordinate(-75.0, 40.0), coordinate(-75.02, 40.02)],
      corridor: [coordinate(-75.0, 40.0), coordinate(-75.05, 40.03)],
      endpointPolicy: "derive",
      nearLoop: false,
      topologyHints: [
        {
          kind: "crossing",
          at: coordinate(-75.01, 40.01),
          strokeIndices: [0, 1],
        },
      ],
      derivedEndpoints: {
        start: coordinate(-75.0, 40.0),
        finish: coordinate(-75.05, 40.03),
      },
    };

    expect(validateRoutePlanRequestBody(body)).toEqual([]);
    const parsed = parseRoutePlanRequestBody(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.request.sketch).toEqual({
      anchors: [coordinate(-75.0, 40.0), coordinate(-75.02, 40.02)],
      corridor: [coordinate(-75.0, 40.0), coordinate(-75.05, 40.03)],
      endpointPolicy: "derive",
      nearLoop: false,
      topologyHints: [
        {
          kind: "crossing",
          at: coordinate(-75.01, 40.01),
          strokeIndices: [0, 1],
        },
      ],
      derivedEndpoints: {
        start: coordinate(-75.0, 40.0),
        finish: coordinate(-75.05, 40.03),
      },
    });
  });

  it("rejects a sketch with an unknown hint kind, policy or unbounded anchors", () => {
    const body = validBody();
    (body["request"] as Record<string, unknown>)["sketch"] = {
      anchors: [coordinate(-75.0, 40.0), coordinate(-75.02, 40.02)],
      endpointPolicy: "keep",
      nearLoop: "yes",
      topologyHints: [{ kind: "figure-eight", at: coordinate(-75.01, 40.01) }],
      derivedEndpoints: null,
    };

    const found = codes(body);
    expect(found).toContain("invalid-value");
    expect(validateRoutePlanRequestBody(body).map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        "request.sketch.endpointPolicy",
        "request.sketch.nearLoop",
        "request.sketch.topologyHints[0].kind",
      ]),
    );
  });

  it("requires at least two anchors when a sketch is present", () => {
    const body = validBody();
    (body["request"] as Record<string, unknown>)["sketch"] = {
      anchors: [coordinate(-75.0, 40.0)],
      endpointPolicy: "derive",
      nearLoop: false,
      topologyHints: [],
      derivedEndpoints: null,
    };

    expect(codes(body)).toContain("missing-input");
  });

  it("leaves the request without a sketch member when the body carried none", () => {
    const parsed = parseRoutePlanRequestBody(validBody());

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.request.sketch).toBeUndefined();
    expect("sketch" in parsed.value.request).toBe(false);
  });

  it("rejects a missing request", () => {
    const body = validBody();
    delete body["request"];

    expect(codes(body)).toContain("missing-input");
  });
});

describe("parseRoutePlanRequestBody — validated narrowing", () => {
  it("returns only the contract fields, dropping unknown ones", () => {
    const body = validBody();
    body["junk"] = "ignored";
    (body["request"] as Record<string, unknown>)["extra"] = "ignored too";

    const parsed = parseRoutePlanRequestBody(body);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.value).sort()).toEqual(["identity", "request"]);
    expect(Object.keys(parsed.value.request).sort()).toEqual([
      "avoidPolygons",
      "destination",
      "options",
      "origin",
      "profile",
      "requestId",
      "shaping",
      "stops",
    ]);
    expect(parsed.value.identity).toEqual({
      rideId: "ride_test",
      rideRevision: 2,
      planningGeneration: 3,
    });
  });

  it("reports the issues instead of a value when the body is invalid", () => {
    const parsed = parseRoutePlanRequestBody({});

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.length).toBeGreaterThan(0);
  });
});

describe("rider mode wire validation", () => {
  it("preserves authored constraints and strips internal search controls", () => {
    const body = validBody();
    const options = (body["request"] as Record<string, unknown>)["options"] as Record<string, unknown>;
    Object.assign(options, { traffic: "protect-ride", departureNow: true, targetUnpavedShare: 0.4, bike: { category: "dual-sport", maintainedGravel: "allow", roughTracks: "allow", internalOverride: true }, riderModeFactor: 999, trafficPenaltyPolygons: [] });
    const parsed = parseRoutePlanRequestBody(body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.request.options).toMatchObject({ traffic: "protect-ride", departureNow: true, targetUnpavedShare: 0.4, bike: { category: "dual-sport" } });
      expect(parsed.value.request.options.bike).not.toHaveProperty("internalOverride");
      expect(parsed.value.request.options.riderModeFactor).toBeUndefined();
      expect(parsed.value.request.options.trafficPenaltyPolygons).toBeUndefined();
    }
  });
  it.each([-1, 2, "0.5", NaN])("rejects invalid target %s", targetUnpavedShare => {
    const body = validBody();
    const options = (body["request"] as Record<string, unknown>)["options"] as Record<string, unknown>;
    options["targetUnpavedShare"] = targetUnpavedShare;
    expect(validateRoutePlanRequestBody(body).some(issue => issue.path === "request.options.targetUnpavedShare")).toBe(true);
  });
});
