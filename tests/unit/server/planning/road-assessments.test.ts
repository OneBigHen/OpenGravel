import { describe, expect, it, vi } from "vitest";
import { knownEvidence, unknownEvidence } from "@/domain/evidence/types";
import { createRoadAuthorityCoordinator, ROAD_AUTHORITY_DEADLINE_MS, type RoadAuthorityAssessment, type RoadAuthorityCoordinator } from "@/application/route-intelligence/coordinator";
import { requestRoadAssessments } from "@/server/planning/road-assessments";

const line = [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }];
const outside = [...line, { lon: -74, lat: 41 }];
function coordinator(): RoadAuthorityCoordinator {
  return createRoadAuthorityCoordinator({ sources: [{
    info: { id: "feed", label: "Feed", authority: "authoritative-operational", family: "road-authority", facet: "closures", coverage: [], precedence: 1 },
    budget: { maxRemoteCallsPerPlan: 1, maxRecords: 1, timeoutMs: 1, concurrency: 1, cacheTtlMs: 1, serveStaleMs: 1, retry: "none", cancellable: false },
    probe: () => ({ available: true, reason: null }),
    snapshot: async () => ({ status: "unavailable", fetchedAt: null, reason: "down", records: [], covered: [] }),
  }] });
}
function assessment(blocked = false): RoadAuthorityAssessment {
  return {
    at: "2026-10-23T00:00:00Z", sources: [],
    evaluate: () => ({
      failures: blocked ? [{ code: "road-closed", message: "Bridge closed." }] : [], warnings: [],
      evidence: {
        closures: knownEvidence(blocked ? 1 : 0, { id: "feed", label: "Feed", category: "other" }),
        access: unknownEvidence("No designation"),
      },
    }),
  };
}

describe("requestRoadAssessments", () => {
  it("assesses growing union corridors and reuses an assessment for contained lines", async () => {
    const authority = coordinator();
    const assess = vi.spyOn(authority, "assess").mockResolvedValue(assessment());
    const once = requestRoadAssessments(authority, new AbortController().signal);
    const first = await once([{ geometry: line }]);
    expect(await once([{ geometry: line.map(point => ({ ...point })) }])).toBe(first);
    await once([{ geometry: outside }]);
    await once([{ geometry: line }]);
    expect(assess).toHaveBeenCalledTimes(2);
    const a = assess.mock.calls[0]![0];
    const b = assess.mock.calls[1]![0];
    expect(b.west).toBeLessThanOrEqual(a.west);
    expect(b.south).toBeLessThanOrEqual(a.south);
    expect(b.east).toBeGreaterThanOrEqual(a.east);
    expect(b.north).toBeGreaterThanOrEqual(a.north);
  });

  it.each([false, true])("shares the deadline and keeps prior blockers without claiming unchecked roads clear (blocked: %s)", async blocked => {
    vi.useFakeTimers();
    try {
      const authority = coordinator();
      const assess = vi.spyOn(authority, "assess")
        .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(assessment(blocked)), 1_000)))
        .mockImplementation(() => new Promise(() => undefined));
      const once = requestRoadAssessments(authority, new AbortController().signal);
      const first = once([{ geometry: line }]);
      await vi.advanceTimersByTimeAsync(1_000);
      await first;
      const second = once([{ geometry: outside }]);
      await vi.advanceTimersByTimeAsync(ROAD_AUTHORITY_DEADLINE_MS - 1_000 + 1);
      const result = await second;
      const verdict = result!.evaluate(outside);
      expect(verdict.evidence.closures.status).toBe(blocked ? "known" : "unknown");
      expect(verdict.failures).toHaveLength(blocked ? 1 : 0);
      expect(verdict.warnings.map(warning => warning.code)).toContain("road-authority-unavailable");
      expect(result!.evaluate(line).evidence.closures.status).toBe("known");
      await once([{ geometry: outside }]);
      expect(assess).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("uses real geometry matching to retain shared-segment closures while new coverage stays unknown", async () => {
    vi.useFakeTimers();
    try {
      const authority = coordinator();
      const coverage = [{ west: -76, south: 39, east: -73, north: 42 }];
      vi.spyOn(authority.sources[0]!, "snapshot").mockResolvedValue({
        status: "fresh", fetchedAt: new Date().toISOString(), reason: null, covered: coverage, scope: coverage,
        records: [{ sourceId: "feed", sourceRecordId: "bridge", kind: "closure", geometry: { type: "line", coordinates: line }, roadName: "Bridge Road", description: "Bridge out.", validFrom: null, validUntil: null }],
      });
      const once = requestRoadAssessments(authority, new AbortController().signal);
      await once([{ geometry: line }]);
      await vi.advanceTimersByTimeAsync(ROAD_AUTHORITY_DEADLINE_MS + 1);
      const fallback = (await once([{ geometry: outside }]))!;
      expect(fallback.evaluate(outside).failures.map(failure => failure.code)).toEqual(["road-closed"]);
      expect(fallback.evaluate(outside).evidence.closures).toMatchObject({ status: "known", value: 1 });
      const unrelated = [{ lon: -74, lat: 40.8 }, { lon: -73.9, lat: 40.9 }];
      expect(fallback.evaluate(unrelated).failures).toEqual([]);
      expect(fallback.evaluate(unrelated).evidence.closures.status).toBe("unknown");
    } finally { vi.useRealTimers(); }
  });

  it("stops waiting when the plan is cancelled, even if the coordinator ignores its signal", async () => {
    const authority = coordinator();
    vi.spyOn(authority, "assess").mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const pending = requestRoadAssessments(authority, controller.signal)([{ geometry: line }]);
    const reason = new Error("superseded");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});
