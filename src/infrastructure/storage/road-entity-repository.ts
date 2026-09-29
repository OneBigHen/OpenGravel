/** Dexie adapter for the RoadEntity read model (Task 6.2; schema v4). */

import { deepFreeze } from "@/domain/util/freeze";
import type { RoadEntity } from "@/domain/roads/road-entity";
import type { RoadEntityId } from "@/domain/ride/ids";
import type {
  RoadEntityRepositoryPort,
  RoadSpanRecord,
} from "@/application/roads/road-repository";
import { recomputeRoadEntity } from "@/application/roads/road-repository";
import type { RoadEvidenceRecord } from "@/application/roads/road-evidence";
import { VNextDatabase, vnextDatabase } from "./db";

export interface RoadEntityRepositoryOptions {
  readonly database?: VNextDatabase;
  readonly databaseName?: string;
}

function storedEntity(entity: RoadEntity): RoadEntity {
  return deepFreeze({
    ...entity,
    lineage: entity.lineage.map((entry) => ({ ...entry })),
    spans: [...entity.spans],
    evidenceRefs: [...entity.evidenceRefs],
  });
}

function storedSpan(span: RoadSpanRecord): RoadSpanRecord & { readonly id: string } {
  return {
    id: `${span.entityId}\u0000${span.fingerprint}`,
    fingerprint: span.fingerprint,
    entityId: span.entityId,
    observedAt: span.observedAt,
  };
}

/** Creates a repository over the shared VNext database or an isolated test DB. */
export function createRoadEntityRepository(
  options: RoadEntityRepositoryOptions = {},
): RoadEntityRepositoryPort {
  const database = options.database
    ?? (options.databaseName === undefined ? vnextDatabase() : new VNextDatabase(options.databaseName));

  async function refresh(entity: RoadEntity): Promise<RoadEntity> {
    const [spans, evidence] = await Promise.all([
      database.roadSpans.where("entityId").equals(entity.id).toArray(),
      database.roadEvidence.where("entityId").equals(entity.id).toArray(),
    ]);
    return deepFreeze(recomputeRoadEntity(entity, spans, evidence));
  }

  return {
    async saveEntity(entity): Promise<void> {
      await database.transaction("rw", database.roadEntities, database.roadSpans, database.roadEvidence, async () => {
        await database.roadEntities.put(storedEntity(entity));
        for (const fingerprint of entity.spans) {
          await database.roadSpans.put(storedSpan({
            fingerprint,
            entityId: entity.id,
            observedAt: entity.lastSeen,
          }));
        }
      });
    },

    async saveSpan(span: RoadSpanRecord): Promise<void> {
      await database.transaction("rw", database.roadEntities, database.roadSpans, database.roadEvidence, async () => {
        await database.roadSpans.put(storedSpan(span));
        const entity = await database.roadEntities.get(span.entityId);
        if (entity !== undefined) await database.roadEntities.put(await refresh(entity));
      });
    },

    async saveEvidence(record: RoadEvidenceRecord): Promise<void> {
      await database.transaction("rw", database.roadEntities, database.roadSpans, database.roadEvidence, async () => {
        await database.roadEvidence.put({ ...record });
        const entity = await database.roadEntities.get(record.entityId);
        if (entity !== undefined) await database.roadEntities.put(await refresh(entity));
      });
    },

    async getEntity(entityId: RoadEntityId): Promise<RoadEntity | null> {
      const entity = await database.roadEntities.get(entityId);
      return entity === undefined ? null : refresh(entity);
    },

    async listEntities(): Promise<readonly RoadEntity[]> {
      const entities = await database.roadEntities.toArray();
      const refreshed = await Promise.all(entities.map((entity) => refresh(entity)));
      return refreshed.sort((left, right) => left.id.localeCompare(right.id));
    },

    async listEvidence(entityId: RoadEntityId): Promise<readonly RoadEvidenceRecord[]> {
      const records = await database.roadEvidence.where("entityId").equals(entityId).toArray();
      return deepFreeze(records.sort((left, right) =>
        right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id)));
    },
  };
}
