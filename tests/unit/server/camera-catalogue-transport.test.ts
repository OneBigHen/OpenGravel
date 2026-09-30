import { afterEach, describe, expect, it, vi } from "vitest";

import { handleMapLayersRequest, clearMapLayersCache } from "@/server/map-layers/handler";
import * as security from "@/server/traffic-cameras/url-security";

afterEach(() => { vi.restoreAllMocks(); clearMapLayersCache(); });

describe("camera catalogue transport", () => {
  it("uses pinned fixed-origin fetch for production camera enumeration", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Raw fetch must not run"));
    const pinned = vi.spyOn(security, "fetchPinnedCameraUrl").mockImplementation(async (policy, url) => {
      expect(policy.origins.has(new URL(url).origin)).toBe(true);
      expect(policy.origins.has("https://untrusted.invalid")).toBe(false);
      return Response.json({});
    });
    const result = await handleMapLayersRequest(new URL("http://localhost/api/map-layers?bbox=-75.5,39.8,-74.9,40.3&layers=traffic-cameras"), {
      providers: [{ id: "traffic-cameras", layers: ["traffic-cameras"], ttlMs: 1, load: async (_bounds, _layers, context) => {
        await context.fetch("https://511nj.org/client/cameras");
        return [];
      } }],
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ unavailable: [] });
    expect(pinned).toHaveBeenCalledOnce();
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
