/**
 * The advisor knows the traffic preference and resolves places near the ride
 * (owner review 2026-10-04: "Turkey Hill in Doylestown" resolved to Indiana,
 * "avoid traffic" could only become "avoid highways").
 */

import { describe, expect, it, vi } from "vitest";

import {
  advisorContextFromDocument,
  parseAdvisorRequest,
  requestAdvisorDraft,
} from "@/application/advisor/advisor-proposal";
import { buildAdvisorProposal } from "@/application/advisor/advisor-proposal-commands";
import { createRideDocument } from "@/domain/ride/create";
import type { RideDocument } from "@/domain/ride/types";

const NOW = "2026-10-04T15:00:00.000Z";

function withStart(document: RideDocument): RideDocument {
  return {
    ...document,
    intent: {
      ...document.intent,
      start: { id: "point_start" as never, kind: "start", coordinate: { lon: -75.13041, lat: 40.31007 }, label: "Doylestown", provenance: { type: "map", selectedAt: NOW } } as never,
    },
  };
}

const MODEL_FIELDS = {
  shape: null, startPlace: null, finishPlace: null, stopPlace: "Turkey Hill, Doylestown, PA", stopArrivalIntent: "fuel",
  rideTimeKind: "unchanged", rideTimeMinutes: null, rideTimeDate: null, rideTimeLocalTime: null,
  roadCharacter: null, noveltyPreference: null, surfacePreference: null, terrainLevel: null,
  avoidHighways: null, tollPolicy: null, trafficPreference: "protect-ride",
  departureKind: "unchanged", departureLocalDate: null, departureLocalTime: null,
};

describe("advisor traffic preference and place bias", () => {
  const document = withStart(createRideDocument({ now: NOW }));
  const context = advisorContextFromDocument(document, { now: new Date(NOW), timeZone: "America/New_York" });

  it("sends the traffic preference and a ~1 km rounded position", () => {
    expect(context.traffic).toBe(document.intent.traffic);
    expect(context.near).toEqual({ lon: -75.13, lat: 40.31 });
  });

  it("accepts a context from an older app without traffic or position", () => {
    const legacy: Record<string, unknown> = { ...context };
    delete legacy["traffic"];
    delete legacy["near"];
    expect(parseAdvisorRequest({ prompt: "twisty roads", rideId: "ride_test", baseRevision: 0, context: legacy })).not.toBeNull();
  });

  it("rejects a malformed position", () => {
    expect(parseAdvisorRequest({ prompt: "twisty roads", rideId: "ride_test", baseRevision: 0, context: { ...context, near: { lon: 500, lat: 0 } } })).toBeNull();
  });

  it("searches named places near the ride and proposes the traffic setting", async () => {
    const search = vi.fn(async () => ({
      status: "ok" as const,
      places: [{ id: "p1", label: "Turkey Hill, Doylestown, PA", name: "Turkey Hill", context: "Doylestown, PA", provider: "test", coordinate: { lon: -75.12, lat: 40.3 } }],
    }));
    const result = await requestAdvisorDraft(
      { prompt: "gas at Turkey Hill then home, avoid traffic", rideId: document.rideId, baseRevision: document.revision, context },
      {
        transport: { send: async () => ({ ok: true as const, text: JSON.stringify({ outcome: "proposal", clarification: null, fields: MODEL_FIELDS, unmappedDetails: [] }) }) } as never,
        places: { search, reverse: async () => null },
      },
    );
    expect(search).toHaveBeenCalledWith("Turkey Hill, Doylestown, PA", expect.objectContaining({ bias: { lon: -75.13, lat: 40.31 } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const before = document.intent.traffic;
    const proposal = buildAdvisorProposal(
      { ...document, intent: { ...document.intent, traffic: "minimize-delay" } },
      result.draft,
      { now: NOW },
    );
    expect(before).toBeDefined();
    expect(proposal.status).toBe("ready");
    if (proposal.status !== "ready") return;
    expect(proposal.changes.map((change) => change.field)).toContain("traffic");
    expect(proposal.command.operations.map((operation) => operation.type)).toContain("trafficPreference.set");
  });

  const transportWith = (fields: Record<string, unknown>) => ({
    send: async () => ({ ok: true as const, text: JSON.stringify({ outcome: "proposal", clarification: null, fields: { ...MODEL_FIELDS, ...fields }, unmappedDetails: [] }) }),
  }) as never;
  const match = (name: string, lon: number, lat: number) => ({ id: name, label: `${name}, PA`, name, context: "PA", provider: "test", coordinate: { lon, lat } });

  it("asks instead of guessing when the geocoder only knows a namesake", async () => {
    const result = await requestAdvisorDraft(
      { prompt: "gas at Turkey Hill", rideId: document.rideId, baseRevision: document.revision, context },
      {
        transport: transportWith({}),
        places: { search: async () => ({ status: "ok" as const, places: [match("Mercer Hill at Doylestown", -75.12, 40.3)] }), reverse: async () => null },
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorClass).toBe("grounding-failed");
  });

  it("drops a stop that is the destination itself and says how to add one", async () => {
    const result = await requestAdvisorDraft(
      { prompt: "Ride to Lambertville, lunch along the way", rideId: document.rideId, baseRevision: document.revision, context },
      {
        transport: transportWith({ shape: "destination", finishPlace: "Lambertville, NJ", stopPlace: "Lambertville, NJ", stopArrivalIntent: "food", trafficPreference: null }),
        places: { search: async () => ({ status: "ok" as const, places: [match("Lambertville", -74.943, 40.366)] }), reverse: async () => null },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.fields.stopPlace).toBeNull();
    expect(result.draft.resolvedPlaces.stop).toBeNull();
    expect(result.draft.resolvedPlaces.finish?.name).toBe("Lambertville");
    expect(result.draft.notes.join(" ")).toMatch(/town along the way/);
  });
});
