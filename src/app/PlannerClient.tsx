"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlanningTelemetry } from "@/app/use-planning-telemetry";
import { useRouter } from "next/navigation";

// The renderer's own stylesheet (canvas positioning, attribution controls). It is
// vendored with the dependency rather than forked, so MapLibre's control layout
// keeps working across versions; OpenGravel's cartography lives in map layers and
// is unaffected by it.
//
// It is imported *here*, at the composition root, and not in `PlannerMap`: the UI
// layer may not know which renderer it is drawing with (02-ARCHITECTURE-CONTRACT
// §7, 4.0 review finding 8), and a stylesheet import is that same knowledge.
import "maplibre-gl/dist/maplibre-gl.css";

import type { BasemapMode, MapHostFactory } from "@/application/map/map-host";
import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { RideDocument } from "@/domain/ride/types";
import { createClientPlanningService } from "@/application/planner/client-planning-service";
import { createPlaceNameCache } from "@/application/geocoding/place-names";
import { createHttpPlaceSearch } from "@/application/geocoding/place-search";
import {
  prepareRecordingFromPlanner,
  RIDE_FOCUS_PATH,
  startFreeRideFromPlanner,
  startRideFromHandoff,
  type RideHandoffRequest,
  type RideStartOutcome,
} from "@/application/ride-session/ride-focus-handoff";
import { createRideSessionController } from "@/application/ride-session/ride-session-controller";
import { markRideHandoff } from "@/infrastructure/storage/ride-handoff-marker";
import { createMapLibreHost } from "@/infrastructure/map/maplibre/host";
import { createAppPreparationProviders } from "@/app/preparation-providers";
import { createBrowserPositionSource } from "@/infrastructure/ride/browser-position-source";
import { inNativeShell, nativeShellPositionSource } from "@/infrastructure/ride/native-shell";
import { createLocalStorageBootstrapPointer } from "@/infrastructure/storage/bootstrap-pointer";
import { createLocalStoragePlaceNames } from "@/infrastructure/storage/place-name-storage";
import { createIndexedDbGeometryStore } from "@/infrastructure/storage/indexeddb-geometry-store";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";
import { createRideSessionRepository } from "@/infrastructure/storage/ride-session-repository";
import { createLocalStorageRideFocusPointer } from "@/infrastructure/storage/ride-focus-pointer";
import { rideFocusGeometryRefs } from "@/application/persistence/ride-focus-pointer";
import { createLibraryService } from "@/application/library/library-service";
import { createShareService } from "@/application/sharing/share-commands";
import { createShareRepository } from "@/infrastructure/storage/share-repository";
import { createPublishedShareRepository } from "@/infrastructure/storage/published-share-repository";
import { createAdvisorApiClient } from "@/infrastructure/advisor/advisor-api-client";
import { PlannerWorkspace } from "@/ui/planner/PlannerWorkspace";
import { RideAdvisorProvider, type AdvisorAppliedNext } from "@/ui/planner/RideAdvisor";
import { isPlanningInFlight, nextPlacementTarget } from "@/application/planner/planner-view-model";
import { createPlanningSessionStore } from "@/ui/stores/planning-session-store";
import { createRideDocumentStore } from "@/ui/stores/ride-document-store";
import { activeBike, createGarage, snapshotOf } from "@/application/garage/garage-model";
import { createLocalStorageGarageStorage } from "@/infrastructure/storage/garage-storage";
import type { Garage } from "@/application/garage/garage-model";
import type { PlaceMatch } from "@/application/geocoding/place-search";
import { createHomeLocationStorage } from "@/infrastructure/storage/home-location-storage";
import { createPlaceMemoryStore } from "@/infrastructure/storage/place-memory-storage";
import { publishTelemetryIntent } from "@/infrastructure/telemetry/browser-event-bridge";

/**
 * The browser composition root.
 *
 * This is the one place where the layers actually meet, which is why it is the
 * only module that imports concrete infrastructure into the UI: the IndexedDB ride
 * repository, the IndexedDB GeometryStore, the localStorage bootstrap pointer, the
 * MapLibre renderer factory and the renderer's stylesheet. Everything below it
 * depends on ports — the workspace on
 * `RideDocumentStore`/`PlanningSessionStore`/`GeometryStore`/`MapHostFactory`, the
 * map surface on `MapHost` — so `src/ui` can be scanned for a renderer import and
 * found clean (4.0 review findings 2 and 8).
 *
 * **One GeometryStore, two writers.** The planner writes candidate lines into it
 * and the workspace writes avoid-area polygons into it, and both must see the same
 * table: `buildProviderRequest` resolves an avoid area's handle through the very
 * same store the authoring path wrote to, which is what keeps an avoid area from
 * silently dropping out of a provider request (02 §4). The persisted adapter means
 * a reload finds the polygon the document still references.
 */
