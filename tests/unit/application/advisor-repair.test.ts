/**
 * A half-filled model reply is repaired, not reported as an outage: Gemini
 * answered "gravel loop from Jim Thorpe with a lunch stop" with a food stop and
 * no place, and the rider saw "The advisor is unavailable right now."
 */

import { describe, expect, it, vi } from "vitest";

import { advisorContextFromDocument, requestAdvisorDraft } from "@/application/advisor/advisor-proposal";
import { createRideDocument } from "@/domain/ride/create";

const NOW = "2026-10-23T12:00:00.000Z";

const FIELDS = {
  shape: "loop", startPlace: "Jim Thorpe, PA", finishPlace: null, stopPlace: null, stopArrivalIntent: "food",
  rideTimeKind: "budget", rideTimeMinutes: 120, rideTimeDate: null, rideTimeLocalTime: null,
  roadCharacter: null, noveltyPreference: null, surfacePreference: "dirt-preferred", terrainLevel: null,
  avoidHighways: null, tollPolicy: null, trafficPreference: null,
  departureKind: "unchanged", departureLocalDate: null, departureLocalTime: null,
};

describe("advisor reply repair", () => {
  const document = createRideDocument({ now: NOW });
  const context = advisorContextFromDocument(document, { now: new Date(NOW), timeZone: "America/New_York" });
  const jimThorpe = { id: "jt", label: "Jim Thorpe, PA", name: "Jim Thorpe", context: "PA", provider: "test", coordinate: { lon: -75.73, lat: 40.87 } };
  const run = (fields: Record<string, unknown>) => requestAdvisorDraft(
    { prompt: "gravel loop from Jim Thorpe about 60 miles with a lunch stop", rideId: document.rideId, baseRevision: document.revision, context },
    {
      transport: { send: async () => ({ ok: true as const, text: JSON.stringify({ outcome: "proposal", clarification: null, fields: { ...FIELDS, ...fields }, unmappedDetails: ["lunch stop along the way"] }) }) } as never,
      places: { search: async () => ({ status: "ok" as const, places: [jimThorpe] }), reverse: async () => null },
    },
  );

  it("keeps the ride and asks for a town when a food stop has no place", async () => {
    const result = await run({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.fields.stopArrivalIntent).toBeNull();
    expect(result.draft.fields.shape).toBe("loop");
    expect(result.draft.fields.surfacePreference).toBe("dirt-preferred");
    expect(result.draft.notes.join(" ")).toMatch(/town for the food stop/);
  });

  it("parses ordered category, vicinity and route-position searches without geocoding them", async () => {
    const search = vi.fn(async () => ({ status: "ok" as const, places: [] }));
    const result = await requestAdvisorDraft(
      { prompt: "coffee halfway and a diner near the end", rideId: document.rideId, baseRevision: document.revision, context },
      {
        transport: {
          send: async () => ({
            ok: true as const,
            text: JSON.stringify({
              outcome: "proposal",
              clarification: null,
              fields: {
                ...FIELDS,
                shape: null,
                startPlace: null,
                rideTimeKind: "unchanged",
                rideTimeMinutes: null,
                surfacePreference: null,
                stopPlace: null,
                stopArrivalIntent: null,
                stopSearches: [
                  { category: "coffee", vicinity: null, routePosition: "halfway" },
                  { category: "diner", vicinity: "Jim Thorpe, PA", routePosition: "near-end" },
                ],
              },
              unmappedDetails: [],
            }),
          }),
        } as never,
        places: { search, reverse: async () => null },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.fields.stopSearches).toEqual([
      { category: "coffee", vicinity: null, routePosition: "halfway" },
      { category: "diner", vicinity: "Jim Thorpe, PA", routePosition: "near-end" },
    ]);
    expect(search).not.toHaveBeenCalled();
  });

  it("drops minutes that do not belong to the time kind", async () => {
    const result = await run({ rideTimeKind: "unchanged" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.fields.rideTimeMinutes).toBeNull();
  });

  it("falls back to no time change when a budget has no minutes", async () => {
    const result = await run({ rideTimeMinutes: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.fields.rideTimeKind).toBe("unchanged");
    expect(result.draft.notes.join(" ")).toMatch(/ride time/);
  });

  it("treats a future departure without a clock time as unchanged", async () => {
    const result = await run({ departureKind: "future", departureLocalDate: "2026-10-24" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.fields.departureKind).toBe("unchanged");
    expect(result.draft.fields.departureLocalDate).toBeNull();
  });
});
