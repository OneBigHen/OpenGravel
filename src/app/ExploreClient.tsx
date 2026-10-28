"use client";

import dynamic from "next/dynamic";

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
  type LibraryExploreRide,
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
import { prepareExploreRoute } from "@/application/explore/ride-this";
import { ExplorePanel } from "@/ui/explore/ExplorePanel";
import { RouteDetailSkeleton } from "@/ui/explore/RouteDetailSkeleton";
import { rememberListPosition } from "@/ui/explore/list-position";
import { AppBar } from "@/ui/nav/AppBar";
import type { BasemapMode, MapHostFactory } from "@/application/map/map-host";
import { createMapLibreHost } from "@/infrastructure/map/maplibre/host";
import { useActivityMode } from "@/ui/stores/activity-mode";
import { HikeExplore } from "@/app/HikeExplore";
import { hiddenRouteIds } from "@/ui/explore/hidden-routes";

// The detail page owns the heavy detail-only modules (map host, preparation
// providers). Importing it through the wrapper keeps them out of the Explore
// list's bundle and off its first interaction.
const RouteDetail = dynamic(() => import("./ExploreRouteDetail").then((mod) => mod.ExploreRouteDetail), { loading: () => <RouteDetailSkeleton /> });

export interface ExploreClientProps {
  readonly detailId?: string;
  /** The basemap Explore's route map draws on; absent renders the list alone. */
  readonly basemap?: BasemapMode;
  readonly mapboxToken?: string;
  readonly assetBasePath?: string;
}

/** A route page's full line, which the list's card preview cannot stand in for. */
type DetailState = { readonly id: string; readonly attempt: number } & (
  | { readonly status: "loading" }
  | { readonly status: "ready" }
  | { readonly status: "error"; readonly kind: "missing" | "unreachable" }
);

export function ExploreClient(props: ExploreClientProps) {
  const mode = useActivityMode();
  if (mode === "hike" && props.detailId === undefined) return <HikeExplore />;
  return <RideExploreClient {...props} />;
}

