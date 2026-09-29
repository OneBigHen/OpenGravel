/**
 * IndexedDB GeometryStore adapter (17-IMPLEMENTATION-PLAN Task 1.4).
 *
 * The browser implementation of the `GeometryStore` port, backed by Dexie over
 * the VNext database (`opengravel-vnext`, table `geometry`, keyed by
 * `geometryRef`; see `./db.ts`). This module is the ONLY place Dexie is touched
 * for geometry: later tasks add tables to the same schema owner instead of
 * opening their own database.
 *
 * ## Why the adapter is thin
 *
 * Everything that decides *what* a record is — minting a new ref, validating the
 * payload, freezing the result — lives in `buildGeometryRecord`, so this file
 * only moves the frozen record in and out of IndexedDB. That is what makes the
 * memory and IndexedDB adapters provably agree: there is no second
 * implementation of the immutability contract to keep in sync.
 *
 * ## Storage details
 *
 * - Writes run inside one `rw` transaction on the geometry table, so a record is
 *   never partially visible.
 * - The stored value is the full `GeometryRecord`. A payload is plain,
 *   structured-clone-safe data, so it round-trips unchanged; there is no
 *   custom serializer to drift.
 * - A read returns a fresh structured clone from Dexie, which is then frozen
 *   again: freezing is per-instance and does not survive serialization.
 */

import type { GeometryPayload, GeometryRecord } from "@/domain/geometry/types";
import type { GeometryRef } from "@/domain/ride/ids";
import { deepFreeze } from "@/domain/util/freeze";
import {
  buildGeometryRecord,
  type GeometryPutOptions,
  type GeometryStore,
} from "@/application/geometry/geometry-store";
import { VNextDatabase, vnextDatabase } from "./db";

/** Options for the IndexedDB adapter. */
export interface IndexedDbGeometryStoreOptions {
  /**
   * Test-only override of the database name, so a suite can isolate its data
   * without clearing the real `opengravel-vnext` database. Production code
   * omits it and gets the VNext namespace.
   */
  readonly databaseName?: string;
}

/** A Dexie-backed store over the VNext `geometry` table. */
export function createIndexedDbGeometryStore(
  options: IndexedDbGeometryStoreOptions = {},
): GeometryStore {
  const database =
    options.databaseName === undefined
      ? vnextDatabase()
      : new VNextDatabase(options.databaseName);

  return {
    async put(
      payload: GeometryPayload,
      putOptions: GeometryPutOptions,
    ): Promise<GeometryRecord> {
      const record = buildGeometryRecord(payload, putOptions);
      await database.transaction("rw", database.geometry, async () => {
        await database.geometry.put(record);
      });
      return record;
    },

    async get(ref: GeometryRef): Promise<GeometryRecord | null> {
      const record = await database.geometry.get(ref);
      return record === undefined ? null : deepFreeze(record);
    },

    async has(ref: GeometryRef): Promise<boolean> {
      // Counts through the primary key instead of loading the payload: a
      // `has` check on a 50k-point recording must not deserialize it.
      const matches = await database.geometry.where(":id").equals(ref).count();
      return matches > 0;
    },

    async remove(ref: GeometryRef): Promise<void> {
      await database.transaction("rw", database.geometry, async () => {
        await database.geometry.delete(ref);
      });
    },
  };
}
