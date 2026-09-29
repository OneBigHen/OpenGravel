import { describe, expect, it } from "vitest";

import { handleElevationRequest, MAX_ELEVATION_POINTS } from "@/server/elevation/handler";

const allow = { check: () => null };
const source = {
  elevations: async (points: readonly unknown[]) => ({
    availability: "available" as const,
    elevationsMeters: points.map(() => 100),
  }),
};

function post(body: unknown): Request {
  return new Request("http://local/api/elevation", { method: "POST", body: JSON.stringify(body) });
}

describe("handleElevationRequest", () => {
  it("answers one elevation per point", async () => {
    const response = await handleElevationRequest(post({ points: [[-75.7, 40.8], [-75.6, 40.9]] }), {
      source,
      limiter: allow,
      fixture: false,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ availability: "available", elevationsMeters: [100, 100] });
  });

  it("validates before anything leaves the server", async () => {
    const deps = { source, limiter: allow, fixture: false };
    expect((await handleElevationRequest(post({ points: [[-75.7, 40.8]] }), deps)).status).toBe(400);
    expect((await handleElevationRequest(post({ points: [[-75.7, 99], [-75.6, 40.9]] }), deps)).status).toBe(400);
    const tooMany = Array.from({ length: MAX_ELEVATION_POINTS + 1 }, () => [-75.7, 40.8]);
    expect((await handleElevationRequest(post({ points: tooMany }), deps)).status).toBe(400);
  });

  it("rate-limits per client", async () => {
    const response = await handleElevationRequest(post({ points: [[-75.7, 40.8], [-75.6, 40.9]] }), {
      source,
      limiter: { check: () => 30 },
      fixture: false,
    });
    expect(response.status).toBe(429);
  });
});
