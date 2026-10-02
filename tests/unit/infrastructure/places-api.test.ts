import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createPlacesApiSource,
  parsePlacesCollection,
  parsePlaceFeature,
  PlacesContractError,
  thinLine,
} from "@/infrastructure/places";

const FIXTURE = JSON.parse(
  readFileSync(path.join(process.cwd(), "tests/fixtures/places/sample-places.json"), "utf8"),
) as { features: unknown[] };

describe("places API contract 1.0", () => {
  it("keeps event occurrence times and the supplied time zone", () => {
    const event = parsePlacesCollection(FIXTURE).places.find((p) => p.name.startsWith("Sample Ride Event"));
    expect(event).toMatchObject({
      startUtc: "2026-09-25T01:00:00+00:00",
      endUtc: "2026-09-25T05:00:00+00:00",
      timeZone: "UTC",
    });
  });

  it("maps every valid feature of the sample response", () => {
    const parsed = parsePlacesCollection(FIXTURE);
    expect(parsed.dropped).toBe(0);
    expect(parsed.places.length).toBe(FIXTURE.features.length);
    const hh = parsed.places.find((p) => p.kind === "happy_hour" && p.specials.length > 0);
    expect(hh).toBeDefined();
    expect(hh?.id.startsWith("hh:")).toBe(true);
    expect(hh?.url.startsWith("https://places.example/happy/")).toBe(true);
    expect(parsed.places.some((p) => p.kind === "event")).toBe(true);
  });

  it("preserves per-item aggregator provenance and motorcycle classification additively", () => {
    const feature = FIXTURE.features[1] as Record<string, unknown>;
    const properties = feature["properties"] as Record<string, unknown>;
    const parsed = parsePlaceFeature({
      ...feature,
      properties: {
        ...properties,
        source_id: "ecea",
        source_label: "ECEA",
        source_url: "https://ecea.org/events/example",
        motorcycle_specific: true,
        tags: ["Dual-Sport", "Adventure-Ride", "dual-sport"],
      },
    });
    expect(parsed).toMatchObject({
      sourceId: "ecea",
      sourceLabel: "ECEA",
      sourceUrl: "https://ecea.org/events/example",
      motorcycleSpecific: true,
      tags: ["dual-sport", "adventure-ride"],
    });
  });

  it("drops malformed features instead of half-mapping them", () => {
    const good = FIXTURE.features[0] as Record<string, unknown>;
    expect(parsePlaceFeature({ ...good, geometry: { type: "Point", coordinates: [999, 40] } })).toBeNull();
    expect(parsePlaceFeature({ ...good, properties: { ...(good["properties"] as object), url: "javascript:alert(1)" } })).toBeNull();
    expect(parsePlaceFeature({ ...good, properties: { ...(good["properties"] as object), kind: "casino" } })).toBeNull();
  });

  it("refuses a different major contract", () => {
    expect(() => parsePlacesCollection({ type: "FeatureCollection", features: [], meta: { contract: "2.0" } })).toThrow(
      PlacesContractError,
    );
  });
});

describe("places-api places source", () => {
  it("sends the key as a bearer token and a bbox query", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const source = createPlacesApiSource({
      baseUrl: "https://places.example/",
      apiKey: "test-token-not-a-secret",
      fetch: async (input, init) => {
        seen.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
        return Response.json(FIXTURE);
      },
    });
    const result = await source.inExtent(
      { west: -75.45, south: 39.95, east: -75.15, north: 40.25 },
      { kinds: ["happy_hour"], window: "now" },
    );
    expect(result.availability).toBe("available");
    expect(seen[0]?.url).toBe(
      "https://places.example/api/v1/places?bbox=-75.4500%2C39.9500%2C-75.1500%2C40.2500&kinds=happy_hour&when=now",
    );
    expect(seen[0]?.auth).toBe("Bearer test-token-not-a-secret");
  });

  it("turns provider failures into fixed, non-leaking reasons", async () => {
    const answer = (status: number) =>
      createPlacesApiSource({
        baseUrl: "https://places.example",
        apiKey: "k",
        fetch: async () => new Response("upstream says: secret detail", { status }),
      }).inExtent({ west: 0, south: 0, east: 1, north: 1 }, { kinds: ["event"], window: "today" });
    const denied = await answer(401);
    const busy = await answer(429);
    expect(denied).toMatchObject({ availability: "unavailable", retryable: false });
    expect(busy).toMatchObject({ availability: "unavailable", retryable: true });
    expect(JSON.stringify([denied, busy])).not.toContain("secret");
  });

  it("thins a long line without reordering it", () => {
    const line = Array.from({ length: 1000 }, (_, i) => ({ lon: i, lat: 0 }));
    const thin = thinLine(line, 10);
    expect(thin).toHaveLength(10);
    expect(thin[0]).toEqual({ lon: 0, lat: 0 });
    expect(thin[9]).toEqual({ lon: 999, lat: 0 });
    expect(thin.every((p, i) => i === 0 || p.lon > (thin[i - 1]?.lon ?? -1))).toBe(true);
  });
});
