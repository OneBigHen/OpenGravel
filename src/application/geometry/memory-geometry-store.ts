/**
 * In-memory GeometryStore (17-IMPLEMENTATION-PLAN Task 1.4).
 *
 * A Map-backed implementation of the port with no browser, framework or Dexie
 * dependency, so the same contract can be exercised in unit/integration tests,
 * in SSR and in any future non-browser shell. It lives in the application layer
 * beside the port because it *is* the port's reference behavior: the IndexedDB
 * adapter is judged by agreeing with it.
 *
 * It stores the frozen record `buildGeometryRecord` returns, so a `get` hands
 * out exactly what a `put` accepted — there is no second copy to drift.
 */

import type { GeometryPayload, GeometryRecord } from "@/domain/geometry/types";
import type { GeometryRef } from "@/domain/ride/ids";
import {
  buildGeometryRecord,
  type GeometryPutOptions,
  type GeometryStore,
} from "./geometry-store";

/** A fresh, empty store. Two calls share no state. */
export function createMemoryGeometryStore(): GeometryStore {
  const records = new Map<GeometryRef, GeometryRecord>();

  return {
    async put(
      payload: GeometryPayload,
      options: GeometryPutOptions,
    ): Promise<GeometryRecord> {
      const record = buildGeometryRecord(payload, options);
      records.set(record.geometryRef, record);
      return record;
    },

    async get(ref: GeometryRef): Promise<GeometryRecord | null> {
      return records.get(ref) ?? null;
    },

    async has(ref: GeometryRef): Promise<boolean> {
      return records.has(ref);
    },

    async remove(ref: GeometryRef): Promise<void> {
      records.delete(ref);
    },
  };
}
