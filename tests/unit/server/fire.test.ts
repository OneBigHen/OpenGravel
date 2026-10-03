import { describe, expect, it, vi } from "vitest";
import { parseFirmsCsv, fireProvider } from "@/server/map-layers/fire";
const now = Date.parse("2026-10-03T18:00:00Z");
const header = "latitude,longitude,acq_date,acq_time,confidence,frp";
const bounds = { west: -76, south: 40, east: -75, north: 41 };
describe("NASA VIIRS hotspot parser", () => {
  it("keeps only real observations in the last 48 hours and reports their UTC time and confidence", () => {
    const features = parseFirmsCsv(`${header}\n40.1,-75.2,2026-10-03,0530,n,12.5\n40,-75,2026-09-30,1200,h,1\n40,-75,2026-10-03,2500,l,1\n40,-75,2026-10-03,1900,h,1`, bounds, now);
    expect(features).toHaveLength(1);
    expect(features[0]?.detail).toContain("2026-10-03T05:30:00.000Z");
    expect(features[0]?.detail).toContain("nominal");
    expect(features[0]?.detail).toContain("not road closures");
  });
  it("accepts header-only as zero detections, but rejects service and auth errors", () => {
    expect(parseFirmsCsv(header, bounds, now)).toEqual([]);
    expect(() => parseFirmsCsv("Invalid MAP_KEY", bounds, now)).toThrow();
  });
  it("requires a server key before making any request", async () => {
    const fetcher = vi.fn();
    await expect(fireProvider.snapshot!(bounds, ["active-fire"], { env: {}, fetch: fetcher })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
