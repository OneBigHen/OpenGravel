import { describe, expect, it } from "vitest";
import { latestRadarFrame, radarWmsUrl, radarProvider } from "@/server/map-layers/radar";
const bounds = { west: -76, south: 40, east: -75, north: 41 };
describe("timestamped NOAA / IEM radar", () => {
  it("uses a real archived frame timestamp and ignores future and malformed entries", () => {
    expect(latestRadarFrame('n0q_202610031800.png n0q_202610031805.png n0q_202610041800.png', Date.parse("2026-10-03T18:06Z"))).toBe("2026-10-03T18:05:00.000Z");
    expect(() => latestRadarFrame("upstream error", Date.now())).toThrow();
  });
  it("requests a specific frame in WMS 1.1.1 longitude/latitude order", () => {
    const url = new URL(radarWmsUrl(bounds, "2026-10-03T18:05:00.000Z"));
    expect(url.searchParams.get("TIME")).toBe("2026-10-03T18:05:00.000Z");
    expect(url.searchParams.get("BBOX")).toBe("-76,40,-75,41");
    expect(url.searchParams.get("LAYERS")).toBe("nexrad-n0q-wmst");
  });
  it("fails unavailable on an XML service error returned with HTTP 200", async () => {
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => String(input).includes("archive/data")
      ? new Response("n0q_202610031800.png") : new Response("<ServiceException/>");
    await expect(radarProvider.snapshot!(bounds, ["weather-radar"], { fetch: fetcher, env: {}, now: () => Date.parse("2026-10-03T18:05Z") })).rejects.toThrow();
  });
});
