import { describe, expect, it } from "vitest";
import { summarizeAdvisorRide, MAX_ADVISOR_SUMMARY_BYTES } from "@/application/advisor/advisor-ride-summary";
import { advisorRequestForDocument, parseAdvisorRequest } from "@/application/advisor/advisor-proposal";
import { createRideDocument } from "@/domain/ride/create";
import { asGeometryRef } from "@/domain/ride/ids";
import { asRouteCandidateId } from "@/domain/route/ids";
import { ROUTE_SCORE_COMPONENT_KEYS } from "@/domain/route/policy";
import type { RouteBundle, RouteCandidate, RouteScoreComponents } from "@/domain/route/types";
import { knownEvidence } from "@/domain/evidence/types";
import { emptyRouteRoles } from "@/application/planner/planning-session";

const document = createRideDocument();
const reported = (value: unknown) => knownEvidence(value, { id: "fixture", label: "Fixture", category: "routing" });
function candidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    id: asRouteCandidateId("route_selected"), provider: { providerId: "fixture", profile: "fixture" },
    geometryRef: asGeometryRef("geo_fixture"), fingerprint: "fixture", distanceMeters: 100_000, durationSeconds: 7200,
    eligibility: { eligible: true, failures: [] }, evidence: {}, warnings: [],
    score: { total: 0, policyVersion: "fixture", components: Object.fromEntries(ROUTE_SCORE_COMPONENT_KEYS.map((key) => [key, { input: null, weight: 0, contribution: 0, evidenceStatus: "unknown", explanationKey: "unscored.component" }])) as unknown as RouteScoreComponents },
    ...overrides,
  };
}
function bundle(selected: RouteCandidate, alternatives: readonly RouteCandidate[] = []): RouteBundle {
  return { rideId: document.rideId, rideRevision: document.revision, planningGeneration: 1, policyVersion: "fixture", graphVersion: "fixture", evidenceVersion: "fixture", createdAt: document.createdAt, selectedRouteId: selected.id, selectionSource: "rider", candidates: [selected, ...alternatives], roles: emptyRouteRoles() };
}

describe("advisor planned ride summary", () => {
  it("keeps absent, stale and unusable surface unknown", () => {
    const entries: RouteCandidate["evidence"][] = [{}, { surfaceMix: { ...reported({ pavedMeters: 100000, gravelMeters: 0, dirtMeters: 0, unknownMeters: 0 }), status: "unknown" as const } }];
    for (const evidence of entries) {
      const summary = summarizeAdvisorRide(document, bundle(candidate({ evidence })));
      expect(summary).toMatchObject({ surface: "Surface unknown", curviness: "Curviness unknown", climbMeters: null });
    }
    expect(summarizeAdvisorRide(document, { ...bundle(candidate()), rideRevision: 7 })).toBeNull();
    expect(summarizeAdvisorRide(document, null)).toBeNull();
  });

  it("includes signed alternative deltas, road facts and measured climb without geometry or endpoint labels", () => {
    const route = candidate({ evidence: { surfaceMix: { ...reported({ pavedMeters: 60000, gravelMeters: 10000, dirtMeters: 10000, unknownMeters: 20000 }), status: "estimated" }, curvature: reported({ curvyMeters: 15000, totalMeters: 100000 }) },
      instructions: ["River Road", "123 Private Lane", "Home", "rider@example.test", "Main Street 42", "Private Lane", "PA 32"].map((roadName) => ({ roadName, text: "My home is at 40.123456 -75.123456", distanceMeters: 1, durationSeconds: 1, type: "straight" })) });
    const summary = summarizeAdvisorRide(document, bundle(route, [candidate({ id: asRouteCandidateId("route_alt"), distanceMeters: 90000, durationSeconds: 5400 })]), 420);
    expect(summary).toMatchObject({ distanceKm: 100, durationMinutes: 120, climbMeters: 420, surface: "Estimated: 60% paved, 10% gravel, 10% dirt, 20% unknown", curviness: "Very curvy", roads: ["River Road", "PA 32"], alternatives: [{ distanceKmDelta: -10, minutesDelta: -30 }] });
    expect(JSON.stringify(summary)).not.toMatch(/geometry|40.123456|Private Lane|Main Street 42|example.test|Home/);
  });

  it("counts uncovered distance as unknown and never rounds a small unknown share to clear", () => {
    expect(summarizeAdvisorRide(document, bundle(candidate({ evidence: { surfaceMix: reported({ pavedMeters: 60000, gravelMeters: 0, dirtMeters: 0, unknownMeters: 0 }) } })))?.surface).toContain("40% unknown");
    expect(summarizeAdvisorRide(document, bundle(candidate({ evidence: { surfaceMix: reported({ pavedMeters: 99999, gravelMeters: 0, dirtMeters: 0, unknownMeters: 1 }) } })))?.surface).toContain("<1% unknown");
  });

  it("bounds multibyte road names and rejects oversized or extra wire data", () => {
    const summary = summarizeAdvisorRide(document, bundle(candidate({ instructions: Array.from({ length: 50 }, (_, index) => ({ roadName: `${"路".repeat(59)}${index}`, text: "", type: "straight", distanceMeters: 1, durationSeconds: 1 })) })));
    expect(summary).not.toBeNull();
    expect(new TextEncoder().encode(JSON.stringify(summary)).length).toBeLessThanOrEqual(MAX_ADVISOR_SUMMARY_BYTES);
    const request = advisorRequestForDocument(document, "why this route?", { plannedRide: summary! });
    expect(parseAdvisorRequest(request)).not.toBeNull();
    for (const claim of [ { why: "This road is legal and safe." }, { surface: "All roads are paved and open." }, { curviness: "Safe curves" }, { stops: [["fuel"]] } ]) {
      expect(parseAdvisorRequest({ ...request, context: { ...request.context, plannedRide: { ...summary, ...claim } } })).toBeNull();
    }
    expect(parseAdvisorRequest({ ...request, context: { ...request.context, plannedRide: { ...summary, geometry: [] } } })).toBeNull();
    expect(parseAdvisorRequest({ ...request, context: { ...request.context, plannedRide: { ...summary, roads: ["x".repeat(2000)] } } })).toBeNull();
  });
});
