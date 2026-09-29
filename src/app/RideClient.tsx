"use client";

import { useEffect, useMemo } from "react";
// The renderer's own stylesheet, imported at the composition root exactly as the
// planner does: the UI layer may not know which renderer it draws with
// (02-ARCHITECTURE-CONTRACT §7, 4.0 review finding 8).
import "maplibre-gl/dist/maplibre-gl.css";

import type { BasemapMode, MapHostFactory } from "@/application/map/map-host";
import { createRideSessionController } from "@/application/ride-session/ride-session-controller";
import { createClientRouteCandidateProvider } from "@/application/planner/client-planning-service";
import { createRideNavigationEngine, type ResolvedNavigationRoute } from "@/application/ride-session/navigation-engine";
import { guidedNativeNavigationPayload } from "@/application/ride-session/native-navigation-contract";
import type { PositionSource } from "@/application/ride-session/position-pipeline";
import { nativeNavigationBridge } from "@/infrastructure/native/ferrostar-bridge";
import { createFerrostarPositionSource } from "@/infrastructure/native/ferrostar-position-source";
import { buildGuidedNavigationRoute } from "@/application/ride-session/navigation-route";
import { createRideRecordingWorkflow } from "@/application/ride-session/recording-workflow";
import { createFreeRideTelemetry, recordingPositionFromFix } from "@/application/ride-session/free-ride-telemetry";
import { createGuidedReroutePlanner } from "@/application/ride-session/guided-reroute";
import { createRideActivitySync } from "@/application/ride-session/ride-activity";
import { haptic } from "@/infrastructure/native/native-feel";
import { createClientFreeRideServices } from "@/application/free-ride/client-services";
import { parseOfferCatalog } from "@/application/free-ride/ride-offers";
import {
  deriveLiveSuggestionWorkload,
  evaluateLiveSuggestion,
} from "@/application/free-ride/live-suggestions";
import { createLibraryService } from "@/application/library/library-service";
import { createBrowserPositionSource } from "@/infrastructure/ride/browser-position-source";
import { createBrowserSpeech } from "@/infrastructure/ride/browser-speech";
import { isVoiceMuted, mutableSpeech, subscribeVoiceMuted } from "@/application/ride-session/voice-mute";
import { readNavScreen } from "@/ui/navigation/nav-screen";
import {
  inNativeShell,
  nativeShellPositionSource,
  nativeShellRideActivity,
  nativeShellSpeech,
  withTurnAlerts,
} from "@/infrastructure/ride/native-shell";
import { createBrowserRideEnvironment } from "@/infrastructure/ride/browser-ride-environment";
import { createFixturePositionSource } from "@/infrastructure/ride/fixture-position-source";
import { consumeRideHandoff } from "@/infrastructure/storage/ride-handoff-marker";
import { createMapLibreHost } from "@/infrastructure/map/maplibre/host";
import { createHttpPlacesSource } from "@/infrastructure/places/http-places-source";
import { createHttpMapLayersSource } from "@/infrastructure/map-layers/http-map-layers-source";
import { createIndexedDbGeometryStore } from "@/infrastructure/storage/indexeddb-geometry-store";
import { createRideSessionRepository } from "@/infrastructure/storage/ride-session-repository";
import { createRecordingRepository } from "@/infrastructure/storage/recording-repository";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";
import { createHomeLocationStorage } from "@/infrastructure/storage/home-location-storage";
import { unknownEvidence } from "@/domain/evidence/types";
import { speedLimitAt } from "@/domain/route/types";
import { createLocalStorageRideFocusPointer } from "@/infrastructure/storage/ride-focus-pointer";
import { createLocalStorageFreeRideTelemetry } from "@/infrastructure/storage/free-ride-telemetry-storage";
import { createLocalStorageRiderSettings } from "@/infrastructure/storage/rider-settings-storage";
import { rideFocusGeometryRefs } from "@/application/persistence/ride-focus-pointer";
import { createRideFocusStore } from "@/ui/stores/ride-focus-store";
import type { RideId } from "@/domain/ride/ids";
import { RideFocus } from "@/ui/ride/RideFocus";

