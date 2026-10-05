import { describe, expect, it } from "vitest";

import { isMapboxRefusal } from "@/infrastructure/map/maplibre/host";

const failure = (status: number, url: string) => ({ error: { status, url, message: "x" } });

describe("isMapboxRefusal", () => {
  it.each([401, 403, 429])("treats a %i from the Mapbox API as a refusal", (status) => {
    expect(isMapboxRefusal(failure(status, "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/1/0/0.mvt"))).toBe(true);
  });

  it("ignores other statuses, other hosts and shapeless payloads", () => {
    expect(isMapboxRefusal(failure(404, "https://api.mapbox.com/x"))).toBe(false);
    expect(isMapboxRefusal(failure(429, "https://tiles.openfreemap.org/x"))).toBe(false);
    expect(isMapboxRefusal({ error: new Error("boom") })).toBe(false);
    expect(isMapboxRefusal(null)).toBe(false);
  });
});
