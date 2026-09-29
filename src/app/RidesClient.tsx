"use client";

import { useMemo } from "react";

import { createLibraryService } from "@/application/library/library-service";
import { createImportService } from "@/application/import/import-service";
import { createLocalStorageBootstrapPointer } from "@/infrastructure/storage/bootstrap-pointer";
import { createLocalStorageRideFocusPointer } from "@/infrastructure/storage/ride-focus-pointer";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";
import { rideFocusGeometryRefs } from "@/application/persistence/ride-focus-pointer";
import { createWorkerImportParser } from "@/infrastructure/import/worker-client";
import { createIndexedDbGeometryStore } from "@/infrastructure/storage/indexeddb-geometry-store";
import { createIndexedDbImportBlobStore } from "@/infrastructure/storage/indexeddb-import-blob-store";
import { RidesLibrary } from "@/ui/rides/RidesLibrary";

/** Browser composition root for the rides library and its IndexedDB adapter. */
export function RidesClient({ mapboxToken }: { readonly mapboxToken?: string } = {}) {
  const rideFocusPointer = useMemo(() => createLocalStorageRideFocusPointer(), []);
  const repository = useMemo(
    () => createRideRepository({
      bootstrapPointer: createLocalStorageBootstrapPointer(),
      protectedGeometryRefs: () => rideFocusGeometryRefs(rideFocusPointer),
    }),
    [rideFocusPointer],
  );
  const blobStore = useMemo(() => createIndexedDbImportBlobStore(), []);
  const geometryStore = useMemo(() => createIndexedDbGeometryStore(), []);
  const service = useMemo(() => createLibraryService(repository, { blobStore, geometryStore }), [repository, blobStore, geometryStore]);
  const importService = useMemo(() => createImportService({
    blobStore,
    geometryStore,
    libraryService: service,
    parse: createWorkerImportParser(),
  }), [blobStore, geometryStore, service]);
  return <RidesLibrary service={service} importService={importService} {...(mapboxToken === undefined ? {} : { mapboxToken })} />;
}
