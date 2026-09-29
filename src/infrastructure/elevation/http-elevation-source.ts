/**
 * The browser side of `/api/elevation`: posts the sampled line, reads back an
 * `ElevationResult`, and turns every transport failure into an honest
 * `unavailable` — never a flat line that would read as "no climbing".
 */

import type { ElevationResult, ElevationSource } from "@/application/elevation/profile";

const UNAVAILABLE: ElevationResult = {
  availability: "unavailable",
  reason: "Elevation data is not available right now.",
};

export function createHttpElevationSource(
  options: { readonly basePath?: string; readonly fetchImpl?: typeof fetch } = {},
): ElevationSource {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const url = `${options.basePath ?? ""}/api/elevation`;
  return {
    async elevations(points, signal): Promise<ElevationResult> {
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ points: points.map((point) => [point.lon, point.lat]) }),
          ...(signal === undefined ? {} : { signal }),
        });
        if (!response.ok) return UNAVAILABLE;
        const body = (await response.json()) as Partial<{
          availability: unknown;
          elevationsMeters: unknown;
          reason: unknown;
        }>;
        if (
          body.availability === "available" &&
          Array.isArray(body.elevationsMeters) &&
          body.elevationsMeters.length === points.length &&
          body.elevationsMeters.every((value) => typeof value === "number" && Number.isFinite(value))
        ) {
          return { availability: "available", elevationsMeters: body.elevationsMeters as number[] };
        }
        return typeof body.reason === "string" ? { availability: "unavailable", reason: body.reason } : UNAVAILABLE;
      } catch {
        return UNAVAILABLE;
      }
    },
  };
}
