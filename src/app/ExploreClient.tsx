"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  createExploreDerivative,
  loadCatalog,
  parseCatalogEntries,
  parseCatalogEntry,
  sourceKindForEntry,
  type CatalogEntry,
  type CatalogVariantSummary,
  roadDiscoveryScopeFromCatalog,
} from "@/application/explore/catalog";
import { discoverRoads, type RoadCandidate } from "@/application/roads/discovery";
import { createLibraryService } from "@/application/library/library-service";
import { activeBike as activeGarageBike, snapshotOf } from "@/application/garage/garage-model";
import { createIndexedDbGeometryStore } from "@/infrastructure/storage/indexeddb-geometry-store";
import { createIndexedDbImportBlobStore } from "@/infrastructure/storage/indexeddb-import-blob-store";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";
import { createLocalStorageRideFocusPointer } from "@/infrastructure/storage/ride-focus-pointer";
import { rideFocusGeometryRefs } from "@/application/persistence/ride-focus-pointer";
import { createLocalStorageGarageStorage } from "@/infrastructure/storage/garage-storage";
import { ExplorePanel } from "@/ui/explore/ExplorePanel";
import { AppBar } from "@/ui/nav/AppBar";
import type { BasemapMode, MapHostFactory } from "@/application/map/map-host";
import { createMapLibreHost } from "@/infrastructure/map/maplibre/host";
import { RouteDetail } from "@/ui/explore/RouteDetail";
import { createAppPreparationProviders } from "@/app/preparation-providers";

export interface ExploreClientProps {
  readonly detailId?: string;
  /** The basemap Explore's route map draws on; absent renders the list alone. */
  readonly basemap?: BasemapMode;
  readonly mapboxToken?: string;
  readonly assetBasePath?: string;
}

