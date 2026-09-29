import { describe, expect, it } from "vitest";

import { handleRouteTrafficRequest } from "@/server/traffic/route-handler";

describe("route traffic handler", () => {
  it("reports the no-key optional provider as unknown without a clear answer", async () => {
    const result = await handleRouteTrafficRequest({
      corridor: [
        { lon: -75.1, lat: 40.1 },
        { lon: -75.09, lat: 40.11 },
      ],
      departureTime: "2026-09-17T14:00:00.000Z",
    }, { provider: undefined });

    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.traffic).toMatchObject({
      availability: "unavailable",
      label: "Traffic unknown",
      segments: [],
    });
    expect(result.body.corridorMatch.coverageRatio).toBe(0);
  });

  it("rejects an unbounded or malformed corridor before provider work", async () => {
    const result = await handleRouteTrafficRequest({
      corridor: [{ lon: -75.1, lat: 40.1 }],
      departureTime: "not-a-date",
    });

    expect(result).toEqual({
      status: 400,
      body: {
        error: {
          code: "validation",
          message: "The traffic request needs a bounded route corridor and departure time.",
        },
      },
    });
  });
});
