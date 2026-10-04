import { describe, expect, it } from "vitest";

import {
  applyLibraryCorridorProbe,
  assessLibraryCorridorAdherence,
  libraryCorridorProbeIncompatibility,
  selectLibraryCorridorProbes,
  type LibraryCorridorProbe,
} from "@/application/planner/library-corridor-probes";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";

function line(
  startLon: number,
  endLon: number,
  lat = 40,
  points = 31,
): readonly Coordinate[] {
  return Array.from({ length: points }, (_, index) => ({
    lon: startLon + ((endLon - startLon) * index) / (points - 1),
    lat,
  }));
}

function request(
  overrides: Partial<ProviderRouteRequest> = {},
): ProviderRouteRequest {
  return {
    requestId: "req_library_probe_test",
    origin: { lon: -75.52, lat: 40 },
    destination: { lon: -75.14, lat: 40 },
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

describe("library corridor probes", () => {
  it("extracts a bounded source window with ordered entry and exit anchors", () => {
    const probes = selectLibraryCorridorProbes(
      request(),
      [{ id: "favorite-route", geometry: line(-75.5, -75.2) }],
      {
        targetCorridorMeters: 8_000,
        minimumCorridorMeters: 4_000,
        windowStepMeters: 7_000,
        maxShapingAnchors: 5,
        maxProbes: 1,
      },
    );

    expect(probes).toHaveLength(1);
    const probe = probes[0]!;
    expect(probe.corridorMeters).toBeGreaterThanOrEqual(4_000);
    expect(probe.shaping.length).toBeGreaterThanOrEqual(2);
    expect(probe.shaping.length).toBeLessThanOrEqual(5);
    expect(probe.shaping[0]).toEqual(probe.corridor[0]);
    expect(probe.shaping.at(-1)).toEqual(probe.corridor.at(-1));
  });

  it("reverses a corridor when that substantially reduces connector overhead", () => {
    const probes = selectLibraryCorridorProbes(
      request({
        origin: { lon: -75.19, lat: 40 },
        destination: { lon: -75.51, lat: 40 },
      }),
      [{ id: "eastbound-source", geometry: line(-75.5, -75.2) }],
      {
        targetCorridorMeters: 30_000,
        minimumCorridorMeters: 4_000,
      },
    );

    expect(probes).toHaveLength(1);
    expect(probes[0]!.direction).toBe("reverse");
    expect(probes[0]!.corridor[0]!.lon).toBeGreaterThan(
      probes[0]!.corridor.at(-1)!.lon,
    );
  });

  it("uses explicit source priority only for probe-call allocation", () => {
    const probes = selectLibraryCorridorProbes(
      request(),
      [
        {
          id: "near-low-priority",
          geometry: line(-75.5, -75.3, 40.001),
          priority: 0.1,
        },
        {
          id: "far-high-priority",
          geometry: line(-75.45, -75.25, 40.05),
          priority: 0.9,
        },
      ],
      {
        targetCorridorMeters: 20_000,
        minimumCorridorMeters: 4_000,
        maxProbes: 1,
      },
    );

    expect(probes).toHaveLength(1);
    expect(probes[0]!.sourceId).toBe("far-high-priority");
    expect(probes[0]!.sourcePriority).toBe(0.9);
  });

  it("fails closed for discovery and authored route-shaping truth", () => {
    expect(
      libraryCorridorProbeIncompatibility(
        request({
          discovery: { targetMinutes: 90, toleranceMinutes: 10 },
        }),
      ),
    ).toBe("discovery-round-trip");
    expect(
      libraryCorridorProbeIncompatibility(
        request({ stops: [{ lon: -75.3, lat: 40 }] }),
      ),
    ).toBe("authored-stops");
    expect(
      selectLibraryCorridorProbes(
        request({ shaping: [{ lon: -75.3, lat: 40 }] }),
        [{ id: "source", geometry: line(-75.5, -75.2) }],
      ),
    ).toEqual([]);
  });

  it("creates one shaped provider request without mutating authored input", () => {
    const base = request();
    const probe = selectLibraryCorridorProbes(
      base,
      [{ id: "source", geometry: line(-75.5, -75.2) }],
      {
        targetCorridorMeters: 10_000,
        minimumCorridorMeters: 4_000,
      },
    )[0];

    expect(probe).toBeDefined();
    const shaped = applyLibraryCorridorProbe(base, probe!);
    expect(shaped).not.toBeNull();
    expect(shaped!.shaping).toEqual(probe!.shaping);
    expect(shaped!.options.includeAlternatives).toBe(false);
    expect(base.shaping).toEqual([]);
    expect(base.options.includeAlternatives).toBe(true);
  });

  it("measures corridor recovery and does not count a single crossing as adherence", () => {
    const corridor = line(-75.5, -75.2);
    const probe: LibraryCorridorProbe = {
      id: "source:0-30:forward",
      sourceId: "source",
      sourcePriority: 0.5,
      sourceStartIndex: 0,
      sourceEndIndex: 30,
      direction: "forward",
      corridor,
      shaping: [corridor[0]!, corridor.at(-1)!],
      corridorMeters: 25_000,
      connectorMeters: 0,
      connectorToCorridorRatio: 0,
      detourProxyMeters: 0,
    };

    const followed = assessLibraryCorridorAdherence(
      line(-75.51, -75.19),
      probe,
    );
    expect(followed).not.toBeNull();
    expect(followed!.share).toBeGreaterThan(0.9);

    const crossing = assessLibraryCorridorAdherence(
      [
        { lon: -75.35, lat: 39.95 },
        { lon: -75.35, lat: 40.05 },
      ],
      probe,
    );
    expect(crossing).not.toBeNull();
    expect(crossing!.share).toBeLessThan(0.1);
  });

  it("rejects malformed sources and invalid experiment bounds", () => {
    expect(
      selectLibraryCorridorProbes(
        request(),
        [
          {
            id: "bad",
            geometry: [
              { lon: Number.NaN, lat: 40 },
              { lon: -75.2, lat: 40 },
            ],
          },
        ],
      ),
    ).toEqual([]);

    expect(
      selectLibraryCorridorProbes(
        request(),
        [{ id: "source", geometry: line(-75.5, -75.2) }],
        { maxProbes: 0 },
      ),
    ).toEqual([]);
  });
});