export interface PlannerClientProps {
  readonly basemap: BasemapMode;
  /** Safe, key-free runtime capability; the server never serializes credentials. */
  readonly advisorEnabled?: boolean;
  /**
   * The deployment prefix the vendored MapLibre assets are served under (4.0
   * review finding 2), resolved per request by the page.
   */
  readonly assetBasePath?: string;
  /** Injected host factory for tests; the MapLibre renderer by default. */
  readonly mapHostFactory?: MapHostFactory;
  /** The public Mapbox token the `mapbox` basemap draws with (OGV-D-265). */
  readonly mapboxToken?: string;
}

/**
 * The planner's local history and candidate geometry must share one store. The
 * small helper keeps that requirement at the composition boundary, where it can
 * be tested with a real recorded-library round trip.
 */
export function createPlannerLibraryService(
  repository: Parameters<typeof createLibraryService>[0],
  geometryStore: GeometryStore,
) {
  return createLibraryService(repository, { geometryStore });
}

export function PlannerClient({
  basemap,
  advisorEnabled = false,
  assetBasePath,
  mapHostFactory = createMapLibreHost,
  mapboxToken,
}: PlannerClientProps) {
  const [garage, setGarage] = useState<Garage>(createGarage);
  const garageStorage = useMemo(() => createLocalStorageGarageStorage(), []);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setGarage(garageStorage.read());
    });
    return () => window.cancelAnimationFrame(frame);
  }, [garageStorage]);
  // The token rides into the host's creation options here, so the workspace
  // never carries it (OGV-D-265).
  const hostFactory = useMemo<MapHostFactory>(
    () =>
      mapboxToken === undefined
        ? mapHostFactory
        : (container, options) => mapHostFactory(container, { ...options, mapboxToken }),
    [mapHostFactory, mapboxToken],
  );
  const bootstrapPointer = useMemo(() => createLocalStorageBootstrapPointer(), []);
  const rideFocusPointer = useMemo(() => createLocalStorageRideFocusPointer(), []);
  const advisorClient = useMemo(() => createAdvisorApiClient(), []);
  // The repository owns the hint cache too, so deleting a ride drops a hint that
  // names it and a deleted ride cannot be recovered on the next boot.
  const repository = useMemo(
    () => createRideRepository({
      bootstrapPointer,
      protectedGeometryRefs: () => rideFocusGeometryRefs(rideFocusPointer),
    }),
    [bootstrapPointer, rideFocusPointer],
  );
  const geometryStore = useMemo(() => createIndexedDbGeometryStore(), []);
  const libraryService = useMemo(
    () => createPlannerLibraryService(repository, geometryStore),
    [repository, geometryStore],
  );
  // Weather (NWS), live traffic and local recorded-road layers for the route briefing.
  const preparationProviders = useMemo(
    () => createAppPreparationProviders(assetBasePath, {
      roadHistory: { historyReader: () => libraryService.listExploreRides() },
    }),
    [assetBasePath, libraryService],
  );
  /**
   * The share service (11.1): one bound repository and the origin the opaque
   * links are minted under, read once here — the UI never assembles either.
   */
  const shareService = useMemo(
    () =>
      createShareService({
        repository: createPublishedShareRepository(createShareRepository()),
        linkBase: typeof window === "undefined" ? "" : window.location.origin,
      }),
    [],
  );
  /**
   * Place search, dropped-pin names and "Current location" (M1). The HTTP client
   * talks to OpenGravel's own `/api/geocode`; which upstream answers is a server
   * concern. Names persist in localStorage so a reload keeps them.
   */
  const places = useMemo(() => {
    const search = createHttpPlaceSearch();
    const homeStorage = createHomeLocationStorage();
    return {
      search,
      names: createPlaceNameCache({ port: search, storage: createLocalStoragePlaceNames() }),
      // In the app, the native watcher: the web view's geolocation asks a
      // second, per-site question ("localhost would like to use
      // your location") on top of the app's own grant.
      position: nativeShellPositionSource() ?? createBrowserPositionSource(),
      autoLocate: inNativeShell() ? ("ask" as const) : ("when-granted" as const),
      memory: createPlaceMemoryStore(),
      home: (): PlaceMatch | null => {
        const saved = homeStorage.read();
        if (saved.status !== "found") return null;
        return {
          id: "home",
          label: saved.label ?? "Home",
          name: "Home",
          context: saved.label ?? "",
          coordinate: saved.coordinate,
          provider: "home",
        };
      },
    };
  }, []);
  const planningSessionStore = useMemo(
    () => createPlanningSessionStore({
      service: createClientPlanningService({
        geometryStore,
        localHistoryReader: () => libraryService.listExploreRides(),
      }),
    }),
    [geometryStore, libraryService],
  );
  usePlanningTelemetry(planningSessionStore);
  const rideDocumentStore = useMemo(
    () =>
      createRideDocumentStore({
        repository,
        bootstrapPointer,
        newRideBike: () => snapshotOf(activeBike(garageStorage.read())),
      }),
    [repository, bootstrapPointer, garageStorage],
  );

  /**
   * The §28 handoff, composed here because it touches two things the UI layer
   * may not: durable storage (the session journal and the bootstrap pointer) and
   * the URL. The planner workspace asks for the typed `rideActions`; guided-route
   * decisions remain in `buildRideHandoff`, which is pure and tested on its own.
   */
  const router = useRouter();
  const rideSessions = useMemo(
    () => ({
      controller: createRideSessionController({
        repository: createRideSessionRepository(),
      }),
      pointer: rideFocusPointer,
    }),
    [rideFocusPointer],
  );
  /**
   * An applied advisor proposal plans the ride. Once a route is drawn, the
   * answer lifecycle replans every revision itself, so this only asks for the
   * first answer, and only when the ride has the points it needs.
   */
  const planAfterAdvice = useCallback((): AdvisorAppliedNext => {
    const document = rideDocumentStore.getState().document;
    const missing = document.intent.sketch === null ? nextPlacementTarget(document) : null;
    if (missing !== null) return { kind: "needs-point", point: missing };
    const planning = planningSessionStore.getState();
    const session = planning.snapshot;
    if ((session.committedBundle ?? session.lastGoodBundle) === null && !isPlanningInFlight(session.phase)) {
      void planning.begin({ rideId: document.rideId, rideRevision: document.revision, intent: document.intent });
    }
    return { kind: "planning" };
  }, [rideDocumentStore, planningSessionStore]);

  const startRide = useCallback(
    async (request: RideHandoffRequest): Promise<RideStartOutcome> => {
      // A session for *this* ride is resumed rather than duplicated (8 §1: one
      // physical activity). A session for another ride is left in its own
      // journal; picking between two active sessions is not this wave's.
      const read = rideSessions.pointer.read();
      const existingSessionId =
        read.status === "found" && read.pointer.rideId === request.rideId
          ? read.pointer.sessionId
          : null;
      const outcome = await startRideFromHandoff({
        controller: rideSessions.controller,
        pointer: rideSessions.pointer,
        request,
        now: new Date().toISOString(),
        existingSessionId,
      });
      if (outcome.outcome !== "rejected") {
        // The rider's own Start: the ride page resumes it instead of opening
        // paused as it does after a reload (ride-handoff-marker.ts).
        markRideHandoff();
        publishTelemetryIntent(existingSessionId === null ? "ride_started" : "ride_resumed", existingSessionId === null ? { source: "rider" } : {});
        router.push(RIDE_FOCUS_PATH);
      }
      return outcome;
    },
    [rideSessions, router],
  );
  const recordRide = useCallback(
    async (document: RideDocument) => {
      const outcome = await prepareRecordingFromPlanner({
        document,
        rides: repository,
        writerToken: globalThis.crypto.randomUUID(),
      });
      if (outcome.outcome === "ready") {
        publishTelemetryIntent("ride_started", { source: "rider" });
        router.push(
          `${RIDE_FOCUS_PATH}?record=1&rideId=${encodeURIComponent(document.rideId)}&revision=${document.revision}`,
        );
      }
      return outcome;
    },
    [repository, router],
  );
  const startFreeRide = useCallback(
    async (document: RideDocument): Promise<RideStartOutcome> => {
      const outcome = await startFreeRideFromPlanner({
        controller: rideSessions.controller,
        pointer: rideSessions.pointer,
        document,
        rides: repository,
        writerToken: globalThis.crypto.randomUUID(),
        now: new Date().toISOString(),
      });
      if (outcome.outcome !== "rejected") {
        markRideHandoff();
        publishTelemetryIntent("ride_started", { source: "system-location" });
        router.push(RIDE_FOCUS_PATH);
      }
      return outcome;
    },
    [repository, rideSessions, router],
  );

  return (
    <RideAdvisorProvider
      enabled={advisorEnabled}
      store={rideDocumentStore}
      client={advisorClient}
      onApplied={planAfterAdvice}
    >
      <PlannerWorkspace
        {...(mapboxToken === undefined ? {} : { mapboxToken })}
        rideDocumentStore={rideDocumentStore}
        planningSessionStore={planningSessionStore}
        geometryStore={geometryStore}
        places={places}
        preparationProviders={preparationProviders}
        bikes={garage.bikes}
        libraryService={libraryService}
        shareService={shareService}
        basemap={basemap}
        mapHostFactory={hostFactory}
        rideActions={{ start: startRide, record: recordRide, freeRide: startFreeRide }}
        {...(assetBasePath === undefined ? {} : { assetBasePath })}
      />
    </RideAdvisorProvider>
  );
}
