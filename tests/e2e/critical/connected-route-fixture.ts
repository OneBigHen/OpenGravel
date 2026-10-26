import type { Page } from "@playwright/test";
import fixture from "../../fixtures/route-plan/candidates-basic.json";
import type { RoutePlanRequestBody, RoutePlanSuccessBody } from "../../../src/application/planner/ports/route-plan-contract";
import type { Coordinate } from "../../../src/domain/ride/types";

export const RIDER_FIX = { lat: 40.8757, lon: -75.7324 };
export const WAWA = { lat: 40.864, lon: -75.728 };

/** Synthetic browser geometry only. Rotate/scale the labeled fixture so its
 * endpoints meet the search fixture, rather than fitting two unrelated towns.
 * This establishes screen layout, never road/routing quality. */
function connect(line: readonly Coordinate[], origin: Coordinate, destination: Coordinate): Coordinate[] {
  const first = line[0]!, last = line.at(-1)!;
  const x = last.lon - first.lon, y = last.lat - first.lat;
  const dx = destination.lon - origin.lon, dy = destination.lat - origin.lat;
  const scale = (dx * x + dy * y) / (x * x + y * y);
  const turn = (dy * x - dx * y) / (x * x + y * y);
  return line.map((point) => ({
    lon: origin.lon + scale * (point.lon - first.lon) - turn * (point.lat - first.lat),
    lat: origin.lat + turn * (point.lon - first.lon) + scale * (point.lat - first.lat),
  }));
}

export function connectedCoordinates(origin = RIDER_FIX, destination = WAWA): Coordinate[] {
  return [origin, destination, ...fixture.candidates.flatMap((candidate) => connect(candidate.geometry, origin, destination))];
}

export async function useConnectedRouteFixture(page: Page): Promise<void> {
  await page.route("**/api/route-plan", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as RoutePlanSuccessBody;
    const { request } = route.request().postDataJSON() as RoutePlanRequestBody;
    await route.fulfill({ response, json: { ...body, bundle: { ...body.bundle,
      candidates: body.bundle.candidates.map((candidate) => ({ ...candidate,
        geometry: connect(candidate.geometry, request.origin, request.destination),
        fingerprint: `${candidate.fingerprint}:connected:${request.origin.lat}:${request.destination.lat}`,
      })),
    } } });
  });
}
