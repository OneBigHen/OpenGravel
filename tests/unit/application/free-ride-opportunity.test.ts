import { describe, expect, it } from "vitest";

import type { LiveSuggestionCandidate } from "@/application/free-ride/live-suggestions";
import {
  OPPORTUNITY_TTL_MS,
  opportunityDirection,
  opportunityProgress,
  opportunityReasons,
  showOpportunity,
  spokenOpportunity,
} from "@/application/free-ride/opportunity";
import { knownEvidence, unknownEvidence } from "@/domain/evidence/types";
import { asRouteCandidateId } from "@/domain/route/ids";

const source = { id: "scorer", label: "Route scorer", category: "derived" } as const;
const RIDER = { lon: -77, lat: 40 };
// About 1.1 km due north of the rider.
const ENTRY = { lon: -77, lat: 40.01 };
const AT = "2026-09-27T12:00:00.000Z";

function suggestion(overrides: Partial<LiveSuggestionCandidate> = {}): LiveSuggestionCandidate {
  return {
    id: "ridge",
    label: "Ridge Road",
    entry: ENTRY,
    distanceToDecisionMeters: 1_300,
    distanceMeters: 9_000,
    route: { planningGeneration: 2, routeId: asRouteCandidateId("route_ridge") },
    headingDeltaDegrees: -80,
    requiresUTurn: false,
    durationSeconds: 540,
    ...overrides,
  };
}

describe("Free Ride opportunity lifetime (FR-02, FR-03)", () => {
  it("counts the decision distance down, not the segment length", () => {
    const shown = showOpportunity(suggestion(), RIDER, AT);
    const halfway = { lon: -77, lat: 40.005 };
    const progress = opportunityProgress(shown, halfway, 0, "2026-09-27T12:00:30.000Z");
    expect(progress.status).toBe("active");
    if (progress.status !== "active") return;
    expect(progress.distanceToDecisionMeters).toBeGreaterThan(600);
    expect(progress.distanceToDecisionMeters).toBeLessThan(700);
  });

  it("expires once the decision point is behind the rider", () => {
    const shown = showOpportunity(suggestion(), RIDER, AT);
    const beyond = { lon: -77, lat: 40.012 };
    expect(opportunityProgress(shown, beyond, 0, "2026-09-27T12:01:00.000Z")).toEqual({ status: "expired", reason: "passed" });
  });

  it("stays while the rider is right at the junction, whatever the heading", () => {
    const shown = showOpportunity(suggestion(), RIDER, AT);
    expect(opportunityProgress(shown, { lon: -77, lat: 40.0099 }, 180, "2026-09-27T12:01:00.000Z").status).toBe("active");
  });

  it("expires when the rider rides clearly away from it", () => {
    const shown = showOpportunity(suggestion(), RIDER, AT);
    expect(opportunityProgress(shown, { lon: -77, lat: 39.996 }, null, "2026-09-27T12:01:00.000Z").status).toBe("expired");
  });

  it("expires after its time to live", () => {
    const shown = showOpportunity(suggestion(), RIDER, AT);
    const late = new Date(Date.parse(AT) + OPPORTUNITY_TTL_MS + 1).toISOString();
    expect(opportunityProgress(shown, RIDER, 0, late)).toEqual({ status: "expired", reason: "ttl" });
  });
});

describe("Free Ride opportunity copy (§5, §6)", () => {
  it("names the turn the rider would make", () => {
    expect(opportunityDirection(-80)).toBe("left");
    expect(opportunityDirection(30)).toBe("slight right");
    expect(opportunityDirection(5)).toBe("ahead");
  });

  it("gives reasons only from strong, known evidence", () => {
    expect(opportunityReasons(suggestion({
      evidence: {
        roadCharacterFit: knownEvidence(0.8, source),
        surfaceFit: knownEvidence(0.2, source),
        novelty: unknownEvidence<number>("No ride history."),
      },
    }))).toEqual(["Curvier"]);
    expect(opportunityReasons(suggestion())).toEqual([]);
  });

  it("says one short sentence a rider can take in through a helmet", () => {
    expect(spokenOpportunity(suggestion({
      evidence: {
        roadCharacterFit: knownEvidence(0.9, source),
        surfaceFit: knownEvidence(0.7, source),
        novelty: unknownEvidence<number>("No ride history."),
      },
    }), 800)).toBe("Ridge Road, left in half a mile. Curvier, more gravel, about 9 minutes.");
    expect(spokenOpportunity(suggestion({ durationSeconds: undefined }), 1_300)).toBe("Ridge Road, left in 0.8 miles.");
  });
});
