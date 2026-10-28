import { expect, it } from "vitest";
import { enrichPlannerPreparationForLongTrip } from "@/application/preparation/long-trip";
import { prepareRoute } from "@/application/preparation/prepare-route";

it("briefs a long selected route against the current bike and departure daylight", () => {
  const context = { distanceKm: 300, rideDurationMinutes: 240, departure: "2026-10-28T16:00:00Z", sunset: "2026-10-28T19:00:00Z" };
  const result = enrichPlannerPreparationForLongTrip(prepareRoute(context), context, { fuelRangeMiles: 100, reserveMiles: 20 });
  expect(result.considerations?.find((item) => item.kind === "fuel")).toMatchObject({ severity: "critical", sourceRefs: ["ride:distance", "bike-profile:fuel-range"] });
  expect(result.considerations?.find((item) => item.kind === "daylight")).toMatchObject({ severity: "critical" });
  expect(result.considerations?.find((item) => item.kind === "weather")).toBeUndefined();
});

it("keeps a short ride free of long-trip advice", () => {
  const context = { distanceKm: 20, rideDurationMinutes: 30 };
  const preparation = prepareRoute(context);
  expect(enrichPlannerPreparationForLongTrip(preparation, context, { fuelRangeMiles: 100, reserveMiles: 20 })).toBe(preparation);
});
