import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { createRoadEntityRepository } from "@/infrastructure/storage/road-entity-repository";
import { VNextDatabase } from "@/infrastructure/storage/db";
import { createRoadEntity } from "@/domain/roads/road-entity";
import { asRoadEntityId } from "@/domain/ride/ids";

let sequence = 0;

function database(): VNextDatabase {
  sequence += 1;
  return new VNextDatabase(`opengravel-vnext-roads-${sequence}`);
}

describe("RoadEntityRepository", () => {
  it("round-trips entities and recomputes span and evidence references", async () => {
    const entity = createRoadEntity({
      name: "Main St",
      class: "secondary",
      endpoints: [
        { lon: -75.1, lat: 40.1 },
        { lon: -75.2, lat: 40.2 },
      ],
      firstSeen: "2026-09-17T12:00:00.000Z",
      lastSeen: "2026-09-17T12:00:00.000Z",
      spans: ["span-b", "span-a"],
      evidenceRefs: ["evidence-b"],
    });
    const db = database();
    const repository = createRoadEntityRepository({ database: db });

    await repository.saveEntity(entity);
    await repository.saveSpan({
      fingerprint: "span-c",
      entityId: entity.id,
      observedAt: "2026-09-17T12:00:00.000Z",
    });
    await repository.saveEvidence({
      id: "evidence-a",
      entityId: entity.id,
      source: "recorded-ride",
      observedAt: "2026-09-17T12:00:00.000Z",
      value: "paved-smooth",
      confidence: 0.8,
    });

    await expect(repository.getEntity(entity.id)).resolves.toMatchObject({
      id: entity.id,
      spans: ["span-a", "span-b", "span-c"],
      evidenceRefs: ["evidence-a", "evidence-b"],
    });
    await expect(repository.listEntities()).resolves.toHaveLength(1);
    await expect(repository.listEvidence(entity.id)).resolves.toHaveLength(1);
    expect(asRoadEntityId(entity.id)).toBe(entity.id);
  });
});
