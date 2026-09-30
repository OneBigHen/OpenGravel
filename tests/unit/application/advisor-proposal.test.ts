import { describe, expect, it } from "vitest";

import {
  buildAdvisorProposal,
} from "@/application/advisor/advisor-proposal-commands";
import type { AdvisorDraft } from "@/application/advisor/advisor-proposal";
import { createRideDocument } from "@/domain/ride/create";
import { applyRideCommand } from "@/domain/ride/reducer";
import { newRideId } from "@/domain/ride/ids";
import type { PlaceMatch } from "@/application/geocoding/place-search";

const NOW = "2026-09-24T12:00:00.000Z";
const RIDE_ID = newRideId();
const START: PlaceMatch = {
  id: "photon:123",
  label: "Jim Thorpe, PA",
  name: "Jim Thorpe",
  context: "Carbon County, PA",
  coordinate: { lat: 40.8759, lon: -75.7324 },
  provider: "photon",
};

function draft(overrides: Partial<AdvisorDraft> = {}): AdvisorDraft {
  const document = createRideDocument({ rideId: RIDE_ID, now: NOW });
  return {
    rideId: document.rideId,
    baseRevision: document.revision,
    localDate: "2026-09-24",
    timeZone: "America/New_York",
    outcome: "proposal",
    clarification: null,
    fields: {
      shape: "loop",
      startPlace: "Jim Thorpe",
      finishPlace: null,
      stopPlace: null,
      stopArrivalIntent: null,
      rideTimeKind: "budget",
      rideTimeMinutes: 120,
      rideTimeDate: null,
      rideTimeLocalTime: null,
      roadCharacter: "backroads",
      noveltyPreference: null,
      surfacePreference: "mostly-pavement",
      terrainLevel: null,
      avoidHighways: true,
      tollPolicy: null,
      departureKind: "now",
      departureLocalDate: null,
      departureLocalTime: null,
    },
      resolvedPlaces: { start: START, finish: null, stop: null },
    notes: [],
    ...overrides,
  };
}