/**
 * The Ride Focus composition root (02-ARCHITECTURE-CONTRACT §7, §17;
 * 08-RIDE-NAVIGATION-AND-FREE-RIDE §2, §13).
 *
 * This is the one place where the surface, the session controller, the durable
 * journal, the persisted geometry and the browser's device APIs actually meet.
 * Everything below it depends on ports, so `src/ui` stays free of IndexedDB,
 * MapLibre and `navigator` (the architecture scanner enforces the renderer half).
 *
 * The store is built once per mounted surface and its lifecycle is the effect's:
 * `start()` owns the clock, the wake lock and the environment adapter, `stop()`
 * releases them. React's StrictMode mounts, unmounts and remounts effects, so
 * both halves have to be re-entrant rather than one-way — see the store's own
 * note. Nothing is set into React state from the effect: an effect that both
 * creates the store and renders it would cascade a second render before the
 * first had painted.
 */

export interface RideClientProps {
  readonly basemap: BasemapMode;
  /** The deployment prefix the vendored renderer assets are served under. */
  readonly assetBasePath?: string;
  /** Injected host factory for tests; the MapLibre renderer by default. */
  readonly mapHostFactory?: MapHostFactory;
  /** The public Mapbox token the `mapbox` basemap draws with (OGV-D-265). */
  readonly mapboxToken?: string;
  /**
   * Feeds fixture position fixes into the session. Set only by a deployment that
   * asked for it (`NEXT_PUBLIC_OGV_RIDE_FIXTURE=1`), because the real position
   * pipeline is the navigation engine's and this adapter exists so the browser
   * gate and the QA capture can exercise controls that require a fix.
   */
  readonly fixturePosition?: boolean;
}

function clearRecordingStartIntentFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("record");
  url.searchParams.delete("rideId");
  url.searchParams.delete("revision");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function RideClient({
  basemap,
  assetBasePath,
  mapHostFactory = createMapLibreHost,
  mapboxToken,
  fixturePosition = false,
}: RideClientProps) {
  const hostFactory = useMemo<MapHostFactory>(
    () =>
      mapboxToken === undefined
        ? mapHostFactory
        : (container, options) => mapHostFactory(container, { ...options, mapboxToken }),
    [mapHostFactory, mapboxToken],
  );
  const placesSource = useMemo(
    () => createHttpPlacesSource({ basePath: assetBasePath }),
    [assetBasePath],
  );
  const mapLayersSource = useMemo(
    () => createHttpMapLayersSource(assetBasePath === undefined ? {} : { basePath: assetBasePath }),
    [assetBasePath],
  );
  const pointer = useMemo(() => createLocalStorageRideFocusPointer(), []);
  const homeLocation = useMemo(() => createHomeLocationStorage(), []);
  const { store, rides, activitySync } = useMemo(() => {
    // The ride on the Lock Screen and Dynamic Island, inside the iOS app only.
    const rideActivity = nativeShellRideActivity();
    const activitySync = rideActivity === undefined ? null : createRideActivitySync(rideActivity);
    const geometry = createIndexedDbGeometryStore();
    const rides = createRideRepository({
      protectedGeometryRefs: () => rideFocusGeometryRefs(pointer),
    });
    const sessions = createRideSessionController({
      repository: createRideSessionRepository(),
    });
    const library = createLibraryService(rides, { geometryStore: geometry });
    const recording = createRideRecordingWorkflow({
      session: sessions,
      pointer,
      recordings: createRecordingRepository(),
      library,
    });
    // Moving time and max speed for a Free Ride that records nothing, kept with the session across a reload.
    const freeRideTelemetry = createFreeRideTelemetry({ storage: createLocalStorageFreeRideTelemetry() });
    const { suggestionQuery, returnPlanner } = createClientFreeRideServices({
      rides,
      geometry,
      providerFactory: createClientRouteCandidateProvider,
    });
    const evaluateSuggestion = (
      navigation: NonNullable<ReturnType<typeof sessions.navigationState>>,
      lastSuggestionAt: string | null,
      signal: AbortSignal,
    ) => evaluateLiveSuggestion({
      navigation,
      workload: deriveLiveSuggestionWorkload(navigation),
      now: new Date().toISOString(),
      lastSuggestionAt,
    }, {
      port: {
        propose: (_input, requestSignal) => suggestionQuery.propose(navigation, requestSignal),
      },
      evidence: {
        assess: async (candidate) => candidate.evidence ?? {
          roadCharacterFit: unknownEvidence<number>("Road character evidence is unknown."),
          surfaceFit: unknownEvidence<number>("Surface evidence is unknown."),
          novelty: unknownEvidence<number>("Ride history evidence is unknown."),
        },
      },
      policy: { minimumMovingSpeedMps: 2, maximumAheadDeltaDegrees: 75, cooldownMs: 120_000 },
    }, signal);
    // Free Ride opportunities speak through the same voice as turns, and fall
    // silent with it when the rider mutes (COPILOT §6).
    const opportunityVoice = (() => {
      const port = nativeShellSpeech() ?? createBrowserSpeech();
      return port === undefined ? undefined : mutableSpeech(port);
    })();
    const store = createRideFocusStore({
      controller: sessions,
      announceOpportunity: (text) => { void opportunityVoice?.speakText?.(text); },
      feelOpportunity: (kind) => haptic(kind === "opportunity" ? "medium" : "success"),
      environment: () => createBrowserRideEnvironment({ nativeLocation: nativeShellPositionSource() !== undefined }),
      pointer,
      riderSettings: createLocalStorageRiderSettings(),
      freeRideTelemetry,
      recording,
      evaluateLiveSuggestion: evaluateSuggestion,
      returnPlanner,
      reroutePlanner: createGuidedReroutePlanner({
        rides,
        geometry,
        provider: createClientRouteCandidateProvider(),
      }),
      // Free Ride offers (#14): shared routes within a ride of here.
      rideOffers: true,
      loadOfferCatalog: async (near, signal) => {
        const response = await fetch(
          `/api/catalog?near=${near.lat.toFixed(4)},${near.lon.toFixed(4)}&radiusMiles=25`,
          { signal },
        );
        return response.ok ? parseOfferCatalog(await response.json()) : [];
      },
      readSavedHome: () => {
        const saved = homeLocation.read();
        return saved.status === "found" ? saved.coordinate : null;
      },
      readRouteLine: async (ref) => {
        const record = await geometry.get(ref);
        return record?.payload.kind === "line" ? record.payload.coordinates : null;
      },
      createNavigationEngine: (state, routeLine) => {
        const activity = state.activity === "paused" ? state.resumeActivity : state.activity;
        let route: ResolvedNavigationRoute | null = null;
        if (activity === "guided" && state.plan.route !== null && routeLine.length >= 2) {
          const pointerState = pointer.read();
          const instructions = pointerState.status === "found" &&
            pointerState.pointer.sessionId === state.sessionId
            ? pointerState.pointer.instructions ?? []
            : [];
          route = buildGuidedNavigationRoute(state.plan.route, routeLine, instructions);
        } else if (activity === "track" && routeLine.length >= 2) {
          route = { mode: "track", geometry: routeLine };
        }
        // In the app, Ferrostar navigates a guided ride natively (F2): it owns
        // GPS, turn timing and the voice; its fixes still feed this session,
        // its progress and the recording through the one position pipeline.
        const nativeNavigation = route?.mode === "guided" ? nativeNavigationBridge() : undefined;
        let nativeSource: PositionSource | null = null;
        if (nativeNavigation !== undefined && route !== null) {
          const pointerState = pointer.read();
          try {
            nativeSource = createFerrostarPositionSource({
              bridge: nativeNavigation,
              payload: guidedNativeNavigationPayload(
                route,
                pointerState.status === "found" ? pointerState.pointer.routeDurationSeconds : undefined,
              ),
              simulate: fixturePosition,
              presentation: readNavScreen() === "native" ? "native" : "headless",
              voiceMute: { read: isVoiceMuted, subscribe: subscribeVoiceMuted },
              // Closing the native screen pauses the ride; Resume reopens it.
              onNativeEnded: (reason) => {
                if (reason === "exit") void store.getState().pause();
              },
            });
          } catch {
            // A route the native contract refuses rides on the web engine.
            nativeSource = null;
          }
        }
        const spoken = nativeSource !== null ? undefined : nativeShellSpeech() ?? createBrowserSpeech();
        const voice = spoken === undefined ? undefined : mutableSpeech(spoken);
        // In the app, a spoken turn is also felt (a firm tap) and lights the
        // Lock Screen, as Apple Maps does.
        const speech = !inNativeShell()
          ? voice
          : withTurnAlerts(voice, (title, body) => {
              haptic("heavy");
              activitySync?.alert({ title, body });
            });
        const navigationEngine = createRideNavigationEngine({
          session: sessions,
          ...(speech === undefined ? {} : { speech }),
          route,
          positionSource: nativeSource ?? (fixturePosition
            ? createFixturePositionSource({
                browserSource: createBrowserPositionSource(),
                routeLine: () => routeLine,
              })
            : nativeShellPositionSource() ?? createBrowserPositionSource()),
          onSessionFix: (fix, appliedState) => freeRideTelemetry.accept(fix, appliedState),
          onAcceptedFix: async (fix, appliedState) => {
            if (appliedState.recordingId === null) return;
            // Raw device values only: a derived speed is recomputed by the
            // recording's own filter, never stored as if the device said it.
            await recording.append(recordingPositionFromFix(fix, appliedState.pausedDurationMs));
          },
        });
        return navigationEngine;
      },
      telemetryFromEngine: (engine, instant) => {
        const frame = engine.snapshot().frame;
        if (frame === null) return null;
        const pointerState = pointer.read();
        const routeDurationSeconds =
          pointerState.status === "found" ? pointerState.pointer.routeDurationSeconds : undefined;
        // Limits index the line the engine matches against; a reroute's pointer carries none.
        const speedLimitKmh =
          pointerState.status === "found" ? speedLimitAt(pointerState.pointer.speedLimits, frame.segmentIndex) : null;
        const remainingDurationSeconds =
          routeDurationSeconds === undefined
            ? null
            : Math.max(0, Math.round(routeDurationSeconds * (1 - frame.routeProgress)));
        return {
          routeProgress: frame.routeProgress,
          remainingDistanceMeters: frame.distanceRemainingMeters,
          remainingDurationSeconds,
          etaIso:
            remainingDurationSeconds === null
              ? null
              : new Date(Date.parse(instant) + remainingDurationSeconds * 1_000).toISOString(),
          speedLimitKmh,
        };
      },
    });
    return { rides, store, activitySync };
  }, [fixturePosition, homeLocation, pointer]);

  useEffect(() => {
    if (activitySync === null) return;
    activitySync.sync(store.getState().viewModel);
    return store.subscribe((state) => activitySync.sync(state.viewModel));
  }, [store, activitySync]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await store.getState().start();
      if (cancelled || typeof window === "undefined") return;
      const parameters = new URLSearchParams(window.location.search);
      if (parameters.get("record") !== "1") {
        // Just handed off from Start ride: start guiding now. A reload finds no
        // fresh mark and stays paused (8 §13).
        if (consumeRideHandoff() && store.getState().status === "ready") await store.getState().resume();
        return;
      }
      const rideIdValue = parameters.get("rideId");
      const revisionText = parameters.get("revision");
      const revision = revisionText === null ? Number.NaN : Number(revisionText);
      if (
        rideIdValue === null ||
        !rideIdValue.startsWith("ride_") ||
        !Number.isSafeInteger(revision) ||
        revision < 0
      ) {
        store.getState().reportStartError("Return to Plan and start recording from the current ride.");
        return;
      }
      const loaded = await rides.loadRide(rideIdValue as RideId);
      if (cancelled) return;
      if (loaded === null || !loaded.ok || loaded.document.revision !== revision) {
        store.getState().reportStartError("The planned ride changed before recording started. Return to Plan and try again.");
        return;
      }
      if (store.getState().status === "absent") {
        await store.getState().startRecording(loaded.document.rideId, loaded.document.revision);
        if (cancelled) return;
        const started = store.getState();
        if (
          started.status === "ready" &&
          started.navigation !== null &&
          started.navigation.recordingId !== null
        ) {
          clearRecordingStartIntentFromUrl();
        }
      }
    })();
    return (): void => {
      cancelled = true;
      store.getState().stop();
    };
  }, [rides, store]);

  return (
    <RideFocus
      store={store}
      mapHostFactory={hostFactory}
      basemap={basemap}
      placesSource={placesSource}
      mapLayersSource={mapLayersSource}
      {...(assetBasePath === undefined ? {} : { assetBasePath })}
    />
  );
}
