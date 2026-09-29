import { describe, expect, it } from "vitest";

import {
  createRenamedRoadEntity,
  createRoadEntity,
  normalizeRoadName,
  roadEntityIdFor,
  sameRoadIdentity,
  withRoadLineage,
} from "@/domain/roads/road-entity";
import { asRoadEntityId } from "@/domain/ride/ids";

const ENDPOINTS = [
  { lon: -75.12345, lat: 40.12345 },
  { lon: -75.23456, lat: 40.23456 },
] as const;

const SEEN = "2026-09-17T12:00:00.000Z";

function road(name: string, overrides: Record<string, unknown> = {}) {
  return createRoadEntity({
    name,
    class: "secondary",
    endpoints: ENDPOINTS,
    firstSeen: SEEN,
    lastSeen: SEEN,
    ...overrides,
  });
}

describe("RoadEntity identity", () => {
  it("keeps street abbreviations and full names in one identity", () => {
    expect(normalizeRoadName("Main St")).toBe("main st");
    expect(normalizeRoadName("Main Street")).toBe("main st");
    expect(
      roadEntityIdFor({ name: "Main St", class: "secondary", endpoints: ENDPOINTS }),
    ).toBe(
      roadEntityIdFor({ name: "Main Street", class: "secondary", endpoints: ENDPOINTS }),
    );
  });

  it("keeps route-reference aliases in one identity", () => {
    expect(normalizeRoadName("PA-309")).toBe("pa 309");
    expect(normalizeRoadName("Pennsylvania Route 309")).toBe("pa 309");
    expect(normalizeRoadName("PA Route 309")).toBe("pa 309");
  });

  it("normalizes case, punctuation, repeated whitespace, and accents", () => {
    expect(normalizeRoadName("  São José  ROAD ")).toBe("sao jose rd");
  });

  it("allows an adapter-scoped alias without changing the default table", () => {
    const tables = { aliases: { "county route 12": "cr 12" } } as const;
    expect(normalizeRoadName("County Route 12", tables)).toBe("cr 12");
    expect(normalizeRoadName("County Route 12")).not.toBe("cr 12");
  });

  it("does not fork an identity for endpoint noise inside the same cell", () => {
    const nearby = ENDPOINTS.map((point) => ({ lon: point.lon + 0.00001, lat: point.lat + 0.00001 }));
    expect(roadEntityIdFor({ name: "Main St", class: "secondary", endpoints: ENDPOINTS })).toBe(
      roadEntityIdFor({ name: "Main St", class: "secondary", endpoints: nearby }),
    );
  });

  it("does not fork an identity when the same road is traversed in reverse", () => {
    expect(sameRoadIdentity(
      { name: "Main St", class: "secondary", endpoints: ENDPOINTS },
      { name: "Main St", class: "secondary", endpoints: [...ENDPOINTS].reverse() },
    )).toBe(true);
  });

  it("forks parallel roads whose endpoints occupy different cells", () => {
    const parallel = ENDPOINTS.map((point) => ({ lon: point.lon + 0.001, lat: point.lat }));
    expect(roadEntityIdFor({ name: "Main St", class: "secondary", endpoints: ENDPOINTS })).not.toBe(
      roadEntityIdFor({ name: "Main St", class: "secondary", endpoints: parallel }),
    );
  });

  it("forks a road when its class changes", () => {
    expect(roadEntityIdFor({ name: "Main St", class: "secondary", endpoints: ENDPOINTS })).not.toBe(
      roadEntityIdFor({ name: "Main St", class: "primary", endpoints: ENDPOINTS }),
    );
  });

  it("forks a renamed road even when its endpoints and class stay the same", () => {
    expect(roadEntityIdFor({ name: "Old Road", class: "secondary", endpoints: ENDPOINTS })).not.toBe(
      roadEntityIdFor({ name: "New Road", class: "secondary", endpoints: ENDPOINTS }),
    );
  });

  it("creates an explicit rename lineage entry instead of overwriting the parent", () => {
    const previous = road("Old Road");
    const renamed = createRenamedRoadEntity(previous, {
      name: "New Road",
      class: "secondary",
      endpoints: ENDPOINTS,
      firstSeen: SEEN,
      lastSeen: "2026-09-18T12:00:00.000Z",
    });
    expect(renamed.id).not.toBe(previous.id);
    expect(renamed.lineage).toEqual([{ parentId: previous.id, reason: "renamed" }]);
  });

  it("represents a split with separate child ids and parent lineage", () => {
    const parent = road("Forest Road");
    const first = road("Forest Road north", {
      endpoints: [ENDPOINTS[0], { lon: -75.18, lat: 40.18 }],
      lineage: [{ parentId: parent.id, reason: "split" }],
    });
    const second = road("Forest Road south", {
      endpoints: [{ lon: -75.18, lat: 40.18 }, ENDPOINTS[1]],
      lineage: [{ parentId: parent.id, reason: "split" }],
    });
    expect(first.id).not.toBe(second.id);
    expect(first.lineage[0]?.parentId).toBe(parent.id);
    expect(second.lineage[0]?.parentId).toBe(parent.id);
  });

  it("represents a merge with every parent lineage entry", () => {
    const left = road("Left Road");
    const right = road("Right Road");
    const merged = road("Merged Road", {
      lineage: [
        { parentId: left.id, reason: "merged" },
        { parentId: right.id, reason: "merged" },
      ],
    });
    expect(merged.lineage).toEqual([
      { parentId: left.id, reason: "merged" },
      { parentId: right.id, reason: "merged" },
    ]);
  });

  it("deduplicates span and evidence references without changing their order", () => {
    const entity = road("Main St", {
      spans: ["span-b", "span-a", "span-b"],
      evidenceRefs: ["evidence-2", "evidence-1", "evidence-2"],
    });
    expect(entity.spans).toEqual(["span-b", "span-a"]);
    expect(entity.evidenceRefs).toEqual(["evidence-2", "evidence-1"]);
  });

  it("freezes the entity and its lineage collections", () => {
    const entity = road("Main St", { lineage: [{ reason: "graph-update" }] });
    expect(Object.isFrozen(entity)).toBe(true);
    expect(Object.isFrozen(entity.lineage)).toBe(true);
    expect(Object.isFrozen(entity.spans)).toBe(true);
  });

  it("adds lineage immutably and leaves the original entity unchanged", () => {
    const entity = road("Main St");
    const linked = withRoadLineage(entity, { parentId: asRoadEntityId("road_old"), reason: "graph-update" });
    expect(entity.lineage).toEqual([]);
    expect(linked.lineage).toEqual([{ parentId: "road_old", reason: "graph-update" }]);
  });

  it("rejects identities without at least two usable endpoints", () => {
    expect(() => roadEntityIdFor({ name: "Main St", class: "secondary", endpoints: [] })).toThrow(
      /at least two endpoint/i,
    );
    expect(() => roadEntityIdFor({ name: "Main St", class: "secondary", endpoints: [{ lon: 1, lat: Number.NaN }, ENDPOINTS[1]] })).toThrow(
      /finite endpoint/i,
    );
  });

  it("does not silently merge different named entities", () => {
    const first = road("First Road");
    const second = road("Second Road");
    expect(first.id).not.toBe(second.id);
    expect(second.lineage).toEqual([]);
  });
});
