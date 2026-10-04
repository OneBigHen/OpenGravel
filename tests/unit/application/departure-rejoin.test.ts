import { describe, expect, it } from "vitest";

import {
  applyDepartureRejoinPlan,
  assessDepartureRejoin,
  departureRejoinRequestIncompatibility,
  planDepartureRejoin,
} from "@/application/planner/departure-rejoin";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";

function at(lon: number, lat = 40): Coordinate {
  return { lon, lat };
}

function baseline(): readonly Coordinate[] {
  return Array.from({ length: 21 }, (_, index) =>
    at(-75.5 + index * 0.01),
  );
}

function corridor(): readonly Coordinate[] {
  return [
    at(-75.46, 40.0005),
    at(-75.45, 40.006),
    at(-75.44, 40.010),
    at(-75.43, 40.008),
    at(-75.42, 40.003),
    at(-75.41, 40.0004),
  ];
}

function request(
  overrides: Partial<ProviderRouteRequest> = {},
): ProviderRouteRequest {
  return {
    requestId: "req_depart_rejoin",
    origin: at(-75.5),
    destination: at(-75.3),
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

describe("departure-and-rejoin corridor generator", () => {
  it("finds an ordered middle replacement and bounded shaping sequence", () => {
    const plan = planDepartureRejoin(
      baseline(),
      corridor(),
      {
        maxConnectorMeters: 1_500,
        minimumReplacedBaselineMeters: 2_000,
        maxShapingAnchors: 4,
      },
    );

    expect(plan).not.toBeNull();
    expect(plan!.departureIndex).toBeLessThan(plan!.rejoinIndex);
    expect(plan!.replacedBaselineMeters).toBeGreaterThan(2_000);
    expect(plan!.entryConnectorMeters).toBeLessThan(1_500);
    expect(plan!.exitConnectorMeters).toBeLessThan(1_500);
    expect(plan!.shaping[0]).toEqual(plan!.departure);
    expect(plan!.shaping.at(-1)).toEqual(plan!.rejoin);
    expect(plan!.shaping.length).toBeLessThanOrEqual(6);
  });

  it("reverses the source corridor when only reverse orientation progresses along baseline", () => {
    const reverseSource = [...corridor()].reverse();
    const plan = planDepartureRejoin(
      baseline(),
      reverseSource,
      {
        maxConnectorMeters: 1_500,
        minimumReplacedBaselineMeters: 2_000,
      },
    );

    expect(plan).not.toBeNull();
    expect(plan!.direction).toBe("reverse");
    expect(plan!.corridor[0]!.lon).toBeLessThan(plan!.corridor.at(-1)!.lon);
  });

  it("rejects corridors too far from the baseline", () => {
    const far = corridor().map((point) => ({
      lon: point.lon,
      lat: point.lat + 0.2,
    }));

    expect(
      planDepartureRejoin(baseline(), far, {
        maxConnectorMeters: 1_000,
      }),
    ).toBeNull();
  });

  it("rejects replacements that are too small to be meaningful", () => {
    const tiny = [
      at(-75.45, 40.0002),
      at(-75.44, 40.002),
    ];

    expect(
      planDepartureRejoin(baseline(), tiny, {
        maxConnectorMeters: 1_000,
        minimumReplacedBaselineMeters: 5_000,
      }),
    ).toBeNull();
  });

  it("fails closed around authored route truth and round-trip discovery", () => {
    expect(
      departureRejoinRequestIncompatibility(
        request({ stops: [at(-75.4)] }),
      ),
    ).toBe("authored-stops");
    expect(
      departureRejoinRequestIncompatibility(
        request({
          discovery: {
            targetMinutes: 90,
            toleranceMinutes: 10,
          },
        }),
      ),
    ).toBe("discovery-round-trip");
  });

  it("builds a single shaped provider request without mutating the original", () => {
    const original = request();
    const plan = planDepartureRejoin(
      baseline(),
      corridor(),
      {
        maxConnectorMeters: 1_500,
        minimumReplacedBaselineMeters: 2_000,
      },
    );
    expect(plan).not.toBeNull();

    const shaped = applyDepartureRejoinPlan(original, plan!);

    expect(shaped).not.toBeNull();
    expect(shaped!.shaping).toEqual(plan!.shaping);
    expect(shaped!.options.includeAlternatives).toBe(false);
    expect(original.shaping).toEqual([]);
    expect(original.options.includeAlternatives).toBe(true);
  });

  it("measures both corridor use and preservation of the unaffected baseline", () => {
    const base = baseline();
    const plan = planDepartureRejoin(
      base,
      corridor(),
      {
        maxConnectorMeters: 1_500,
        minimumReplacedBaselineMeters: 2_000,
      },
    );
    expect(plan).not.toBeNull();

    const routed = [
      ...base.slice(0, plan!.departureIndex + 1),
      ...plan!.corridor,
      ...base.slice(plan!.rejoinIndex),
    ];

    const assessment = assessDepartureRejoin(routed, base, plan!);

    expect(assessment).not.toBeNull();
    expect(assessment!.corridorAdherenceShare).toBeGreaterThan(0.9);
    expect(assessment!.preservedBaselineShare).toBeGreaterThan(0.9);
  });

  it("exposes when the router used the corridor but discarded the baseline outside it", () => {
    const base = baseline();
    const plan = planDepartureRejoin(
      base,
      corridor(),
      {
        maxConnectorMeters: 1_500,
        minimumReplacedBaselineMeters: 2_000,
      },
    );
    expect(plan).not.toBeNull();

    const routed = [
      at(-75.5, 40.03),
      plan!.departure,
      ...plan!.corridor,
      plan!.rejoin,
      at(-75.3, 40.03),
    ];

    const assessment = assessDepartureRejoin(routed, base, plan!);

    expect(assessment).not.toBeNull();
    expect(assessment!.corridorAdherenceShare).toBeGreaterThan(0.9);
    expect(assessment!.preservedBaselineShare).toBeLessThan(0.8);
  });

  it("never sends two coincident anchors when the corridor starts on a baseline vertex", () => {
    // Library rides are engine reroutes, so they can share exact vertices with
    // the baseline; coincident vias produce a repeated vertex that canonical
    // eligibility rejects.
    const sharing = [at(-75.46), ...corridor().slice(1), at(-75.40)];
    const plan = planDepartureRejoin(baseline(), sharing);
    expect(plan).not.toBeNull();
    const shaping = plan?.shaping ?? [];
    for (let index = 1; index < shaping.length; index += 1) {
      expect(shaping[index]).not.toEqual(shaping[index - 1]);
    }
  });
});