describe("advisor proposal commands", () => {
  it("turns reviewed fields into one domain-validated proposal command", () => {
    const document = createRideDocument({ rideId: RIDE_ID, now: NOW });
    const result = buildAdvisorProposal(document, draft(), { now: NOW });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected a proposal");
    expect(result.command.type).toBe("proposal.apply");
    expect(result.command.source).toBe("advisor");
    expect(result.command.baseRevision).toBe(document.revision);
    expect(result.changes.map((change) => change.field)).toEqual([
      "shape",
      "start",
      "time",
      "roadCharacter",
      "surface",
      "highways",
    ]);

    const applied = applyRideCommand(document, result.command, { now: NOW });
    expect(applied.outcome).toBe("applied");
    if (applied.outcome !== "applied") throw new Error("expected one compound edit");
    expect(applied.document.revision).toBe(document.revision + 1);
    expect(applied.document.history.entries).toHaveLength(1);
    expect(applied.document.intent.start).toMatchObject({
      label: "Jim Thorpe, PA",
      coordinate: START.coordinate,
      provenance: { type: "search", provider: "photon", placeId: "photon:123" },
    });
    expect(applied.document.intent).toMatchObject({
      shape: "loop",
      time: { kind: "budget", targetMinutes: 120, toleranceMinutes: 18 },
      roadCharacter: "backroads",
      surface: { preference: "mostly-pavement" },
      avoidHighways: true,
      departure: { kind: "now" },
    });
  });

  it("preserves every field the proposal did not mention", () => {
    const document = createRideDocument({ rideId: RIDE_ID, now: NOW });
    const before = document.intent;
    const result = buildAdvisorProposal(
      document,
      draft({ fields: { ...draft().fields, surfacePreference: "pavement" } }),
      { now: NOW },
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected a proposal");
    const applied = applyRideCommand(document, result.command, { now: NOW });
    expect(applied.outcome).toBe("applied");
    if (applied.outcome !== "applied") throw new Error("expected an applied proposal");
    expect(applied.document.intent.surface).toMatchObject({
      preference: "pavement",
      unknownSurfacePolicy: before.surface.unknownSurfacePolicy,
    });
    expect(applied.document.intent.bike).toEqual(before.bike);
    expect(applied.document.intent.roadSpans).toEqual(before.roadSpans);
    expect(applied.document.intent.avoidAreas).toEqual(before.avoidAreas);
  });

  it("applies a new-to-me road preference through the same reviewed proposal path", () => {
    const document = createRideDocument({ rideId: RIDE_ID, now: NOW });
    const result = buildAdvisorProposal(
      document,
      draft({
        fields: {
          ...draft().fields,
          shape: null,
          startPlace: null,
          rideTimeKind: "unchanged",
          rideTimeMinutes: null,
          roadCharacter: null,
          noveltyPreference: "prefer-new-to-me",
          surfacePreference: null,
          avoidHighways: null,
          departureKind: "unchanged",
        },
        resolvedPlaces: { start: null, finish: null, stop: null },
      }),
      { now: NOW },
    );
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected a proposal");
    expect(result.changes).toContainEqual({ field: "novelty", before: "balanced", after: "prefer-new-to-me" });
    const applied = applyRideCommand(document, result.command, { now: NOW });
    expect(applied.outcome).toBe("applied");
    if (applied.outcome !== "applied") throw new Error("expected an applied proposal");
    expect(applied.document.intent.noveltyPreference).toBe("prefer-new-to-me");
  });

  it("refuses stale and ungrounded proposals without issuing commands", () => {
    const document = createRideDocument({ rideId: RIDE_ID, now: NOW });
    const stale = buildAdvisorProposal(document, draft({ baseRevision: 2 }), { now: NOW });
    expect(stale).toMatchObject({ status: "error", errorClass: "stale-revision" });

    const ungrounded = buildAdvisorProposal(
      document,
      draft({ resolvedPlaces: { start: null, finish: null, stop: null } }),
      { now: NOW },
    );
    expect(ungrounded).toMatchObject({ status: "error", errorClass: "grounding-failed" });
  });

  it("turns unclear or unsupported requests into honest non-applying states", () => {
    const document = createRideDocument({ rideId: RIDE_ID, now: NOW });
    expect(
      buildAdvisorProposal(document, draft({ outcome: "clarification", clarification: "ride-time" }), { now: NOW }),
    ).toMatchObject({ status: "clarification", message: "I couldn't understand the ride time. Try a duration such as 2 hours." });
    expect(
      buildAdvisorProposal(document, draft({ outcome: "unsupported", clarification: null }), { now: NOW }),
    ).toMatchObject({ status: "unsupported" });
  });

  it("uses the rider's IANA timezone for a proposed future departure", () => {
    const document = createRideDocument({ rideId: RIDE_ID, now: NOW });
    const result = buildAdvisorProposal(
      document,
      draft({
        fields: {
          ...draft().fields,
          shape: null,
          startPlace: null,
          rideTimeKind: "unchanged",
          rideTimeMinutes: null,
          roadCharacter: null,
          surfacePreference: null,
          avoidHighways: null,
          departureKind: "future",
          departureLocalDate: "2026-09-25",
          departureLocalTime: "08:00",
        },
        resolvedPlaces: { start: null, finish: null, stop: null },
      }),
      { now: NOW },
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected a proposal");
    const applied = applyRideCommand(document, result.command, { now: NOW });
    expect(applied.outcome).toBe("applied");
    if (applied.outcome !== "applied") throw new Error("expected an applied proposal");
    expect(applied.document.intent.departure).toEqual({ kind: "future", at: "2026-09-25T12:00:00.000Z" });
  });

  it("uses the rider's local date when a future departure has no named date", () => {
    const document = createRideDocument({ rideId: RIDE_ID, now: NOW });
    const result = buildAdvisorProposal(
      document,
      draft({
        fields: {
          ...draft().fields,
          shape: null,
          startPlace: null,
          rideTimeKind: "unchanged",
          rideTimeMinutes: null,
          roadCharacter: null,
          surfacePreference: null,
          avoidHighways: null,
          departureKind: "future",
          departureLocalDate: null,
          departureLocalTime: "18:30",
        },
        resolvedPlaces: { start: null, finish: null, stop: null },
      }),
      { now: NOW },
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected a proposal");
    const applied = applyRideCommand(document, result.command, { now: NOW });
    expect(applied.outcome).toBe("applied");
    if (applied.outcome !== "applied") throw new Error("expected an applied proposal");
    expect(applied.document.intent.departure).toEqual({ kind: "future", at: "2026-09-24T22:30:00.000Z" });
  });

  it("asks the rider to choose a later time when a deadline has already passed", () => {
    const document = createRideDocument({ rideId: RIDE_ID, now: NOW });
    const result = buildAdvisorProposal(document, draft({
      fields: {
        ...draft().fields,
        shape: null,
        startPlace: null,
        rideTimeKind: "returnBy",
        rideTimeMinutes: null,
        rideTimeDate: "2026-09-24",
        rideTimeLocalTime: "07:00",
        roadCharacter: null,
        surfacePreference: null,
        avoidHighways: null,
        departureKind: "unchanged",
      },
      resolvedPlaces: { start: null, finish: null, stop: null },
    }), { now: NOW });

    expect(result).toMatchObject({ status: "clarification", message: "That ride time has already passed. Choose a later time." });
  });

  it("does not propose a departure in the past", () => {
    const document = createRideDocument({ rideId: RIDE_ID, now: NOW });
    const result = buildAdvisorProposal(document, draft({
      fields: {
        ...draft().fields,
        shape: null,
        startPlace: null,
        rideTimeKind: "unchanged",
        rideTimeMinutes: null,
        roadCharacter: null,
        surfacePreference: null,
        avoidHighways: null,
        departureKind: "future",
        departureLocalDate: "2026-09-24",
        departureLocalTime: "07:00",
      },
      resolvedPlaces: { start: null, finish: null, stop: null },
    }), { now: NOW });

    expect(result).toMatchObject({ status: "clarification", message: "That ride time has already passed. Choose a later time." });
  });
});
