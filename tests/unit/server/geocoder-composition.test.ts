import { afterEach, describe, expect, it, vi } from "vitest";

describe("geocoder composition", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("does not apply an implicit location bias when none is configured", async () => {
    vi.stubEnv("OGV_GEOCODER_BIAS", "");
    vi.resetModules();

    const { geocodeDependencies } = await import("@/app/api/geocode/geocoder");

    expect(geocodeDependencies.defaultBias).toBeUndefined();
  });
});
