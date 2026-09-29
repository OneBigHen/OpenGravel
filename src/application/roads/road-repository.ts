/** Persistence port for RoadEntity read models (Task 6.2; 5.1 schema owner). */

import type { RoadEntity, RoadGeometryFingerprint } from "@/domain/roads/road-entity";
import type { RoadEntityId } from "@/domain/ride/ids";
import type { RoadEvidenceRecord } from "./road-evidence";

/** The durable relation that lets an entity rebuild its span list. */
export interface RoadSpanRecord {
  /** Optional caller key; the adapter scopes it by entity to prevent collisions. */
  readonly id?: string;
  readonly fingerprint: RoadGeometryFingerprint;
  readonly entityId: RoadEntityId;
  readonly observedAt: string;
}

export interface RoadEntityRepositoryPort {
  saveEntity(entity: RoadEntity): Promise<void>;
  saveSpan(span: RoadSpanRecord): Promise<void>;
  saveEvidence(record: RoadEvidenceRecord): Promise<void>;
  getEntity(entityId: RoadEntityId): Promise<RoadEntity | null>;
  listEntities(): Promise<readonly RoadEntity[]>;
  listEvidence(entityId: RoadEntityId): Promise<readonly RoadEvidenceRecord[]>;
}

/**
 * Rebuilds derived references from their durable child rows in a stable order.
 * The caller supplies the entity's identity metadata; no aggregate is inferred
 * from insertion order, and no existing lineage entry is discarded.
 */
export function recomputeRoadEntity(
  entity: RoadEntity,
  spans: readonly RoadSpanRecord[],
  evidence: readonly RoadEvidenceRecord[],
): RoadEntity {
  const spanFingerprints = [...new Set(spans
    .filter((span) => span.entityId === entity.id)
    .map((span) => span.fingerprint))]
    .sort((left, right) => left.localeCompare(right));
  const evidenceRefs = [...new Set([
    ...entity.evidenceRefs,
    ...evidence.filter((record) => record.entityId === entity.id).map((record) => record.id),
  ])].sort((left, right) => left.localeCompare(right));
  const dates = [
    entity.firstSeen,
    entity.lastSeen,
    ...spans.filter((span) => span.entityId === entity.id).map((span) => span.observedAt),
    ...evidence.filter((record) => record.entityId === entity.id).map((record) => record.observedAt),
  ].sort();
  return {
    ...entity,
    firstSeen: dates[0] ?? entity.firstSeen,
    lastSeen: dates.at(-1) ?? entity.lastSeen,
    spans: spanFingerprints,
    evidenceRefs,
  };
}
