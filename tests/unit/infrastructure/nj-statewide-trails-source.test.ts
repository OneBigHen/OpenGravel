import { describe, expect, it } from "vitest";

import { parseNjStatewideTrails } from "@/infrastructure/roads/nj-statewide-trails-source";

describe("NJ statewide motorized-trail recon", () => {
  it("keeps motorized + unpaved as a recon lead, not motorcycle access", () => {
    const parsed = parseNjStatewideTrails({
      type: "FeatureCollection",
      features: [{
        id: 10,
        properties: {
          OBJECTID: 10,
          TRAIL_NAME_SEGMENT: "Forest Connector",
          MOTORIZED_USE_ALLOWED: "Y",
          SURFACE: "Unpaved",
          TRAIL_DIFFICULTY: "Moderate",
          GIS_SEGMENT_LENGTH_MI: 3.2,
          PARK_NAME: "Example WMA",
          MANAGING_AGENCY: "NJDEP",
          DATA_SOURCE: "Manager GIS",
        },
        geometry: { type: "LineString", coordinates: [[-74.7, 40.1], [-74.6, 40.2]] },
      }],
    });

    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({
      name: "Forest Connector",
      surfaceHints: ["unpaved"],
      roadOwner: "NJDEP",
      lengthMiles: 3.2,
      confidence: 0.65,
    });
    expect(parsed.records[0]?.notes.join(" ")).toMatch(/motorcycle legality is not established/i);
  });

  it("drops trails that do not explicitly report motorized use", () => {
    const parsed = parseNjStatewideTrails({
      type: "FeatureCollection",
      features: [{
        id: 11,
        properties: {
          OBJECTID: 11,
          TRAIL_NAME_SEGMENT: "Foot Trail",
          MOTORIZED_USE_ALLOWED: "N",
          SURFACE: "Unpaved",
        },
        geometry: { type: "LineString", coordinates: [[-74.7, 40.1], [-74.6, 40.2]] },
      }],
    });
    expect(parsed.records).toEqual([]);
  });
});
