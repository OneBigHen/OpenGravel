import { createLibraryService, type LibraryService } from "@/application/library/library-service";
import { createIndexedDbGeometryStore } from "@/infrastructure/storage/indexeddb-geometry-store";
import { createIndexedDbImportBlobStore } from "@/infrastructure/storage/indexeddb-import-blob-store";

export interface SettingsLibraryStoreOptions {
  /**
   * Test-only override of the database name, so a suite can isolate its data
   * without clearing the real `opengravel-vnext` database. Production code
   * omits it and gets the VNext namespace.
   */
  readonly databaseName?: string;
}

/**
 * Settings exports the library, so it must be composed with the same durable
 * stores the library screens use. Without them a recorded ride's trace throws
 * ("geometry is unavailable") and an import's route line and original file are
 * silently missing from the export — exactly the data a backup exists for.
 */
export function createSettingsLibraryService(
  repository: Parameters<typeof createLibraryService>[0],
  options: SettingsLibraryStoreOptions = {},
): LibraryService {
  return createLibraryService(repository, {
    geometryStore: createIndexedDbGeometryStore(options),
    blobStore: createIndexedDbImportBlobStore(options),
  });
}
