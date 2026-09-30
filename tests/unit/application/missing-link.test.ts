import { describe, expect, it } from "vitest";

import {
  assessMissingLinkConnector,
  buildMissingLinkRoute,
  planMissingLink,
} from "@/application/planner/missing-link";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import type { LibraryCorridorSource } from "@/application/planner/library-corridor-probes";
import type { Coordinate } from "@/domain/ride/types";

function at(lon: number, lat = 40): Coordinate {
  return { lon, lat };
}

function request(
  overrides: Partial<ProviderRouteRequest> = {},
): ProviderRouteRequest {
  return {
    requestId: "req_missing_link",
    origin: at(-75.55),
    destination: at(-75.20),
    stops: [],
    shaping: [],
    profile: "motorcycle_scenic",
    avoidPolygons: [],
    options: {
      includeAlternatives: true,
      avoidHighways: false,
      tollPolicy: "allow-with-warning",
      vehicle: "motorcycle",
    },
    ...overrides,
  };
}

function source(
  id: string,
  startLon: number,
  endLon: number,
  lat = 40,
): LibraryCorridorSource {
  return {
    id,
    geometry: Array.from({ length: 11 }, (_, index) =>
      at(startLon + ((endLon - startLon) * index) / 10, lat),
    ),
  };
}

describe("missing-link discovery", () => {
  it("orients and orders two corridors around the smallest useful gap", () => {
    const first = source("west", -75.50, -75.42);
    const second = source("east", -75.38, -75.30);

    const plan = planMissingLink(
      request(),
      first,
      second,
      {
        maxGapMeters: 6_000,
        minimumCorridorMeters: 3_000,
      },
    );

    expect(plan).not.toBeNull();
    expect(plan!.firstSourceId).toBe("west");
    expect(plan!.secondSourceId).toBe("east");
    expect(plan!.firstDirection).toBe("forward");
    expect(plan!.secondDirection).toBe("forward");
    expect(plan!.gapStart.lon).toBeCloseTo(-75.42);
    expect(plan!.gapEnd.lon).toBeCloseTo(-75.38);
    expect(plan!.gapDirectMeters).toBeLessThan(6_000);
  });

  it("creates a connector-only request with no inherited positive route claim", () => {
    const plan = planMissingLink(
      request(),
      source("a", -75.50, -75.42),
      source("b", -75.38, -75.30),
      { maxGapMeters: 6_000 },
    );
    expect(plan).not.toBeNull();

    expect(plan!.connectorRequest).toMatchObject({
      origin: plan!.gapStart,
      destination: plan!.gapEnd,
      stops: [],
      shaping: [],
      profile: "motorcycle_scenic",
      options: {
        includeAlternatives: false,
      },
    });
  });

  it("rejects distant corridor pairs before spending a provider call", () => {
    const plan = planMissingLink(
      request(),
      source("a", -75.50, -75.42),
      source("far", -75.10, -75.02),
      { maxGapMeters: 5_000 },
    );

    expect(plan).toBeNull();
  });

  it("fails closed when authored route truth would be reordered", () => {
    expect(
      planMissingLink(
        request({ stops: [at(-75.35)] }),
        source("a", -75.50, -75.42),
        source("b", -75.38, -75.30),
      ),
    ).toBeNull();

    expect(
      planMissingLink(
        request({
          discovery: {
            targetMinutes: 90,
            toleranceMinutes: 10,
          },
        }),
        source("a", -75.50, -75.42),
        source("b", -75.38, -75.30),
      ),
    ).toBeNull();
  });

  it("measures connector endpoint fit and route stretch without assigning quality", () => {
    const plan = planMissingLink(
      request(),
      source("a", -75.50, -75.42),
      source("b", -75.38, -75.30),
      { maxGapMeters: 6_000 },
    );
    expect(plan).not.toBeNull();

    const connector = [
      plan!.gapStart,
      at(-75.40, 40.003),
      plan!.gapEnd,
    ];
    const assessment = assessMissingLinkConnector(plan!, connector);

    expect(assessment).not.toBeNull();
    expect(assessment!.endpointFit).toBe(true);
    expect(assessment!.distanceMeters).toBeGreaterThan(
      plan!.gapDirectMeters,
    );
    expect(assessment!.stretchOverDirect).toBeGreaterThanOrEqual(1);
  });

  it("rejects a connector answer whose endpoints do not match the intended gap", () => {
    const plan = planMissingLink(
      request(),
      source("a", -75.50, -75.42),
      source("b", -75.38, -75.30),
      { maxGapMeters: 6_000 },
    );
    expect(plan).not.toBeNull();

    const wrong = [
      at(-75.60, 40.10),
      at(-75.58, 40.10),
    ];
    const assessment = assessMissingLinkConnector(plan!, wrong, 150);

    expect(assessment).not.toBeNull();
    expect(assessment!.endpointFit).toBe(false);
    expect(buildMissingLinkRoute(request(), plan!, wrong)).toBeNull();
  });

  it("builds the full A -> connector -> B shaped request only after connector validation", () => {
    const plan = planMissingLink(
      request(),
      source("a", -75.50, -75.42),
      source("b", -75.38, -75.30),
      {
        maxGapMeters: 6_000,
        maxCorridorAnchors: 3,
        maxConnectorAnchors: 3,
      },
    );
    expect(plan).not.toBeNull();

    const connector: readonly Coordinate[] = [
      plan!.gapStart,
      at(-75.40, 40.003),
      plan!.gapEnd,
    ];
    const combined = buildMissingLinkRoute(
      request(),
      plan!,
      connector,
    );

    expect(combined).not.toBeNull();
    expect(combined!.options.includeAlternatives).toBe(false);
    expect(combined!.shaping.length).toBeGreaterThanOrEqual(6);
    expect(combined!.shaping[0]).toEqual(plan!.firstCorridor[0]);
    expect(combined!.shaping.at(-1)).toEqual(
      plan!.secondCorridor.at(-1),
    );
  });

  it("can reverse source geometry when request direction requires it", () => {
    const westboundRequest = request({
      origin: at(-75.15),
      destination: at(-75.55),
    });

    const plan = planMissingLink(
      westboundRequest,
      source("west", -75.50, -75.42),
      source("east", -75.38, -75.30),
      { maxGapMeters: 6_000 },
    );

    expect(plan).not.toBeNull();
    expect(plan!.firstSourceId).toBe("east");
    expect(plan!.secondSourceId).toBe("west");
    expect(plan!.firstDirection).toBe("reverse");
    expect(plan!.secondDirection).toBe("reverse");
  });
});
