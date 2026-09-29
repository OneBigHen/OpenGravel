import type { GeometryRef } from "@/domain/ride/ids";
import type { ImportBlobRecord, ImportBlobStore } from "@/application/import/import-artifact";
import { VNextDatabase, vnextDatabase } from "./db";

export interface IndexedDbImportBlobStoreOptions {
  readonly databaseName?: string;
  readonly database?: VNextDatabase;
}

/** Dexie adapter for bounded, immutable original import bytes. */
export function createIndexedDbImportBlobStore(
  options: IndexedDbImportBlobStoreOptions = {},
): ImportBlobStore {
  const database = options.database ?? (options.databaseName === undefined ? vnextDatabase() : new VNextDatabase(options.databaseName));
  return {
    async put(record: ImportBlobRecord): Promise<void> {
      await database.transaction("rw", database.blobs, async () => {
        await database.blobs.add(record);
      });
    },
    async get(originalRef: GeometryRef): Promise<ImportBlobRecord | null> {
      return (await database.blobs.get(originalRef)) ?? null;
    },
    async remove(originalRef: GeometryRef): Promise<void> {
      await database.transaction("rw", database.blobs, async () => {
        await database.blobs.delete(originalRef);
      });
    },
  };
}