export function ExploreClient({ detailId, basemap, mapboxToken, assetBasePath }: ExploreClientProps) {
  const router = useRouter();
  const hostFactory = useMemo<MapHostFactory>(
    () =>
      mapboxToken === undefined
        ? createMapLibreHost
        : (container, options) => createMapLibreHost(container, { ...options, mapboxToken }),
    [mapboxToken],
  );
  const rideFocusPointer = useMemo(() => createLocalStorageRideFocusPointer(), []);
  const repository = useMemo(
    () => createRideRepository({
      protectedGeometryRefs: () => rideFocusGeometryRefs(rideFocusPointer),
    }),
    [rideFocusPointer],
  );
  const garageStorage = useMemo(() => createLocalStorageGarageStorage(), []);
  const geometryStore = useMemo(() => createIndexedDbGeometryStore(), []);
  const blobStore = useMemo(() => createIndexedDbImportBlobStore(), []);
  const library = useMemo(
    () => createLibraryService(repository, { blobStore, geometryStore }),
    [blobStore, geometryStore, repository],
  );
  const [entries, setEntries] = useState<readonly CatalogEntry[]>([]);
  const [detailVariants, setDetailVariants] = useState<readonly CatalogVariantSummary[]>([]);
  const [roadCandidates, setRoadCandidates] = useState<readonly RoadCandidate[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const preparationProviders = useMemo(() => createAppPreparationProviders(), []);
  /** The active garage bike, read on the client (EX-02, RS-01). */
  const [bike, setBike] = useState<{ readonly fuelRangeMiles: number; readonly reserveMiles: number } | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const active = activeGarageBike(garageStorage.read());
      setBike({ fuelRangeMiles: active.fuelRangeMiles, reserveMiles: active.reserveMiles });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [garageStorage]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rides = library.listExploreRides === undefined ? [] : await library.listExploreRides();
        if (!active) return;
        const response = await fetch("/api/catalog", { cache: "no-cache" });
        if (!response.ok) throw new Error("catalog-unavailable");
        const payload = await response.json() as { readonly routes?: readonly unknown[] };
        const catalogRoutes = parseCatalogEntries((payload.routes ?? []).flatMap((value) => {
          if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
          const route = value as Record<string, unknown>;
          return [parseCatalogEntry({ ...route, geometry: route.preview, previewGeometry: route.preview })].filter((entry) => entry !== null);
        }));
        let completeRoutes = catalogRoutes;
        let variants: CatalogVariantSummary[] = [];
        if (detailId !== undefined) {
          const detailResponse = await fetch(`/api/catalog/${encodeURIComponent(detailId)}`, { cache: "no-cache" });
          if (detailResponse.ok) {
            const detailPayload = await detailResponse.json() as { readonly route?: unknown; readonly variants?: readonly unknown[] };
            const detailEntry = parseCatalogEntry(detailPayload.route);
            if (detailEntry !== null) completeRoutes = [...catalogRoutes.filter((entry) => entry.id !== detailEntry.id), detailEntry];
            variants = (detailPayload.variants ?? []).flatMap((candidate) => {
              if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return [];
              const variant = candidate as Record<string, unknown>;
              return typeof variant.id === "string" && typeof variant.name === "string" && typeof variant.label === "string"
                && (variant.distanceKm === null || (typeof variant.distanceKm === "number" && Number.isFinite(variant.distanceKm) && variant.distanceKm >= 0))
                && typeof variant.copyCount === "number" && Number.isSafeInteger(variant.copyCount) && variant.copyCount > 0
                ? [{ id: variant.id, name: variant.name, label: variant.label, distanceKm: variant.distanceKm, copyCount: variant.copyCount }]
                : [];
            });
          }
        }
        if (!active) return;
        const loadedEntries = loadCatalog(rides, completeRoutes);
        const emptyRoadData = typeof window !== "undefined"
          && new URLSearchParams(window.location.search).get("roads") === "empty";
        setEntries(loadedEntries);
        setDetailVariants(variants);
        setRoadCandidates(emptyRoadData ? [] : discoverRoads(roadDiscoveryScopeFromCatalog(loadedEntries)));
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    })();
    return () => { active = false; };
  }, [detailId, library]);

  async function useRide(entry: CatalogEntry): Promise<void> {
    const garage = garageStorage.read();
    const sourceDocument = createExploreDerivative(entry, new Date().toISOString(), snapshotOf(activeGarageBike(garage)));
    await library.createDerivative(
      sourceKindForEntry(entry),
      entry.id,
      sourceDocument,
      { title: `${entry.name} copy` },
    );
    router.push("/");
  }

  async function addToLibrary(entry: CatalogEntry): Promise<void> {
    if (entry.sourceDocument === undefined) return;
    await library.saveNamed(entry.sourceDocument, { title: entry.name });
  }

  if (status === "loading") return <ExploreLoading />;
  if (status === "error") {
    return (
      <main id="main" className="og-explore">
        <AppBar current="/explore" />
        <p className="og-explore-status og-explore-status--error" role="alert">Explore could not load. Check your connection and try again.</p>
      </main>
    );
  }
  const detail = detailId === undefined ? null : entries.find((entry) => entry.id === detailId) ?? null;
  if (detail !== null) {
    return (
      <RouteDetail
        entry={detail}
        variants={detailVariants}
        activeBike={bike}
        onUse={useRide}
        onAddToLibrary={addToLibrary}
        preparationProviders={preparationProviders}
        {...(mapboxToken === undefined ? {} : { mapboxToken })}
        {...(basemap === undefined
          ? {}
          : { map: { hostFactory, basemap, ...(assetBasePath === undefined ? {} : { assetBasePath }) } })}
      />
    );
  }
  if (detailId !== undefined) {
    return <main id="main" className="og-explore"><p>That route is not available.</p><Link href="/explore">Back to Explore</Link></main>;
  }
  return (
    <ExplorePanel
      entries={entries}
      roadCandidates={roadCandidates}
      {...(mapboxToken === undefined ? {} : { mapboxToken })}
      {...(basemap === undefined
        ? {}
        : {
            map: {
              hostFactory,
              basemap,
              ...(assetBasePath === undefined ? {} : { assetBasePath }),
              onOpen: (entryId: string) => router.push(`/explore/${encodeURIComponent(entryId)}`),
            },
          })}
    />
  );
}

/**
 * Explore's first paint (external audit 2026-09-27): the page frame and a few
 * cards the shape of real ones while the catalog loads, instead of one line of
 * text on a blank page. The status line stays for assistive tech.
 */
function ExploreLoading() {
  return (
    <main id="main" className="og-explore" aria-busy="true">
      <AppBar current="/explore" />
      <header className="og-explore__header">
        <div className="og-explore__heading">
          <p className="og-eyebrow">Ride library</p>
          <h1>Explore</h1>
        </div>
      </header>
      <p className="og-visually-hidden" role="status">Loading Explore…</p>
      <ul className="og-explore__list og-explore__list--skeleton" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <li key={index} className="og-explore-card og-skeleton-card">
            <span className="og-skeleton og-skeleton-card__map" />
            <span className="og-skeleton og-skeleton-card__line og-skeleton-card__line--title" />
            <span className="og-skeleton og-skeleton-card__line" />
          </li>
        ))}
      </ul>
    </main>
  );
}