function RideExploreClient({ detailId, basemap, mapboxToken, assetBasePath }: ExploreClientProps) {
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
  const [libraryRides, setLibraryRides] = useState<readonly LibraryExploreRide[] | null>(null);
  const [catalogRoutes, setCatalogRoutes] = useState<readonly CatalogEntry[] | null>(null);
  const [loadedDetail, setLoadedDetail] = useState<{
    readonly id: string;
    readonly entry: CatalogEntry;
    readonly variants: readonly CatalogVariantSummary[];
  } | null>(null);
  const [detailState, setDetailState] = useState<DetailState>({ id: "", attempt: 0, status: "loading" });
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [hiddenIds] = useState<ReadonlySet<string>>(() => hiddenRouteIds());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
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
        // A route page only needs the saved rides to know whether to fetch its
        // own line, so it starts now instead of waiting on the whole catalog.
        setLibraryRides(rides);
        const response = await fetch("/api/catalog", { cache: "no-cache" });
        if (!response.ok) throw new Error("catalog-unavailable");
        const payload = await response.json() as { readonly routes?: readonly unknown[] };
        // The list only carries a card line, so it is flagged as incomplete: a
        // route page must fetch its own full geometry before planning/exporting.
        const routes = parseCatalogEntries((payload.routes ?? []).flatMap((value) => {
          if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
          const route = value as Record<string, unknown>;
          return [parseCatalogEntry({
            ...route,
            geometry: route.preview,
            previewGeometry: route.preview,
            geometryComplete: false,
          })].filter((entry) => entry !== null);
        }));
        if (!active) return;
        setCatalogRoutes(routes);
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    })();
    return () => { active = false; };
  }, [library]);

  useEffect(() => {
    if (detailId === undefined || libraryRides === null) return;
    // A saved ride comes from the local library with its own geometry; there is
    // no catalog route to fetch for it, and the entry renders from `entries`.
    if (libraryRides.some((ride) => String(ride.summary.rideId) === detailId)) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/catalog/${encodeURIComponent(detailId)}`, { cache: "no-cache" });
        if (!active) return;
        if (!response.ok) {
          // A missing route is not a network failure: only the latter earns a retry.
          setDetailState({ id: detailId, attempt: detailAttempt, status: "error", kind: response.status === 404 ? "missing" : "unreachable" });
          return;
        }
        const payload = await response.json() as { readonly route?: unknown; readonly variants?: readonly unknown[] };
        const entry = parseCatalogEntry(payload.route);
        if (!active) return;
        if (entry === null) {
          setDetailState({ id: detailId, attempt: detailAttempt, status: "error", kind: "unreachable" });
          return;
        }
        const variants = (payload.variants ?? []).flatMap((candidate) => {
          if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return [];
          const variant = candidate as Record<string, unknown>;
          return typeof variant.id === "string" && typeof variant.name === "string" && typeof variant.label === "string"
            && (variant.distanceKm === null || (typeof variant.distanceKm === "number" && Number.isFinite(variant.distanceKm) && variant.distanceKm >= 0))
            && typeof variant.copyCount === "number" && Number.isSafeInteger(variant.copyCount) && variant.copyCount > 0
            ? [{ id: variant.id, name: variant.name, label: variant.label, distanceKm: variant.distanceKm, copyCount: variant.copyCount }]
            : [];
        });
        setLoadedDetail({ id: detailId, entry, variants });
        setDetailState({ id: detailId, attempt: detailAttempt, status: "ready" });
      } catch {
        if (active) setDetailState({ id: detailId, attempt: detailAttempt, status: "error", kind: "unreachable" });
      }
    })();
    return () => { active = false; };
  }, [detailAttempt, detailId, libraryRides]);

  const detailEntry = loadedDetail !== null && loadedDetail.id === detailId ? loadedDetail.entry : null;
  const detailVariants = loadedDetail !== null && loadedDetail.id === detailId ? loadedDetail.variants : [];
  const visibleDetailState: DetailState = detailState.id === detailId && detailState.attempt === detailAttempt
    ? detailState
    : { id: detailId ?? "", attempt: detailAttempt, status: "loading" };

  const entries = useMemo(() => {
    const catalog = catalogRoutes ?? [];
    const withDetail = detailEntry === null
      ? catalog
      : [...catalog.filter((entry) => entry.id !== detailEntry.id), detailEntry];
    const loaded = loadCatalog(libraryRides ?? [], withDetail);
    // Hiding a catalog route is a local preference; the route page stays reachable.
    return detailId === undefined
      ? loaded.filter((entry) => entry.source !== "catalog" || !hiddenIds.has(entry.id))
      : loaded;
  }, [catalogRoutes, detailEntry, detailId, hiddenIds, libraryRides]);
  const roadCandidates = useMemo<readonly RoadCandidate[]>(() => {
    const emptyRoadData = typeof window !== "undefined"
      && new URLSearchParams(window.location.search).get("roads") === "empty";
    return emptyRoadData ? [] : discoverRoads(roadDiscoveryScopeFromCatalog(entries));
  }, [entries]);

  /**
   * Open this ride in the planner, ready to start.
   *
   * The ride is opened exactly the way one from My rides opens: a derivative
   * document becomes the planner's active draft and the planner restores it. A
   * published catalog route also hands over the line the rider just read, so the
   * planner opens on that line with Start ride already there instead of planning
   * the same ride again. The title is the route's own name.
   */
  async function useRide(entry: CatalogEntry): Promise<void> {
    const garage = garageStorage.read();
    const sourceDocument = createExploreDerivative(entry, new Date().toISOString(), snapshotOf(activeGarageBike(garage)));
    const opened = await library.createDerivative(
      sourceKindForEntry(entry),
      entry.id,
      sourceDocument,
      { title: entry.name },
    );
    try {
      await prepareExploreRoute(entry, opened, geometryStore);
    } catch {
      // A route that could not be handed over is still opened: the planner
      // plans it, which is what it does for every other ride.
    }
    router.push("/");
  }

  /** Keep a catalog ride in My rides without leaving the page it was read on. */
  async function saveRide(entry: CatalogEntry): Promise<void> {
    const garage = garageStorage.read();
    const sourceDocument = createExploreDerivative(entry, new Date().toISOString(), snapshotOf(activeGarageBike(garage)));
    await library.createDerivative(sourceKindForEntry(entry), entry.id, sourceDocument, { title: entry.name });
  }

  // A route page renders from its own fetch; only the list waits on the catalog.
  const routePageReady = detailId !== undefined && libraryRides !== null;
  if (status === "loading" && !routePageReady) return <ExploreLoading />;
  if (status === "error" && !routePageReady) {
    return (
      <main id="main" className="og-explore">
        <AppBar current="/explore" />
        <p className="og-explore-status og-explore-status--error" role="alert">Explore could not load. Check your connection and try again.</p>
      </main>
    );
  }
  const detail = detailId === undefined ? null : entries.find((entry) => entry.id === detailId) ?? null;
  if (detailId !== undefined) {
    // Only a route with its own full line may be planned, exported or shared.
    if (detail !== null && detail.geometryComplete !== false) {
      return (
        <RouteDetail
          entry={detail}
          variants={detailVariants}
          activeBike={bike}
          onUse={useRide}
          onSave={saveRide}
          {...(mapboxToken === undefined ? {} : { mapboxToken })}
          {...(basemap === undefined
            ? {}
            : { map: { hostFactory, basemap, ...(assetBasePath === undefined ? {} : { assetBasePath }) } })}
        />
      );
    }
    if (visibleDetailState.status === "error") {
      return <RouteLoadFailure kind={visibleDetailState.kind} onRetry={() => setDetailAttempt((value) => value + 1)} />;
    }
    if (visibleDetailState.status === "ready") {
      return <RouteLoadFailure kind="missing" onRetry={() => setDetailAttempt((value) => value + 1)} />;
    }
    return <RouteDetailSkeleton />;
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
              onOpen: (entryId: string) => {
                // The way back lands on this card, not the top of the list.
                rememberListPosition(window.scrollY);
                router.push(`/explore/${encodeURIComponent(entryId)}`);
              },
            },
          })}
    />
  );
}

/** The route page could not get the full line; the list's preview is not a substitute. */
function RouteLoadFailure({ kind, onRetry }: {
  readonly kind: "missing" | "unreachable";
  readonly onRetry: () => void;
}) {
  return (
    <main id="main" className="og-explore">
      <AppBar current="/explore" />
      <div className="og-explore-detail-status">
        <p className="og-explore-status" role="alert">
          {kind === "missing"
            ? "That route is not on Explore. It may have been removed."
            : "That route could not be loaded. Check your connection and try again."}
        </p>
        <div className="og-explore-detail-status__actions">
          <Link className="og-secondary" href="/explore">Back to Explore</Link>
          {kind === "unreachable" ? <button type="button" className="og-secondary" onClick={onRetry}>Try again</button> : null}
        </div>
      </div>
    </main>
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
          <h1>Explore</h1>
        </div>
      </header>
      <p className="og-visually-hidden" role="status">Loading Explore…</p>
      <ul className="og-explore__list og-explore__list--skeleton" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <li key={index} className="og-explore-card og-explore-card--ride og-skeleton-card">
            <span className="og-skeleton og-skeleton-card__map" />
            <span className="og-skeleton og-skeleton-card__line og-skeleton-card__line--title" />
            <span className="og-skeleton og-skeleton-card__line" />
          </li>
        ))}
      </ul>
    </main>
  );
}
