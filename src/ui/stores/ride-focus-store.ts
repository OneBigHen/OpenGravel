/**
 * The Ride Focus container (02-ARCHITECTURE-CONTRACT §3, §8, §14–§15;
 * 08-RIDE-NAVIGATION-AND-FREE-RIDE §2–§8, §13; 12 §13, §17, §20;
 * 17-IMPLEMENTATION-PLAN Task 8.5).
 *
 * It owns exactly the things the surface must not: the controller reference, the
 * device-environment adapter, the loaded route line, the camera's follow
 * decision, and one bounded clock.
 *
 * ## Why there is a clock at all
 *
 * Freshness is a function of *when* it is asked (8 §4) and the port derives it
 * from an injected clock. A surface that only re-derived on an event would keep
 * printing "Good GPS fix" for a fix that went stale twenty seconds ago — the
 * exact lie 8 §4 forbids. So while a ride is open the store re-derives on a
 * bounded interval: one second, the rate a rider reads at, and cheap because it
 * is one pure projection — no watch, no network, no storage.
 *
 * ## `start()` / `stop()` instead of an irreversibly disposed singleton
 *
 * The store holds two real resources: a timer and a wake lock (8 §8). React's
 * StrictMode deliberately mounts, unmounts and remounts effects, so a lifecycle
 * that can only go one way would leave the second mount holding a dead store —
 * silently not ticking, not recovering, and not visible as a bug until a rider
 * reloads. `start()` therefore **creates** the environment adapter and `stop()`
 * disposes it, and both are re-entrant: after `stop()` the store is inert, and a
 * later `start()` is a fresh, live ride surface. The environment is injected as a
 * factory for exactly that reason.
 *
 * ## What it deliberately does not own
 *
 * No position pipeline. It never feeds a `PositionFix`, smooths one, matches
 * progress or decides an off-route state: §3 and §5 are the 8.2 engine's, and the
 * surface is built to be correct without it — everything the engine has not
 * answered is stated as unknown rather than guessed.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

import { buildRideScene, recenterExtent } from "@/application/map/build-ride-scene";
import { sceneExtent } from "@/application/map/build-map-scene";
import type { MapExtent } from "@/application/map/build-map-scene";
import type { GeometryRef, RideId } from "@/domain/ride/ids";
import { haversine } from "@/domain/geometry/analysis";
import { nearestOnLine, rideCameraFor, type RideCamera } from "@/application/map/ride-camera";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteWarning } from "@/domain/route/types";
import {
  modeChangedEvent,
  sessionAbandonedEvent,
  sessionCompletedEvent,
  sessionPausedEvent,
  sessionResumedEvent,
  suggestionsChangedEvent,
} from "@/domain/ride-session/create";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import { deriveSessionNavigation } from "@/domain/ride-session/navigation";
import type { RideSessionController } from "@/application/ride-session/ride-session-controller";
import type { RideNavigationEngine } from "@/application/ride-session/navigation-engine";
import type { RideRecordingWorkflow } from "@/application/ride-session/recording-workflow";
import type { FreeRideTelemetry } from "@/application/ride-session/free-ride-telemetry";
import type { RideSessionState, SessionSuggestions } from "@/domain/ride-session/types";
import type { RecordingTelemetry } from "@/domain/recording/telemetry";
import type { LiveSuggestionCandidate, LiveSuggestionResult } from "@/application/free-ride/live-suggestions";
import type { ExplicitReturnTarget, ReturnMode } from "@/application/free-ride/return-routing";
import type { ReturnPlanResult } from "@/application/free-ride/return-plan";
import type { GuidedReroutePlanner, RerouteDetour } from "@/application/ride-session/guided-reroute";
import { lineAhead, loopRejoinAnchors } from "@/application/ride-session/loop-rejoin";
import { resolveHeadHomeTarget } from "@/application/free-ride/head-home-target";
import {
  EMPTY_RIDE_OFFER_ATTENTION,
  EMPTY_OFFER_HISTORY,
  evaluateRideOfferAttention,
  rankRideOffers,
  recordOfferSkip,
  rideOfferTiming,
  summarizeRideOffer,
  type OfferCatalogRoute,
  type RideOfferCandidate,
  type RideOfferHistory,
  type RideOfferAttentionState,
  type RideOfferSummary,
} from "@/application/free-ride/ride-offers";
import {
  opportunityProgress,
  showOpportunity,
  spokenOpportunity,
  type ShownOpportunity,
} from "@/application/free-ride/opportunity";
import { formatDistance } from "@/application/planner/measurements";
import type {
  RideFocusEnvironmentPort,
  RideFocusEnvironmentSnapshot,
} from "@/application/ride-session/ports/ride-focus-environment";
import {
  buildRideFocusViewModel,
  type RideFocusTelemetryInput,
  type RideFocusTelemetryProvider,
  type RideFocusViewModel,
} from "@/application/ride-session/ride-focus-view-model";
import type { RideFocusPointerPort } from "@/application/persistence/ride-focus-pointer";
import {
  createRiderSettings,
  withMetricSlots,
  withRideInterestFilter,
  type RiderSettings,
  type RiderSettingsStoragePort,
} from "@/application/ride-metrics/rider-settings";
import { RIDE_METRIC_PRESETS, metricAvailable, type RideMetricId, type RideMetricPresetId } from "@/application/ride-metrics/registry";
import { storedAfterChoice } from "@/application/ride-metrics/strip";
import type { RideInterestFilter } from "@/application/ride-interest";
import type { MotionPort } from "@/application/ride-session/ports/motion-port";
import {
  INITIAL_LEAN_TELEMETRY_STATE,
  calibrateLean as calibrateLeanState,
  sampleLean,
  type LeanMetricSnapshot,
  type LeanTelemetryState,
  type Vector3,
} from "@/domain/motion/lean";

/**
 * What the surface is doing right now.
 *
 * `absent` is the ordinary "no ride here" state; `unrecoverable` is a journal
 * that could not be reconstructed, which is a different sentence to the rider
 * than "there is nothing" (8 §13: honest recovery).
 */
/** How far a rider moves after a route fit before the camera follows again. */
const FOLLOW_STEP_METERS = 30;
/** A rider who panned away is brought back after this long (DV-10). */
const SNAP_BACK_MS = 10_000;
/** Further than this from the route at the start: offer "Head to the start" (DV-07). */
const FAR_FROM_START_METERS = 500;
/** No fix for this long: restart the position source by itself (DV-10). */
const AUTO_RETRY_LOCATION_MS = 20_000;
/** How long an automatic reroute waits after the last one. */
const AUTO_REROUTE_COOLDOWN_MS = 45_000;
/** How long "Route updated" stays on screen. */
const REROUTE_MESSAGE_MS = 10_000;
/** A taken opportunity finishes once the rider is back within this of its end… */
const EXCURSION_END_METERS = 40;
/** …having first been at least this far from it. */
const EXCURSION_ARM_METERS = 80;

export type RideFocusStoreStatus =
  | "loading"
  | "ready"
  | "absent"
  | "unrecoverable"
  | "unavailable";

export interface RideFocusStoreState {
  readonly status: RideFocusStoreStatus;
  /** A recovery note ("Ride restored — paused"), or `null`. */
  readonly statusMessage: string | null;
  /** A refused command, in rider copy, or `null`. */
  readonly lastError: string | null;
  readonly navigation: SessionNavigationState | null;
  readonly suggestions: SessionSuggestions;
  readonly liveSuggestion: LiveSuggestionCandidate | null;
  /** How far the rider is from the opportunity's decision point, kept current as they ride. */
  readonly liveSuggestionDistanceMeters: number | null;
  readonly suggestionBusy: boolean;
  /**
   * The Free Ride offer on screen (#14): a whole ride from here, planned, with
   * its summary and when it lapses. Swipe right takes it, left skips it.
   */
  readonly rideOffer: {
    readonly id: string;
    readonly kind: RideOfferCandidate["kind"];
    readonly summary: RideOfferSummary;
    readonly shownAt: string;
    readonly lifetimeMs: number;
  } | null;
  /** An offer is being planned. */
  readonly rideOfferBusy: boolean;
  /** Whether this surface makes Free Ride offers at all. */
  readonly rideOffersAvailable: boolean;
  readonly returnBusy: boolean;
  readonly freeRideStatusMessage: string | null;
  readonly freeRideError: string | null;
  /** Whether this surface can replan a guided ride at all. */
  readonly rerouteAvailable: boolean;
  /** `true` while a new route from here (off-route or a detour) is being planned. */
  readonly rerouteBusy: boolean;
  /** What the last reroute did or is doing, in rider copy; clears itself. */
  readonly rerouteMessage: string | null;
  /** Why the last reroute failed, in rider copy. */
  readonly rerouteError: string | null;
  readonly environment: RideFocusEnvironmentSnapshot;
  readonly viewModel: RideFocusViewModel | null;
  /** The route line the session is following; empty when it did not resolve. */
  readonly routeLine: readonly Coordinate[];
  /** The offered Free Ride route preview; it does not bind the RideSession. */
  readonly suggestionPreviewLine: readonly Coordinate[];
  /** Whether the route line is available (the surface states when it is not). */
  readonly routeLineAvailable: boolean;
  readonly mapReady: boolean;
  /** `true` while the camera follows the rider (08 §2). */
  readonly follow: boolean;
  /** Bumped on every recenter request, so the same view can be asked twice. */
  readonly cameraToken: number;
  readonly cameraExtent: MapExtent | null;
  /**
   * `true` once the rider pans or zooms, until the ride next asks for a view
   * (recenter, follow, a route fit). While held, nothing re-frames the map, not
   * even the HUD changing height, so a rider who zoomed out to look ahead
   * stays there.
   */
  readonly cameraHeld: boolean;
  /** `true` while the stop confirmation is open (08 §2 "stop/exit ride"). */
  readonly stopConfirm: boolean;
  /**
   * The heading-up follow camera (DV-10), re-issued with a new token as the
   * rider moves; `null` while nothing follows (a pan, a route fit).
   */
  readonly rideCamera: { readonly token: number; readonly camera: RideCamera } | null;
  /**
   * The rider is far from a guided ride's start (DV-07): the surface asks
   * whether to head there, instead of silently re-planning from here.
   */
  readonly farFromStart: { readonly meters: number } | null;
  /** The rider's strip choices (RIDE-INSTRUMENT-STRIP §5); the one preference authority. */
  readonly riderSettings: RiderSettings;
}

export interface RideFocusStoreActions {
  /** Owns the environment, recovers the pointed-at session, starts the clock. */
  start(): Promise<void>;
  /** Releases the clock, the wake lock and the environment. Re-entrant. */
  stop(): void;
  /** The rider's Retry on the recovery surface. */
  retryRecovery(): Promise<void>;
  /** The renderer's own load health, so recenter can be honest about the map. */
  setMapReady(ready: boolean): void;
  /** The rider panned or zoomed: the camera is theirs again (05 §8). */
  onCameraChanged(): void;
  /** Frame the rider's position now, and keep following. */
  recenter(): void;
  /**
   * Show the whole route, north-up, and stop following (the route-overview
   * button, as in Google Maps). Re-center brings the ride camera back.
   */
  overview(): void;
  /** Toggle follow; turning it on frames the rider. */
  setFollow(follow: boolean): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Starts a route-free recording in the existing RideSession authority. */
  startRecording(rideId: RideId, rideRevision: number): Promise<void>;
  /** Changes the explicit route-free live-suggestion policy through a typed event. */
  setSuggestions(enabled: boolean): Promise<void>;
  /** Binds the offered ahead segment to this RideSession. */
  acceptLiveSuggestion(): Promise<void>;
  dismissLiveSuggestion(): void;
  /** Swipe right: ride the offer now. */
  acceptRideOffer(): Promise<void>;
  /** Swipe left, or it lapsed: never offer this one again this ride. */
  skipRideOffer(): void;
  /** "Offer me a ride": the next offer without waiting for the cooldown. */
  requestRideOffer(): void;
  /** Plans and binds a fresh return to saved Home, or session start as fallback. */
  headHome(): Promise<void>;
  /** Finds a lower-workload legal return without changing the authored ride. */
  easierWayBack(): Promise<void>;
  /** Routes legally back to the first accepted session position; never reverses route geometry. */
  turnAround(): Promise<void>;
  /** A curvy loop of `minutes` from where the rider is now, back to here. */
  loopFromHere(minutes: number): Promise<void>;
  /**
   * Plans a new route from the rider's position to the stops still ahead and
   * the finish, through `detour` first when given, and binds it.
   */
  reroute(detour?: RerouteDetour, options?: { readonly wholeRoute?: boolean }): Promise<void>;
  /** Completes a guided segment in a Free Ride without ending the session. */
  continueFreeRide(): Promise<void>;
  /** Retries the bounded unsaved recording batch after a storage failure. */
  retryRecordingSave(): Promise<void>;
  /** Displays a typed handoff refusal from the composition root. */
  reportStartError(message: string): void;
  /** Opens the stop confirmation (`Stop ride` on the surface). */
  beginStop(): void;
  cancelStop(): void;
  /** Ends the ride as finished (8 §13 "completed"). */
  finish(): Promise<void>;
  /** Ends the ride as discarded (8 §13 "abandoned"). */
  discard(): Promise<void>;
  /** §3's Retry on a blocked location permission. */
  retryLocationPermission(): Promise<void>;
  /** DV-07: route from here to the ride's start, then on along the ride. */
  headToStart(): Promise<void>;
  /** DV-07: the rider will make their own way to the route. */
  dismissFarFromStart(): void;
  /**
   * Puts `id` in strip slot `index` and saves it (§2.2). Refused unless the
   * strip says the rider may customize now, so a moving rider cannot change it.
   */
  setRideMetric(index: number, id: RideMetricId): boolean;
  /** Puts a preset's three metrics in the strip and saves them (§2.3). */
  applyRideMetricPreset(id: RideMetricPresetId): boolean;
  /** The ride sheet's along-route interest filter (OGV#13 §3): saved per device. */
  setRideInterestFilter(filter: RideInterestFilter): void;
  /** The rider's "calibrate" for the lean-angle beta: re-zeroes from the freshest sample. No-op with no sample yet. */
  calibrateLean(): void;
}

export type RideFocusStore = RideFocusStoreState & RideFocusStoreActions;

export interface RideFocusStoreOptions {
  readonly controller: RideSessionController;
  /**
   * Builds the device-environment adapter. A factory, not an instance: `start()`
   * owns one adapter and `stop()` disposes it, which is what makes the lifecycle
   * re-entrant under React's double-invoked effects.
   */
  readonly environment: () => RideFocusEnvironmentPort;
  readonly pointer: RideFocusPointerPort;
  /**
   * Resolves a persisted route line. The adapter is injected because `src/ui`
   * may not know which store owns geometry; absent means every line is unknown,
   * which the surface states rather than hides.
   */
  readonly readRouteLine?: (ref: GeometryRef) => Promise<readonly Coordinate[] | null>;
  readonly recording?: RideRecordingWorkflow;
  readonly evaluateLiveSuggestion?: (
    navigation: SessionNavigationState,
    lastSuggestionAt: string | null,
    signal: AbortSignal,
  ) => Promise<LiveSuggestionResult>;
  readonly returnPlanner?: {
    plan(input: {
      readonly navigation: SessionNavigationState;
      readonly target: ExplicitReturnTarget;
      readonly mode: ReturnMode;
      readonly signal: AbortSignal;
      /** `loop` mode: a new loop of this many minutes from here. */
      readonly loopMinutes?: number;
      /** `loop` mode: shaping through these points (a loop's rest, a shared route). */
      readonly rejoin?: readonly Coordinate[];
    }): Promise<ReturnPlanResult>;
  };
  readonly readSavedHome?: () => Coordinate | null;
  /** Shared routes near a point, for Free Ride offers; absent means loops and home only. */
  readonly loadOfferCatalog?: (near: Coordinate, signal: AbortSignal) => Promise<readonly OfferCatalogRoute[]>;
  /** Free Ride puts up whole-ride offers (#14). Off unless the composition root asks. */
  readonly rideOffers?: boolean;
  /**
   * Says a Free Ride opportunity once, when it appears (COPILOT §6). The
   * adapter owns the voice and honours the rider's mute.
   */
  readonly announceOpportunity?: (text: string) => void;
  /** A haptic for an opportunity appearing, being taken, or Free Ride resuming. */
  readonly feelOpportunity?: (kind: "opportunity" | "accepted" | "returned") => void;
  /** Mid-ride replanning for a guided ride; absent means rerouting is not offered. */
  readonly reroutePlanner?: GuidedReroutePlanner;
  /** Replan by itself when the rider leaves the route (default on). */
  readonly autoReroute?: boolean;
  readonly createNavigationEngine?: (
    state: RideSessionState,
    routeLine: readonly Coordinate[],
  ) => RideNavigationEngine;
  /** Projects the store-owned active engine without copying its authority into the composition root. */
  readonly telemetryFromEngine?: (
    engine: RideNavigationEngine,
    instant: string,
  ) => RideFocusTelemetryInput | null;
  readonly now?: () => string;
  /** How often freshness is re-derived while a ride is open. */
  readonly tickIntervalMs?: number;
  /**
   * The engine's telemetry (progress, remaining, ETA). Absent means "the engine
   * has not answered", which the surface prints as `Unknown` — never as zero.
   */
  readonly telemetry?: RideFocusTelemetryProvider;
  /** Route-level conditions the ride carries; empty means none are known. */
  readonly routeWarnings?: () => readonly RouteWarning[];
  /** The timer source; injected so a test can drive the clock deterministically. */
  readonly setInterval?: (handler: () => void, ms: number) => number;
  readonly clearInterval?: (handle: number) => void;
  /** Where the strip's choices persist; absent keeps them for this page only. */
  readonly riderSettings?: RiderSettingsStoragePort;
  /**
   * A Free Ride's live telemetry (moving time, max speed) when it is not
   * recording. The composition root feeds it every session fix; the store
   * reads it for the strip, saves it on pause, on stop and when the page
   * hides, and drops it when the ride ends. Absent: Free Ride offers none.
   */
  readonly freeRideTelemetry?: FreeRideTelemetry;
  /**
   * Builds the device-motion adapter for the lean-angle beta (issue #12
   * follow-up). A factory, like `environment`, so `start()`/`stop()` own one
   * adapter's lifecycle each run. Absent: `motion.lean` reads unsupported.
   */
  readonly motion?: () => MotionPort;
}

const EMPTY_ENVIRONMENT: RideFocusEnvironmentSnapshot = {
  locationPermission: "unknown",
  wakeLock: "off",
  speech: "ready",
};

const NO_COORDINATES: readonly Coordinate[] = [];

function movingActivity(state: SessionNavigationState): boolean {
  return state.activity === "guided" || state.activity === "free" || state.activity === "track";
}

export function createRideFocusStore(
  options: RideFocusStoreOptions,
): StoreApi<RideFocusStore> {
  const {
    controller,
    environment: createEnvironment,
    pointer,
    readRouteLine,
    recording,
    evaluateLiveSuggestion: evaluateSuggestion,
    returnPlanner,
    readSavedHome = () => null,
    loadOfferCatalog,
    rideOffers = false,
    announceOpportunity,
    feelOpportunity,
    reroutePlanner,
    autoReroute = true,
    createNavigationEngine,
    telemetryFromEngine,
    now = (): string => new Date().toISOString(),
    tickIntervalMs = 1000,
    telemetry,
    riderSettings: riderSettingsStorage,
    freeRideTelemetry,
    motion: createMotion,
    routeWarnings = (): readonly RouteWarning[] => [],
    setInterval: schedule = (handler, ms): number =>
      globalThis.setInterval(handler, ms) as unknown as number,
    clearInterval: unschedule = (handle): void => {
      globalThis.clearInterval(handle);
    },
  } = options;

  let environment: RideFocusEnvironmentPort | null = null;
  let unsubscribeEnvironment: (() => void) | null = null;
  let timer: number | null = null;
  let running = false;
  /** The activity the environment was last told about (8 §8). */
  let rideActive: boolean | null = null;
  let navigationEngine: RideNavigationEngine | null = null;
  let navigationEngineKey: string | null = null;
  let suggestionAbort: AbortController | null = null;
  let lastSuggestionAt: string | null = null;
  let lastSuggestionQueryAt = Number.NEGATIVE_INFINITY;
  let lastSuggestionPositionKey: string | null = null;
  let suggestionGeneration = 0;
  /** The opportunity on screen, and where the rider stood when it appeared. */
  let shownOpportunity: ShownOpportunity | null = null;
  /**
   * An accepted opportunity is a short guided excursion (FR-04): at its end
   * the ride goes back to Free Ride by itself. Armed once the rider has been
   * away from the end, so a short segment cannot finish on the spot.
   */
  let excursion: { readonly sessionId: string; readonly end: Coordinate; armed: boolean } | null = null;
  let pendingReturnAbort: AbortController | null = null;
  /** Free Ride offers (#14): what the rider said to each, and the planned offer. */
  let offerHistory: RideOfferHistory = EMPTY_OFFER_HISTORY;
  let offerCatalog: readonly OfferCatalogRoute[] | null = null;
  let offerCatalogLoading = false;
  let offerAbort: AbortController | null = null;
  let offerGeneration = 0;
  let offerEndedAtMs: number | null = null;
  let offerRequested = false;
  let offerSession: string | null = null;
  /** Latest transient movement evidence used only to decide when a card may interrupt. */
  let offerAttention: RideOfferAttentionState = EMPTY_RIDE_OFFER_ATTENTION;
  let shownOffer: {
    readonly candidate: RideOfferCandidate;
    readonly plan: Extract<ReturnPlanResult, { readonly status: "planned" }>;
    readonly line: readonly Coordinate[];
  } | null = null;
  let rerouteAbort: AbortController | null = null;
  let lastRerouteAt = Number.NEGATIVE_INFINITY;
  /**
   * A guided ride's recovery return (Turn around, Easier way back) in force.
   * While set, reroutes re-plan this return instead of the authored ride, so a
   * missed turn on the way back never steers the rider to the old finish.
   */
  let activeReturn: {
    readonly sessionId: string;
    readonly mode: Extract<ReturnMode, "fatigue" | "turn-around" | "loop">;
    readonly target: ExplicitReturnTarget;
  } | null = null;
  let rerouteMessageAt = Number.NEGATIVE_INFINITY;
  /** The session whose Free Ride telemetry was dropped at its end, so it is dropped once. */
  let liveTelemetryEndedFor: string | null = null;
  /** That session's final numbers, for the finish summary. */
  let endedLiveTelemetry: RecordingTelemetry | null = null;
  let detachPageListeners: (() => void) | null = null;

  // ---- Lean-angle beta (issue #12 follow-up) -------------------------------
  // Mutable across `start()`/`stop()`, like `environment`; the functions that
  // fold, subscribe and read it live inside the store callback below (they
  // need `get()`/`refresh()`, which only exist in that scope).
  let motion: MotionPort | null = null;
  let unsubscribeMotion: (() => void) | null = null;
  let leanState: LeanTelemetryState = INITIAL_LEAN_TELEMETRY_STATE;
  /** The latest raw sample, so `calibrateLean()` can re-zero synchronously rather than waiting on the next event. */
  let lastGravity: { readonly vector: Vector3; readonly atMs: number } | null = null;

  /** Saves the Free Ride telemetry now; it never throws. */
  function flushLiveTelemetry(): void {
    try {
      freeRideTelemetry?.flush();
    } catch {
      // Live-only for this page.
    }
  }

  /** The page may be about to go (reload, tab switch, app switch): save what the throttle is holding. */
  function attachPageListeners(): void {
    if (freeRideTelemetry === undefined || typeof window === "undefined") return;
    const onPageHide = (): void => flushLiveTelemetry();
    const onVisibility = (): void => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") flushLiveTelemetry();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    detachPageListeners = () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }

  /** This frame's Free Ride telemetry; an ended ride's is dropped here, once. */
  function liveTelemetryFor(state: RideSessionState | null): RecordingTelemetry | null {
    if (freeRideTelemetry === undefined || state === null) return null;
    try {
      if (state.activity === "completed") {
        if (liveTelemetryEndedFor !== state.sessionId) {
          liveTelemetryEndedFor = state.sessionId;
          // The last numbers stay on the finish summary; the stored state goes.
          try {
            endedLiveTelemetry = freeRideTelemetry.snapshot(state);
          } catch {
            endedLiveTelemetry = null;
          }
          freeRideTelemetry.end();
        }
        return endedLiveTelemetry;
      }
      return freeRideTelemetry.snapshot(state);
    } catch {
      return null;
    }
  }

  const store = createStore<RideFocusStore>((set, get) => {
    /**
     * Re-derives the whole present-tense view from the controller, the device
     * environment and the clock. Every mutation path ends here, so there is
     * exactly one place a stale value could be introduced — and it is derived.
     */
    /**
     * Follow keeps the rider in view as they move (UX rework phase 7): the
     * camera steps to each fresh fix once it has moved far enough to matter.
     * A guided ride starts following on its first good fix unless the rider
     * has already moved the map themselves; a pan hands the camera back.
     */
    /** Where the last route fit framed the rider; follow waits until they move on. */
    let followedAt: Coordinate | null = null;
    let autoFollowArmed = true;
    let lastBearing: number | null = null;
    let lastCameraKey: string | null = null;
    let snapBackTimer: ReturnType<typeof setTimeout> | null = null;
    /** DV-07: the start question is asked once, until answered or the rider joins the line. */
    let farFromStartSettled = false;
    let farFromStartDismissed = false;
    let noFixSince: number | null = null;
    let lastLocationRetryAt = Number.NEGATIVE_INFINITY;

    function clearSnapBack(): void {
      if (snapBackTimer !== null) clearTimeout(snapBackTimer);
      snapBackTimer = null;
    }

    /**
     * Follow keeps the rider in view as they move, heading-up and tilted
     * (DV-10): each fix re-aims the camera. A guided ride starts following on
     * its first good fix unless the rider has already moved the map; a pan
     * hands the camera back until Recenter, or until it snaps back by itself.
     */
    function followRider(viewModel: RideFocusViewModel | null, force = false): void {
      const position = viewModel?.mapPosition ?? null;
      if (position === null) return;
      if (!force && position.quality !== "fresh-good" && position.quality !== "fresh-poor") return;
      const current = get();
      if (!current.mapReady) return;
      if (!force && !current.follow && !autoFollowArmed) return;
      // A fit the ride just asked for (the whole route, a suggestion preview)
      // holds until the rider has moved on from where it was framed.
      if (!force && followedAt !== null) {
        if (haversine(followedAt, position.coordinate) < FOLLOW_STEP_METERS) return;
      }
      followedAt = null;
      autoFollowArmed = false;
      const navigation = current.navigation;
      const camera = rideCameraFor({
        position: position.coordinate,
        headingDegrees: navigation?.position.headingDegrees ?? null,
        speedMps: navigation?.position.speedMps ?? null,
        routeLine: current.routeLine,
        maneuverMeters: navigation?.instruction?.distanceMeters ?? null,
        previousBearing: lastBearing,
      });
      lastBearing = camera.bearing;
      const key = [
        camera.center.lon.toFixed(6),
        camera.center.lat.toFixed(6),
        camera.bearing === null ? "-" : Math.round(camera.bearing),
        camera.zoom.toFixed(1),
      ].join(",");
      if (!force && key === lastCameraKey && current.follow && current.rideCamera !== null) return;
      lastCameraKey = key;
      set({
        follow: true,
        cameraHeld: false,
        rideCamera: { token: (current.rideCamera?.token ?? current.cameraToken) + 1, camera },
      });
    }

    /**
     * DV-07: a guided ride started far from its line asks before it re-plans.
     * Answered once per ride, and forgotten once the rider reaches the line.
     */
    function checkFarFromStart(navigation: SessionNavigationState): void {
      if (farFromStartSettled) return;
      if (navigation.activity !== "guided") return;
      if (activeReturn !== null) {
        farFromStartSettled = true;
        return;
      }
      const position = navigation.position;
      // Hundreds of metres decide this: a weak fix is plenty.
      if ((position.quality !== "fresh-good" && position.quality !== "fresh-poor") || position.coordinate === null) return;
      const line = get().routeLine;
      if (line.length < 2) return;
      // The matcher's progress means nothing this far off the line (it projects
      // anywhere), so only the distance to the line decides.
      const nearest = nearestOnLine(line, position.coordinate);
      if (nearest === null) return;
      if (nearest.meters <= FAR_FROM_START_METERS) {
        farFromStartSettled = true;
        if (get().farFromStart !== null) set({ farFromStart: null });
        return;
      }
      const start = line[0];
      if (start === undefined) return;
      const meters = Math.round(haversine(position.coordinate, start));
      if (farFromStartDismissed) return;
      const shown = get().farFromStart;
      if (shown === null || Math.abs(shown.meters - meters) > 100) set({ farFromStart: { meters } });
    }

    /** DV-10: "Retry happens automatically" — a silent source gets restarted. */
    function autoRetryLocation(navigation: SessionNavigationState, instant: string): void {
      const at = Date.parse(instant);
      if (!movingActivity(navigation) || navigation.position.quality !== "unavailable") {
        noFixSince = null;
        return;
      }
      if (get().environment.locationPermission === "denied") return;
      noFixSince ??= at;
      if (at - noFixSince < AUTO_RETRY_LOCATION_MS || at - lastLocationRetryAt < AUTO_RETRY_LOCATION_MS) return;
      lastLocationRetryAt = at;
      void navigationEngine?.retryPosition?.();
    }

    /** Persists the strip's choices and re-derives the frame so they show now. */
    function saveRiderSettings(next: RiderSettings): void {
      riderSettingsStorage?.write(next);
      set({ riderSettings: next });
      refresh();
    }

    // ---- Lean-angle beta (issue #12 follow-up) -----------------------------

    function onGravitySample(vector: Vector3, atMs: number): void {
      lastGravity = { vector, atMs };
      leanState = sampleLean(leanState, vector, atMs);
      refresh();
    }

    /** Lazily subscribes the first time the rider's stored choices actually want Lean, in either layout. */
    function ensureMotionSubscribed(): void {
      if (motion === null || unsubscribeMotion !== null) return;
      const preferences = get().riderSettings.uiPreferences;
      const wantsLean = preferences.rideMetrics.includes("motion.lean") || preferences.recordingMetrics.includes("motion.lean");
      if (!wantsLean) return;
      unsubscribeMotion = motion.subscribe(onGravitySample);
    }

    /** The strip's own reading, computed from the fold and the port's permission state — never fabricated. */
    function leanSnapshot(): LeanMetricSnapshot {
      const shared = {
        maxLeftDegrees: leanState.maxLeftDegrees,
        maxRightDegrees: leanState.maxRightDegrees,
        sampledAtMs: leanState.lastSampleAtMs,
      };
      if (motion === null || !motion.supported()) return { availability: "unsupported", degrees: null, ...shared };
      if (motion.permission() === "denied") return { availability: "denied", degrees: null, ...shared };
      if (leanState.reference !== null) return { availability: "ready", degrees: leanState.smoothedDegrees, ...shared };
      return { availability: motion.permission() === "granted" ? "calibrating" : "permission-needed", degrees: null, ...shared };
    }

    /** The rider's "calibrate" (picked while stopped): re-zeroes from the freshest sample, or waits for one. */
    function calibrateLean(): void {
      if (lastGravity === null) return;
      const next = calibrateLeanState(lastGravity.vector, lastGravity.atMs);
      if (next === null) return;
      leanState = next;
      refresh();
    }

    /** The rider picked Lean (a slot, or a preset that includes it): ask the platform, from this same gesture. */
    function primeMotionIfChosen(ids: readonly RideMetricId[]): void {
      if (!ids.includes("motion.lean") || motion === null) return;
      ensureMotionSubscribed();
      void motion.requestPermission().then(() => refresh());
    }

    function refresh(): void {
      if (!running) return;
      ensureMotionSubscribed();
      const state = controller.snapshot();
      const snapshot = environment?.snapshot() ?? EMPTY_ENVIRONMENT;
      const instant = now();
      const navigation = state === null ? null : deriveSessionNavigation(state, { now: instant });
      const current = get();
      const recordingSnapshot = recording?.snapshot() ?? null;
      const liveTelemetry = liveTelemetryFor(state);
      const viewModel =
        navigation === null
          ? null
          : buildRideFocusViewModel({
              navigation,
              environment: snapshot,
              telemetry:
                navigationEngine !== null && telemetryFromEngine !== undefined
                  ? telemetryFromEngine(navigationEngine, instant)
                  : telemetry?.(instant) ?? null,
              recordingSummary: recordingSnapshot?.summary ?? null,
              recordingTelemetry: recordingSnapshot?.telemetry ?? null,
              liveTelemetry,
              lean: leanSnapshot(),
              recordingStatus: recordingSnapshot?.status ?? null,
              bufferedRecordingPointCount: recordingSnapshot?.bufferedPointCount ?? 0,
              recordingLibraryCommitted: recordingSnapshot?.libraryCommitted ?? false,
              recordingSourceDeleted: recordingSnapshot?.sourceDeleted ?? false,
              now: now(),
              routeGeometry: current.routeLine,
              routeWarnings: routeWarnings(),
              mapReady: current.mapReady,
              riderSettings: current.riderSettings,
            });
      set({
        navigation,
        suggestions: state?.suggestions ?? "off",
        ...(!state || navigation?.activity !== "free" || state.recordingId !== null || state.suggestions !== "on"
          ? { liveSuggestion: null, suggestionPreviewLine: NO_COORDINATES, suggestionBusy: false }
          : {}),
        environment: snapshot,
        viewModel,
      });
      followRider(viewModel);
      if (navigation !== null) {
        checkFarFromStart(navigation);
        autoRetryLocation(navigation, instant);
      }
      if (get().rerouteMessage !== null && !get().rerouteBusy && Date.parse(instant) - rerouteMessageAt > REROUTE_MESSAGE_MS) {
        set({ rerouteMessage: null });
      }
      if (navigation !== null) maybeAutoReroute(navigation, instant);
      if (state !== null && navigation !== null) {
        trackOpportunity(navigation, instant);
        maybeFinishExcursion(state, navigation);
      }
      if (state !== null && navigation !== null) scheduleSuggestionQuery(state, navigation);
      if (state !== null && navigation !== null) scheduleRideOffer(state, navigation, instant);
      syncRideActivity(navigation);
      syncTimer(navigation);
    }

    /**
     * Off the route with a good fix: plan a way back from here, as a sat-nav
     * does, at most once per cooldown so a rider exploring a side road is not
     * replanned on every fix.
     */
    function maybeAutoReroute(navigation: SessionNavigationState, instant: string): void {
      if (!autoReroute || reroutePlanner === undefined || get().rerouteBusy) return;
      // DV-07: far from the start, the rider decides; nothing re-plans silently.
      if (!farFromStartSettled || get().farFromStart !== null) return;
      if (navigation.activity !== "guided" || navigation.offRouteState !== "off-route") return;
      if (navigation.position.quality !== "fresh-good") return;
      if (Date.parse(instant) - lastRerouteAt < AUTO_REROUTE_COOLDOWN_MS) return;
      void get().reroute();
    }

    /**
     * FR-03: an opportunity lives by the road, not by the query clock. It goes
     * when the rider passes its decision point or it grows old; meanwhile the
     * distance on the card counts down.
     */
    function trackOpportunity(navigation: SessionNavigationState, instant: string): void {
      const suggestion = get().liveSuggestion;
      if (suggestion === null || shownOpportunity === null || shownOpportunity.suggestion.id !== suggestion.id) {
        shownOpportunity = suggestion === null ? null : shownOpportunity;
        return;
      }
      const coordinate = navigation.position.coordinate;
      if (navigation.position.quality !== "fresh-good" || coordinate === null) return;
      const progress = opportunityProgress(shownOpportunity, coordinate, navigation.position.headingDegrees, instant);
      if (progress.status === "expired") {
        shownOpportunity = null;
        set({
          liveSuggestion: null,
          liveSuggestionDistanceMeters: null,
          suggestionPreviewLine: NO_COORDINATES,
          freeRideStatusMessage: null,
        });
        return;
      }
      if (progress.distanceToDecisionMeters !== get().liveSuggestionDistanceMeters) {
        set({ liveSuggestionDistanceMeters: progress.distanceToDecisionMeters });
      }
    }

    /** FR-04: the end of a taken opportunity hands the ride back to Free Ride. */
    function maybeFinishExcursion(state: RideSessionState, navigation: SessionNavigationState): void {
      if (excursion === null) return;
      const activity = navigation.activity === "paused" ? navigation.resumeActivity : navigation.activity;
      if (state.sessionId !== excursion.sessionId || activity !== "guided") {
        excursion = null;
        return;
      }
      const coordinate = navigation.position.coordinate;
      if (navigation.activity !== "guided" || navigation.position.quality !== "fresh-good" || coordinate === null) return;
      const toEnd = haversine(coordinate, excursion.end);
      if (toEnd > EXCURSION_ARM_METERS) excursion.armed = true;
      if (!excursion.armed || toEnd > EXCURSION_END_METERS) return;
      excursion = null;
      void get().continueFreeRide().then(() => {
        if (controller.snapshot()?.activity !== "free") return;
        feelOpportunity?.("returned");
        set({ freeRideStatusMessage: "Back to Free Ride." });
      });
    }

    function clearRideOffer(): void {
      const hadPublicOffer = get().rideOffer !== null || get().rideOfferBusy;
      const hadPrivateOffer = shownOffer !== null;
      offerGeneration += 1;
      offerAbort?.abort();
      offerAbort = null;
      shownOffer = null;
      if (hadPublicOffer || hadPrivateOffer) {
        set({ rideOffer: null, rideOfferBusy: false, suggestionPreviewLine: NO_COORDINATES });
      }
    }

    /** A loop is ridden from the point nearest the rider; a line from its start. */
    function offerRejoin(route: OfferCatalogRoute, here: Coordinate): readonly Coordinate[] {
      const line = route.line;
      const first = line[0];
      const last = line.at(-1);
      const loop = first !== undefined && last !== undefined && haversine(first, last) < 2_000;
      let ordered = line;
      if (loop) {
        let nearest = 0;
        line.forEach((vertex, index) => {
          if (haversine(vertex, here) < haversine(line[nearest] as Coordinate, here)) nearest = index;
        });
        ordered = [...line.slice(nearest), ...line.slice(1, nearest + 1)];
      }
      return loopRejoinAnchors(ordered, [], 0);
    }

    function observeRideOfferAttention(navigation: SessionNavigationState, instant: string): boolean {
      const result = evaluateRideOfferAttention({
        speedMps: navigation.position.speedMps,
        headingDegrees: navigation.position.headingDegrees,
        observedAtMs: navigation.position.observedAt === null ? null : Date.parse(navigation.position.observedAt),
        nowMs: Date.parse(instant),
        instructionDistanceMeters: navigation.instruction?.distanceMeters ?? null,
        state: offerAttention,
      });
      offerAttention = result.state;
      return result.allowed;
    }

    /**
     * Free Ride offers (#14): while the rider roams with suggestions on, plan
     * the best whole ride from here and put it up as a card, as Uber does for
     * drivers. One at a time; minutes apart while moving, seconds when stopped.
     */
    function scheduleRideOffer(state: RideSessionState, navigation: SessionNavigationState, instant: string): void {
      const eligible = rideOffers && navigation.activity === "free" && state.suggestions === "on" &&
        state.recordingId === null && returnPlanner !== undefined;
      if (offerSession !== state.sessionId) {
        clearRideOffer();
        offerSession = state.sessionId;
        offerHistory = EMPTY_OFFER_HISTORY;
        offerEndedAtMs = null;
        offerAttention = EMPTY_RIDE_OFFER_ATTENTION;
        offerRequested = false;
      }
      if (!eligible) {
        if (shownOffer !== null || get().rideOffer !== null || get().rideOfferBusy) clearRideOffer();
        offerAttention = EMPTY_RIDE_OFFER_ATTENTION;
        return;
      }
      const nowMs = Date.parse(instant);
      const offer = get().rideOffer;
      if (offer !== null) {
        if (nowMs - Date.parse(offer.shownAt) >= offer.lifetimeMs) get().skipRideOffer();
        return;
      }
      if (!observeRideOfferAttention(navigation, instant)) return;
      if (get().rideOfferBusy || get().returnBusy || get().liveSuggestion !== null || get().suggestionBusy) return;
      const here = navigation.position.quality === "fresh-good" ? navigation.position.coordinate : null;
      if (here === null) return;
      const timing = rideOfferTiming({
        speedMps: navigation.position.speedMps,
        nowMs,
        lastOfferEndedAtMs: offerEndedAtMs,
        requested: offerRequested,
      });
      if (!timing.mayOffer) return;
      if (offerCatalog === null && loadOfferCatalog !== undefined) {
        if (offerCatalogLoading) return;
        offerCatalogLoading = true;
        const catalogAbort = new AbortController();
        void loadOfferCatalog(here, catalogAbort.signal)
          .then((routes) => { offerCatalog = routes; })
          .catch(() => { offerCatalog = []; })
          .finally(() => { offerCatalogLoading = false; });
        return;
      }
      const candidate = rankRideOffers({
        position: here,
        headingDegrees: navigation.position.headingDegrees,
        catalog: offerCatalog ?? [],
        home: readSavedHome(),
        history: offerHistory,
      })[0];
      if (candidate === undefined) return;
      offerRequested = false;
      void planRideOffer(state, navigation, candidate, here, timing.lifetimeMs);
    }

    async function planRideOffer(
      state: RideSessionState,
      navigation: SessionNavigationState,
      candidate: RideOfferCandidate,
      here: Coordinate,
      lifetimeMs: number,
    ): Promise<void> {
      if (returnPlanner === undefined) return;
      offerAbort?.abort();
      const abort = new AbortController();
      const generation = ++offerGeneration;
      offerAbort = abort;
      set({ rideOfferBusy: true });
      const backHere: ExplicitReturnTarget = { kind: "session-start", coordinate: here, label: "Back here" };
      let plan: ReturnPlanResult;
      try {
        plan = candidate.kind === "home"
          ? await returnPlanner.plan({
              navigation,
              target: { kind: "saved-home", coordinate: candidate.home, label: "Home" },
              mode: "head-home",
              signal: abort.signal,
            })
          : candidate.kind === "loop"
            ? await returnPlanner.plan({ navigation, target: backHere, mode: "loop", loopMinutes: candidate.minutes, signal: abort.signal })
            : await returnPlanner.plan({
                navigation,
                target: backHere,
                mode: "loop",
                rejoin: offerRejoin(candidate.route, here),
                signal: abort.signal,
              });
      } catch {
        plan = { status: "unavailable", reason: "no-route" };
      }
      if (!running || offerAbort !== abort || offerGeneration !== generation) return;
      offerAbort = null;
      const current = controller.snapshot();
      if (
        current === null ||
        current.sessionId !== state.sessionId ||
        current.activity !== "free" ||
        current.suggestions !== "on" ||
        current.recordingId !== null ||
        get().liveSuggestion !== null ||
        get().suggestionBusy
      ) {
        set({ rideOfferBusy: false });
        return;
      }
      const currentNavigation = controller.navigationState();
      if (
        currentNavigation === null ||
        currentNavigation.sessionId !== state.sessionId ||
        currentNavigation.activity !== "free" ||
        !observeRideOfferAttention(currentNavigation, now())
      ) {
        set({ rideOfferBusy: false });
        return;
      }
      if (plan.status !== "planned") {
        // An offer that can't be routed is dropped quietly; the next one follows.
        offerHistory = { ...offerHistory, skippedIds: new Set([...offerHistory.skippedIds, candidate.id]) };
        set({ rideOfferBusy: false });
        return;
      }
      // An offer is only a preview until accepted; resolving its geometry must
      // not replace the active guided route underneath the card.
      const line = await resolveRouteLine(plan.routeGeometryRef);
      if (!running || offerGeneration !== generation) return;
      if (line === null || line.length < 2) {
        offerHistory = { ...offerHistory, skippedIds: new Set([...offerHistory.skippedIds, candidate.id]) };
        set({ rideOfferBusy: false, suggestionPreviewLine: NO_COORDINATES });
        return;
      }
      const latest = controller.snapshot();
      const latestNavigation = controller.navigationState();
      if (
        latest === null ||
        latest.sessionId !== state.sessionId ||
        latest.activity !== "free" ||
        latest.suggestions !== "on" ||
        latest.recordingId !== null ||
        get().liveSuggestion !== null ||
        get().suggestionBusy ||
        latestNavigation === null ||
        latestNavigation.sessionId !== state.sessionId ||
        !observeRideOfferAttention(latestNavigation, now())
      ) {
        set({ rideOfferBusy: false });
        return;
      }
      const summary = summarizeRideOffer(candidate, plan);
      shownOffer = { candidate, plan, line };
      set({
        rideOfferBusy: false,
        rideOffer: { id: candidate.id, kind: candidate.kind, summary, shownAt: now(), lifetimeMs },
        suggestionPreviewLine: line,
      });
      feelOpportunity?.("opportunity");
      announceOpportunity?.(summary.spoken);
    }

    function scheduleSuggestionQuery(
      state: RideSessionState,
      navigation: SessionNavigationState,
    ): void {
      if (
        navigation.activity !== "free" ||
        state.suggestions !== "on" ||
        state.recordingId !== null ||
        evaluateSuggestion === undefined
      ) {
        if (suggestionAbort !== null) {
          suggestionAbort.abort();
          suggestionAbort = null;
        }
        return;
      }
      if (
        navigation.position.quality !== "fresh-good" ||
        navigation.position.coordinate === null ||
        navigation.position.observedAt === null
      ) {
        suggestionAbort?.abort();
        suggestionAbort = null;
        if (get().liveSuggestion !== null || get().suggestionBusy) {
          set({
            liveSuggestion: null,
            suggestionPreviewLine: NO_COORDINATES,
            suggestionBusy: false,
            freeRideStatusMessage: "Live suggestions need a fresh, accurate location.",
          });
        }
        return;
      }
      if (get().freeRideStatusMessage === "Live suggestions need a fresh, accurate location.") {
        set({ freeRideStatusMessage: null });
      }
      // A valid opportunity stands until it is taken or passed; a query tick
      // must never replace or erase it (FR-03).
      if (get().liveSuggestion !== null) return;
      // One card at a time: a ride offer on screen holds the road suggestions.
      if (get().rideOffer !== null || get().rideOfferBusy) return;
      const positionKey = `${state.sessionId}:${navigation.position.observedAt}`;
      if (positionKey === lastSuggestionPositionKey) return;
      lastSuggestionPositionKey = positionKey;
      const instant = Date.parse(now());
      if (instant - lastSuggestionQueryAt < 30_000) return;
      lastSuggestionQueryAt = instant;

      suggestionAbort?.abort();
      const abort = new AbortController();
      suggestionAbort = abort;
      const generation = ++suggestionGeneration;
      set({
        suggestionBusy: true,
        freeRideError: null,
        freeRideStatusMessage: "Looking for roads ahead…",
      });
      void evaluateSuggestion(navigation, lastSuggestionAt, abort.signal).then(async (result) => {
        if (!running || abort.signal.aborted || generation !== suggestionGeneration) return;
        if (result.status === "suggestion") {
          const previewLine = await resolveRouteLine(result.suggestion.routeGeometryRef ?? null);
          if (!running || abort.signal.aborted || generation !== suggestionGeneration) return;
          if (get().rideOffer !== null || get().rideOfferBusy) {
            suggestionAbort = null;
            set({ liveSuggestion: null, suggestionBusy: false });
            return;
          }
          if (previewLine === null || previewLine.length < 2) {
            suggestionAbort = null;
            set({
              liveSuggestion: null,
              suggestionPreviewLine: NO_COORDINATES,
              suggestionBusy: false,
              freeRideStatusMessage: "The suggested route line is unavailable right now.",
            });
            return;
          }
          const current = controller.snapshot();
          const currentNavigation = controller.navigationState();
          suggestionAbort = null;
          if (
            current?.suggestions !== "on" || current.activity !== "free" ||
            current.recordingId !== null || currentNavigation === null ||
            currentNavigation.position.quality !== "fresh-good" || currentNavigation.position.coordinate === null
          ) {
            set({ liveSuggestion: null, suggestionPreviewLine: NO_COORDINATES, suggestionBusy: false });
            return;
          }
          lastSuggestionAt = now();
          shownOpportunity = showOpportunity(result.suggestion, currentNavigation.position.coordinate, lastSuggestionAt);
          set({
            liveSuggestion: result.suggestion,
            liveSuggestionDistanceMeters: result.suggestion.distanceToDecisionMeters,
            suggestionPreviewLine: previewLine ?? NO_COORDINATES,
            suggestionBusy: false,
            freeRideStatusMessage: null,
            freeRideError: null,
          });
          // Heard first (§6): said once, felt once. A critical warning on screen
          // outranks an optional road, so it stays silent then.
          const critical = get().viewModel?.warnings.some((warning) => warning.severity === "critical") ?? false;
          if (!critical) {
            announceOpportunity?.(spokenOpportunity(result.suggestion, result.suggestion.distanceToDecisionMeters));
            feelOpportunity?.("opportunity");
          }
          // The preview is scene content only. An unsolicited opportunity must
          // never take camera ownership from the heading-up ride camera.
          refresh();
        } else {
          if (get().rideOffer !== null || get().rideOfferBusy) {
            suggestionAbort = null;
            set({ liveSuggestion: null, suggestionBusy: false });
            return;
          }
          suggestionAbort = null;
          set({
            liveSuggestion: null,
            suggestionPreviewLine: NO_COORDINATES,
            suggestionBusy: false,
            freeRideStatusMessage: result.reason === "gps"
              ? "Live suggestions need a fresh, accurate location."
              : "No suitable route is available ahead right now.",
          });
        }
      }).catch(() => {
        if (!running || abort.signal.aborted || generation !== suggestionGeneration) return;
        suggestionAbort = null;
        set({
          liveSuggestion: null,
          suggestionPreviewLine: NO_COORDINATES,
          suggestionBusy: false,
          freeRideStatusMessage: "Live suggestions are unavailable right now. You can keep riding.",
          freeRideError: null,
        });
      });
    }

    /** §8: the wake lock is attempted while the ride is physically moving. */
    function syncRideActivity(navigation: SessionNavigationState | null): void {
      const active =
        navigation !== null && get().status === "ready" && movingActivity(navigation);
      if (rideActive === active) return;
      rideActive = active;
      environment?.setRideActive(active);
    }

    /**
     * The freshness clock runs whenever the surface is showing a live session —
     * including a terminal one.
     *
     * A finished ride still shows the position it holds, and its age has to keep
     * advancing: freezing the clock at completion would leave "updated 2 s ago"
     * on screen for as long as the rider looked at it, which is the stored-
     * freshness lie 8 §4 forbids. One projection a second is what keeps an ended
     * ride's last-known position honest — and it is what eventually turns its
     * speed and heading off, since nothing re-acquires a fix once the ride is
     * over.
     */
    function syncTimer(navigation: SessionNavigationState | null): void {
      const shouldTick = navigation !== null && get().status === "ready";
      if (shouldTick && timer === null) {
        timer = schedule(() => refresh(), tickIntervalMs);
        return;
      }
      if (!shouldTick && timer !== null) {
        unschedule(timer);
        timer = null;
      }
    }

    /**
     * One command, one honest result.
     *
     * The rider's own first command also dismisses the recovery note: "ride
     * restored, it is paused" is a statement about a state the rider just left,
     * and leaving it on screen next to a moving ride is the kind of stale copy
     * that makes a surface look broken.
     */
    async function dispatchCommand(event: ReturnType<typeof sessionPausedEvent>): Promise<boolean> {
      abortPendingReturn();
      const result = await controller.dispatch(event);
      if (!running) return false;
      set({
        lastError:
          result.outcome === "rejected"
            ? (result.message ?? "The ride could not be updated.")
            : null,
        statusMessage: result.outcome === "applied" ? null : get().statusMessage,
      });
      await syncNavigationEngine(result.state);
      refresh();
      return result.outcome === "applied" && result.persistence === "durable";
    }

    function abortPendingReturn(): void {
      if (pendingReturnAbort === null) return;
      pendingReturnAbort.abort();
      pendingReturnAbort = null;
      set({ returnBusy: false, freeRideStatusMessage: null });
    }

    async function planRecoveryReturn(
      mode: Extract<ReturnMode, "fatigue" | "turn-around" | "loop">,
      options: {
        readonly resume?: ExplicitReturnTarget;
        readonly via?: RerouteDetour;
        readonly loopMinutes?: number;
      } = {},
    ): Promise<void> {
      const replan = options.resume !== undefined;
      const state = controller.snapshot();
      if (
        !running ||
        state === null ||
        (state.activity !== "free" && state.activity !== "guided")
      ) return;
      const navigation = controller.navigationState() ?? deriveSessionNavigation(state, { now: now() });
      const guided = state.activity === "guided";
      if (returnPlanner === undefined) {
        if (guided) {
          set({ rerouteError: "Return routing is unavailable right now.", rerouteMessage: null });
        } else {
          set({ freeRideError: "Return routing is unavailable right now.", freeRideStatusMessage: null });
        }
        return;
      }

      const here = navigation.position.quality === "fresh-good" ? navigation.position.coordinate : null;
      const target: ExplicitReturnTarget | null = options.resume !== undefined
        ? options.resume
        : mode === "loop"
        ? here === null
          ? null
          : { kind: "session-start", coordinate: here, label: "Loop start" }
        : mode === "turn-around"
        ? state.sessionStartPosition === null
          ? null
          : { kind: "session-start", coordinate: state.sessionStartPosition, label: "Ride start" }
        : resolveHeadHomeTarget({
            savedHome: readSavedHome(),
            sessionStart: state.sessionStartPosition,
          });

      if (target === null) {
        const message = mode === "loop"
          ? "A loop from here needs a fresh, accurate GPS fix."
          : mode === "turn-around"
          ? "Turn Around needs the ride's first good GPS fix."
          : "An easier return needs a saved Home or the ride's first good GPS fix.";
        if (guided) {
          set({ rerouteError: message, rerouteMessage: null });
        } else {
          set({ freeRideError: message, freeRideStatusMessage: null });
        }
        return;
      }

      abortPendingReturn();
      rerouteAbort?.abort();
      rerouteAbort = null;
      const abort = new AbortController();
      pendingReturnAbort = abort;
      if (guided) lastRerouteAt = Date.parse(now());
      const planningCopy = options.via !== undefined
        ? `Finding a route via ${options.via.label}…`
        : replan
          ? mode === "loop" ? "Getting you back on your loop…" : "Finding a new way back…"
          : mode === "loop"
            ? `Planning a ${loopLengthLabel(options.loopMinutes ?? 60)} loop from here…`
          : mode === "fatigue"
            ? "Finding an easier way back…"
            : "Planning a legal route back to your ride start…";
      if (guided) {
        set({ rerouteBusy: true, rerouteError: null, rerouteMessage: planningCopy });
      } else {
        set({ returnBusy: true, freeRideError: null, freeRideStatusMessage: planningCopy });
      }

      // A loop already under way rides back onto the rest of itself.
      const along = navigationEngine?.snapshot().frame?.distanceAlongMeters;
      const rejoin = mode === "loop" && replan && along !== undefined
        ? loopRejoinAnchors(lineAhead(get().routeLine, along))
        : [];
      let plan: ReturnPlanResult;
      try {
        plan = await returnPlanner.plan({
          navigation,
          target,
          mode,
          signal: abort.signal,
          ...(options.via === undefined ? {} : { via: options.via }),
          ...(replan ? { fallbackToBest: true } : {}),
          ...(mode === "loop" && !replan ? { loopMinutes: options.loopMinutes ?? 60 } : {}),
          ...(rejoin.length === 0 ? {} : { rejoin }),
        });
      } catch {
        plan = { status: "unavailable", reason: "no-route" };
      }
      if (!running || pendingReturnAbort !== abort) return;

      const current = controller.snapshot();
      const routeChanged = guided && (
        current?.plan.route?.planningGeneration !== state.plan.route?.planningGeneration ||
        current?.plan.route?.routeId !== state.plan.route?.routeId
      );
      const stale = current === null ||
        current.sessionId !== state.sessionId ||
        current.activity !== state.activity ||
        current.recordingId !== state.recordingId ||
        current.plan.rideRevision !== state.plan.rideRevision ||
        routeChanged;
      if (stale) {
        pendingReturnAbort = null;
        if (guided) {
          set({ rerouteBusy: false, rerouteMessage: null });
        } else {
          set({ returnBusy: false, freeRideStatusMessage: null });
        }
        return;
      }

      pendingReturnAbort = null;
      if (plan.status !== "planned") {
        const message = plan.reason === "gps"
          ? "Return routing needs a fresh, accurate GPS fix."
          : plan.reason === "no-lower-workload-route"
            ? "No lower-workload return was found. Your current route is unchanged."
            : plan.reason === "stale-ride" || plan.reason === "ride-missing"
              ? "The ride changed while the return was planning. Go back to Plan and try again."
              : "A return route could not be found right now. Your current ride is unchanged.";
        if (guided) {
          set({ rerouteBusy: false, rerouteMessage: null, rerouteError: message });
        } else {
          set({ returnBusy: false, freeRideStatusMessage: null, freeRideError: message });
        }
        return;
      }

      const at = now();
      const applied = await controller.dispatch(modeChangedEvent("guided", at, plan.route));
      if (applied.outcome !== "applied" || applied.state === null || applied.persistence !== "durable") {
        const message = applied.message ?? "The return route could not be saved to this ride.";
        if (guided) {
          set({ rerouteBusy: false, rerouteMessage: null, rerouteError: message });
        } else {
          set({ returnBusy: false, freeRideStatusMessage: null, freeRideError: message });
        }
        return;
      }

      pointer.write({
        sessionId: applied.state.sessionId,
        rideId: applied.state.plan.rideId,
        routeGeometryRef: plan.routeGeometryRef,
        routeDurationSeconds: plan.durationSeconds,
        ...(plan.instructions === undefined ? {} : { instructions: plan.instructions }),
        updatedAt: at,
      });
      const routeLine = await loadRouteLine(plan.routeGeometryRef);
      await syncNavigationEngine(applied.state);
      const boundNavigation = controller.navigationState() ?? deriveSessionNavigation(applied.state, { now: now() });
      const routeScene = buildRideScene({
        routeId: boundNavigation.plan.route?.routeId ?? null,
        routeLine: routeLine ?? NO_COORDINATES,
        position: {
          coordinate: boundNavigation.position.coordinate,
          quality: boundNavigation.position.quality,
        },
      });
      const successCopy = options.via !== undefined
        ? `Via ${options.via.label} · ${formatDistance(plan.distanceMeters)} to go`
        : replan
          ? `${mode === "loop" ? "Back on your loop" : "New way back"} · ${formatDistance(plan.distanceMeters)} to go`
          : mode === "loop"
            ? `Loop from here · ${formatDistance(plan.distanceMeters)}`
          : mode === "fatigue"
            ? `Easier route · ${formatDistance(plan.distanceMeters)} to go`
            : `Turned around · ${formatDistance(plan.distanceMeters)} to go`;
      activeReturn = { sessionId: applied.state.sessionId, mode, target };
      // A way back replaces any taken opportunity; its end no longer applies.
      excursion = null;
      if (guided) {
        rerouteMessageAt = Date.parse(now());
        set({ rerouteBusy: false, rerouteError: null, rerouteMessage: successCopy });
      } else {
        set({
          returnBusy: false,
          liveSuggestion: null,
          suggestionPreviewLine: NO_COORDINATES,
          freeRideStatusMessage: successCopy,
          freeRideError: null,
        });
      }
      refresh();
      requestRideFit(routeScene, get().follow);
    }

    async function syncNavigationEngine(state = controller.snapshot()): Promise<void> {
      if (state === null || state.activity === "completed" || createNavigationEngine === undefined) {
        if (navigationEngine !== null && state?.activity === "completed") {
          await navigationEngine.stop();
          navigationEngine = null;
          navigationEngineKey = null;
        }
        return;
      }
      const desiredKey = JSON.stringify({ activity: state.activity, route: state.plan.route });
      if (navigationEngine !== null && navigationEngineKey !== desiredKey) {
        await navigationEngine.stop();
        navigationEngine = null;
        navigationEngineKey = null;
      }
      if (navigationEngine === null) {
        navigationEngine = createNavigationEngine(state, get().routeLine);
        navigationEngineKey = desiredKey;
        const started = await navigationEngine.start();
        if (!started) {
          set({ lastError: navigationEngine.snapshot().message ?? "Location tracking could not start." });
        }
      } else {
        await navigationEngine.syncLifecycle();
      }
    }

    /** Resolves only persisted geometry; a missing handle never gets a fake line. */
    async function resolveRouteLine(ref: GeometryRef | null): Promise<readonly Coordinate[] | null> {
      if (ref === null || readRouteLine === undefined) {
        return null;
      }
      let line: readonly Coordinate[] | null = null;
      try {
        line = await readRouteLine(ref);
      } catch {
        line = null;
      }
      return line;
    }

    /** Loads the active route line the pointer named, once, and says when it did not. */
    async function loadRouteLine(ref: GeometryRef | null): Promise<readonly Coordinate[] | null> {
      const line = await resolveRouteLine(ref);
      if (!running) return line;
      set({ routeLine: line ?? NO_COORDINATES, routeLineAvailable: line !== null });
      return line;
    }

    /** One declarative fit to drawn ride geometry; the host applies measured HUD insets. */
    function requestRideFit(scene: ReturnType<typeof buildRideScene>, preserveFollow: boolean): void {
      if (scene.routes.length === 0) return;
      followedAt = get().viewModel?.mapPosition?.coordinate ?? followedAt;
      lastCameraKey = null;
      set({
        follow: preserveFollow,
        cameraToken: get().cameraToken + 1,
        cameraHeld: false,
        cameraExtent: sceneExtent(scene),
        rideCamera: null,
      });
    }

    /** Recovers the session the pointer names, or states why it cannot (8 §13). */
    async function recover(): Promise<void> {
      const read = pointer.read();
      if (read.status !== "found") {
        // A pointer that exists but cannot be read is not "no ride": the rider
        // may well have one, so the surface offers a retry instead of an empty
        // state that quietly says the ride is gone (8 §13).
        set({
          status: read.status === "unreadable" ? "unavailable" : "absent",
          statusMessage:
            read.status === "unreadable" ? "The ride's saved pointer couldn't be read." : null,
        });
        return;
      }
      const report = await controller.resume(read.pointer.sessionId);
      if (!running) return;
      switch (report.status) {
        case "restored": {
          let recordingMessage: string | null = null;
          if (report.state.recordingId !== null && recording !== undefined) {
            const recoveredRecording = await recording.recover(report.state.recordingId);
            if (recoveredRecording.status === "already-saved") {
              pointer.clear();
              set({ status: "absent", statusMessage: "Recording saved in My rides." });
              return;
            }
            if (recoveredRecording.status === "failed") {
              recordingMessage = recoveredRecording.message;
            } else if (
              recoveredRecording.status === "recording" &&
              recoveredRecording.report.status !== "absent" &&
              recoveredRecording.report.status !== "corrupt" &&
              recoveredRecording.report.status !== "partial"
            ) {
              recordingMessage = `Recovered recording, ${formatDistance(recoveredRecording.report.summary.distanceMeters)}. It is paused — resume when you're ready.`;
            } else if (
              recoveredRecording.status === "recording" &&
              recoveredRecording.report.status === "partial"
            ) {
              const dropped = recoveredRecording.report.tail?.droppedPointCount;
              const lostPointText = dropped === null || dropped === undefined
                ? "The last GPS batch is incomplete."
                : `The last GPS batch is missing ${dropped} ${dropped === 1 ? "point" : "points"}.`;
              recordingMessage = `Recovered recording, ${formatDistance(recoveredRecording.report.summary.distanceMeters)}. ${lostPointText} It is paused and cannot be saved as a complete ride; discard is available.`;
            } else if (
              recoveredRecording.status === "recording" &&
              recoveredRecording.report.status === "corrupt"
            ) {
              recordingMessage = "The recording trace is corrupt and cannot be safely saved. You can discard it.";
            }
          }
          if (report.state.activity === "completed") {
            // The ride already ended; the pointer outlived it (a crash between the
            // terminal event and the clear). Drop it and say so, rather than
            // reopening a finished ride as if it were live.
            pointer.clear();
            set({ status: "absent", statusMessage: null });
            return;
          }
          const dropped = report.droppedEvents.length;
          set({
            status: "ready",
            statusMessage: recordingMessage ?? (report.pausedByRecovery
              ? "Ride restored. It is paused — resume when you're ready."
              : dropped > 0
                ? `Ride restored. ${dropped} unreadable journal ${dropped === 1 ? "entry was" : "entries were"} skipped.`
                : null),
          });
          await loadRouteLine(read.pointer.routeGeometryRef);
          await syncNavigationEngine(report.state);
          refresh();
          return;
        }
        case "absent": {
          pointer.clear();
          set({ status: "absent", statusMessage: null });
          return;
        }
        case "unrecoverable": {
          pointer.clear();
          set({
            status: "unrecoverable",
            statusMessage: `The ride's journal could not be replayed (${report.droppedEvents.length} unreadable entries).`,
          });
          return;
        }
        case "unavailable": {
          set({
            status: "unavailable",
            statusMessage: "The ride's saved data couldn't be opened.",
          });
          return;
        }
      }
    }

    return {
      status: "loading",
      statusMessage: null,
      lastError: null,
      navigation: null,
      suggestions: "off",
      liveSuggestion: null,
      liveSuggestionDistanceMeters: null,
      suggestionPreviewLine: NO_COORDINATES,
      suggestionBusy: false,
      rideOffer: null,
      rideOfferBusy: false,
      returnBusy: false,
      freeRideStatusMessage: null,
      freeRideError: null,
      rerouteAvailable: reroutePlanner !== undefined,
      rideOffersAvailable: rideOffers && returnPlanner !== undefined,
      rerouteBusy: false,
      rerouteMessage: null,
      rerouteError: null,
      environment: EMPTY_ENVIRONMENT,
      viewModel: null,
      routeLine: NO_COORDINATES,
      routeLineAvailable: false,
      mapReady: false,
      follow: false,
      cameraToken: 0,
      cameraHeld: false,
      cameraExtent: null,
      stopConfirm: false,
      rideCamera: null,
      farFromStart: null,
      riderSettings: riderSettingsStorage?.read() ?? createRiderSettings(),

      setRideMetric(index: number, id: RideMetricId): boolean {
        const strip = get().viewModel?.metrics ?? null;
        if (strip === null || !strip.customizable || !metricAvailable(id, strip.mode, strip.sources)) return false;
        if (index < 0 || index >= strip.shownIds.length) return false;
        const current = get().riderSettings;
        const stored = current.uiPreferences[strip.preferenceKey];
        saveRiderSettings(withMetricSlots(current, strip.preferenceKey, storedAfterChoice(stored, strip.shownIds, index, id)));
        // From this same tap: iOS motion permission requires the gesture's own call stack.
        primeMotionIfChosen([id]);
        return true;
      },

      applyRideMetricPreset(id: RideMetricPresetId): boolean {
        const strip = get().viewModel?.metrics ?? null;
        const preset = RIDE_METRIC_PRESETS.find((candidate) => candidate.id === id) ?? null;
        if (strip === null || preset === null || !strip.customizable) return false;
        if (!preset.slots.every((metric) => metricAvailable(metric, strip.mode, strip.sources))) return false;
        saveRiderSettings(withMetricSlots(get().riderSettings, strip.preferenceKey, preset.slots));
        primeMotionIfChosen(preset.slots);
        return true;
      },

      setRideInterestFilter(filter: RideInterestFilter): void {
        saveRiderSettings(withRideInterestFilter(get().riderSettings, filter));
      },
      calibrateLean,

      async start(): Promise<void> {
        if (running) return;
        running = true;
        rideActive = null;
        environment = createEnvironment();
        unsubscribeEnvironment = environment.subscribe(() => refresh());
        motion = createMotion?.() ?? null;
        attachPageListeners();
        await recover();
      },

      async startRecording(rideId, rideRevision): Promise<void> {
        if (!running || recording === undefined) return;
        const started = await recording.start(rideId, rideRevision, now());
        if (started.outcome !== "started") {
          set({
            statusMessage: "The recording could not be started. Check device storage and try again.",
            lastError: "The recording could not be started.",
          });
          return;
        }
        // The Recording HUD projects "Waiting for the first GPS fix" from its
        // trace summary; keeping that text in the persistent status slot would
        // leave stale copy onscreen after the first point arrives.
        set({ status: "ready", statusMessage: null, lastError: null });
        await syncNavigationEngine();
        refresh();
      },

      async setSuggestions(enabled): Promise<void> {
        const state = controller.snapshot();
        if (!running || state === null || state.activity !== "free" || state.recordingId !== null) return;
        const value: SessionSuggestions = enabled ? "on" : "off";
        const result = await controller.dispatch(suggestionsChangedEvent(value, now()));
        if (result.outcome !== "applied" || result.persistence !== "durable") {
          set({ freeRideError: result.message ?? "The suggestion setting could not be saved." });
          return;
        }
        if (!enabled) {
          suggestionAbort?.abort();
          suggestionAbort = null;
          lastSuggestionPositionKey = null;
        }
        set({
          suggestions: value,
          liveSuggestion: null,
          suggestionPreviewLine: NO_COORDINATES,
          suggestionBusy: false,
          freeRideStatusMessage: enabled ? "Live suggestions are on." : "Live suggestions are off.",
          freeRideError: null,
        });
        refresh();
      },

      async acceptRideOffer(): Promise<void> {
        const offer = shownOffer;
        const state = controller.snapshot();
        if (!running || offer === null || state === null || state.activity !== "free") return;
        const { candidate, plan, line } = offer;
        shownOffer = null;
        offerEndedAtMs = Date.parse(now());
        set({ rideOffer: null, suggestionPreviewLine: NO_COORDINATES });
        if (candidate.kind === "home") {
          await get().headHome();
          return;
        }
        abortPendingReturn();
        const at = now();
        const applied = await controller.dispatch(modeChangedEvent("guided", at, plan.route));
        if (applied.outcome !== "applied" || applied.state === null || applied.persistence !== "durable") {
          set({ freeRideError: applied.message ?? "That ride could not be started." });
          return;
        }
        pointer.write({
          sessionId: applied.state.sessionId,
          rideId: applied.state.plan.rideId,
          routeGeometryRef: plan.routeGeometryRef,
          routeDurationSeconds: plan.durationSeconds,
          ...(plan.instructions === undefined ? {} : { instructions: plan.instructions }),
          updatedAt: at,
        });
        // Every offer so far ends back here: Free Ride picks up when it does.
        const end = line.at(-1);
        excursion = end === undefined ? null : { sessionId: applied.state.sessionId, end, armed: false };
        await syncNavigationEngine(applied.state);
        feelOpportunity?.("accepted");
        const title = candidate.kind === "catalog" ? candidate.route.name : "your loop";
        set({
          freeRideStatusMessage: `Riding ${title}. Free Ride picks up back here.`,
          freeRideError: null,
        });
        refresh();
        const bound = controller.navigationState() ?? deriveSessionNavigation(applied.state, { now: now() });
        requestRideFit(buildRideScene({
          routeId: bound.plan.route?.routeId ?? null,
          routeLine: line,
          position: { coordinate: bound.position.coordinate, quality: bound.position.quality },
        }), get().follow);
      },

      skipRideOffer(): void {
        const offer = shownOffer;
        if (offer === null) return;
        offerHistory = recordOfferSkip(offerHistory, offer.candidate);
        offerEndedAtMs = Date.parse(now());
        shownOffer = null;
        set({ rideOffer: null, suggestionPreviewLine: NO_COORDINATES });
      },

      requestRideOffer(): void {
        offerRequested = true;
        refresh();
      },

      async acceptLiveSuggestion(): Promise<void> {
        abortPendingReturn();
        const state = controller.snapshot();
        const suggestion = get().liveSuggestion;
        const navigation = get().navigation;
        if (
          !running || state === null || state.activity !== "free" || state.recordingId !== null || state.suggestions !== "on" ||
          suggestion === null || navigation?.position.quality !== "fresh-good"
        ) return;
        const at = now();
        const applied = await controller.dispatch(modeChangedEvent("guided", at, suggestion.route));
        if (applied.outcome !== "applied" || applied.state === null || applied.persistence !== "durable") {
          set({ freeRideError: applied.message ?? "That route could not be started." });
          return;
        }
        pointer.write({
          sessionId: applied.state.sessionId,
          rideId: applied.state.plan.rideId,
          routeGeometryRef: suggestion.routeGeometryRef ?? null,
          ...(suggestion.durationSeconds === undefined ? {} : { routeDurationSeconds: suggestion.durationSeconds }),
          ...(suggestion.instructions === undefined ? {} : { instructions: suggestion.instructions }),
          updatedAt: at,
        });
        const segment = await loadRouteLine(suggestion.routeGeometryRef ?? null);
        const end = segment?.at(-1) ?? get().suggestionPreviewLine.at(-1);
        excursion = end === undefined ? null : { sessionId: applied.state.sessionId, end, armed: false };
        shownOpportunity = null;
        await syncNavigationEngine(applied.state);
        feelOpportunity?.("accepted");
        set({
          liveSuggestion: null,
          liveSuggestionDistanceMeters: null,
          suggestionPreviewLine: NO_COORDINATES,
          suggestionBusy: false,
          freeRideStatusMessage: `Following ${suggestion.label}. Free Ride picks up at its end.`,
          freeRideError: null,
        });
        refresh();
      },

      dismissLiveSuggestion(): void {
        shownOpportunity = null;
        set({
          liveSuggestion: null,
          liveSuggestionDistanceMeters: null,
          suggestionPreviewLine: NO_COORDINATES,
          freeRideStatusMessage: "Suggestion dismissed. Free Ride continues.",
        });
      },

      async headHome(): Promise<void> {
        const state = controller.snapshot();
        const navigation = get().navigation;
        if (!running || state === null || navigation === null || state.activity !== "free" || state.recordingId !== null) return;
        if (returnPlanner === undefined) {
          set({ freeRideError: "Head Home is unavailable right now." });
          return;
        }
        const savedHome = readSavedHome();
        const target: ExplicitReturnTarget | null = resolveHeadHomeTarget({
          savedHome,
          sessionStart: state.sessionStartPosition,
        });
        if (target === null) {
          set({
            freeRideError: "A location fix is needed before Head Home can use this ride’s start.",
            freeRideStatusMessage: null,
          });
          return;
        }
        const targetLabel = target.kind === "saved-home" ? "saved Home" : "your session start";
        abortPendingReturn();
        const abort = new AbortController();
        pendingReturnAbort = abort;
        set({
          returnBusy: true,
          freeRideError: null,
          freeRideStatusMessage: `Planning a route to ${targetLabel}…`,
        });
        let plan: ReturnPlanResult;
        try {
          plan = await returnPlanner.plan({
            navigation,
            target,
            mode: "head-home",
            signal: abort.signal,
          });
        } catch {
          plan = { status: "unavailable", reason: "no-route" };
        }
        if (!running || pendingReturnAbort !== abort) return;
        const current = controller.snapshot();
        const revisionChanged = current?.sessionId === state.sessionId &&
          current.plan.rideRevision !== state.plan.rideRevision;
        if (
          current === null || current.sessionId !== state.sessionId ||
          current.activity !== "free" || current.recordingId !== null ||
          revisionChanged
        ) {
          pendingReturnAbort = null;
          set({
            returnBusy: false,
            freeRideStatusMessage: null,
            ...(revisionChanged && current?.activity === "free"
              ? { freeRideError: "Ride details changed while Head Home was planning. Try again." }
              : {}),
          });
          return;
        }
        pendingReturnAbort = null;
        if (plan.status !== "planned") {
          const message = plan.reason === "gps"
            ? "Head Home needs a fresh, accurate GPS fix. Check location and try again."
            : plan.reason === "stale-ride" || plan.reason === "ride-missing"
              ? "The ride changed and its return could not be planned. Resume from the planner and try again."
              : "A return route could not be found right now. Keep riding or try again later.";
          set({ returnBusy: false, freeRideError: message, freeRideStatusMessage: null });
          return;
        }
        const at = now();
        const applied = await controller.dispatch(modeChangedEvent("guided", at, plan.route));
        if (applied.outcome !== "applied" || applied.state === null || applied.persistence !== "durable") {
          set({
            returnBusy: false,
            freeRideError: applied.message ?? "The return route could not be saved to this ride.",
            freeRideStatusMessage: null,
          });
          return;
        }
        pointer.write({
          sessionId: applied.state.sessionId,
          rideId: applied.state.plan.rideId,
          routeGeometryRef: plan.routeGeometryRef,
          routeDurationSeconds: plan.durationSeconds,
          ...(plan.instructions === undefined ? {} : { instructions: plan.instructions }),
          updatedAt: at,
        });
        const routeLine = await loadRouteLine(plan.routeGeometryRef);
        await syncNavigationEngine(applied.state);
        const boundNavigation = controller.navigationState() ?? deriveSessionNavigation(applied.state, { now: now() });
        const routeScene = buildRideScene({
          routeId: boundNavigation.plan.route?.routeId ?? null,
          routeLine: routeLine ?? NO_COORDINATES,
          position: {
            coordinate: boundNavigation.position.coordinate,
            quality: boundNavigation.position.quality,
          },
        });
        set({
          returnBusy: false,
          liveSuggestion: null,
          suggestionPreviewLine: NO_COORDINATES,
          freeRideStatusMessage: target.kind === "saved-home"
            ? "Returning to your saved Home."
            : "Returning to your session start.",
          freeRideError: null,
        });
        refresh();
        requestRideFit(routeScene, get().follow);
      },

      async easierWayBack(): Promise<void> {
        await planRecoveryReturn("fatigue");
      },

      async turnAround(): Promise<void> {
        await planRecoveryReturn("turn-around");
      },

      async loopFromHere(minutes: number): Promise<void> {
        await planRecoveryReturn("loop", { loopMinutes: minutes });
      },

      async reroute(detour?: RerouteDetour, rerouteOptions?: { readonly wholeRoute?: boolean }): Promise<void> {
        const wholeRoute = rerouteOptions?.wholeRoute === true;
        if (!running || reroutePlanner === undefined) return;
        const state = controller.snapshot();
        if (state === null || state.activity !== "guided" || state.plan.route === null) return;
        if (activeReturn !== null && activeReturn.sessionId === state.sessionId) {
          await planRecoveryReturn(activeReturn.mode, {
            resume: activeReturn.target,
            ...(detour === undefined ? {} : { via: detour }),
          });
          return;
        }
        const navigation = controller.navigationState() ?? deriveSessionNavigation(state, { now: now() });
        if (navigation.position.quality !== "fresh-good" || navigation.position.coordinate === null) {
          set({ rerouteError: "Rerouting needs a fresh, accurate GPS fix.", rerouteMessage: null });
          return;
        }
        rerouteAbort?.abort();
        const abort = new AbortController();
        rerouteAbort = abort;
        lastRerouteAt = Date.parse(now());
        set({
          rerouteBusy: true,
          rerouteError: null,
          rerouteMessage: wholeRoute
            ? "Finding the way to the start…"
            : detour === undefined ? "Finding a new route from here…" : `Finding a route via ${detour.label}…`,
        });
        let plan: Awaited<ReturnType<GuidedReroutePlanner["plan"]>>;
        try {
          // Where the rider last matched the route: a loop rejoins the rest of
          // itself from there instead of heading straight back to the start.
          const along = wholeRoute ? 0 : navigationEngine?.snapshot().frame?.distanceAlongMeters;
          const aheadLine = along === undefined ? undefined : lineAhead(get().routeLine, along);
          plan = await reroutePlanner.plan({
            navigation,
            ...(detour === undefined ? {} : { detour }),
            ...(aheadLine === undefined || aheadLine.length < 2 ? {} : { aheadLine }),
            ...(wholeRoute ? { followLine: true } : {}),
            signal: abort.signal,
          });
        } catch {
          plan = { status: "unavailable", reason: "no-route" };
        }
        if (!running || rerouteAbort !== abort) return;
        rerouteAbort = null;
        const current = controller.snapshot();
        if (
          current === null || current.sessionId !== state.sessionId || current.activity !== "guided" ||
          current.plan.rideRevision !== state.plan.rideRevision ||
          current.plan.route?.planningGeneration !== state.plan.route.planningGeneration ||
          current.plan.route?.routeId !== state.plan.route.routeId
        ) {
          set({ rerouteBusy: false, rerouteMessage: null });
          return;
        }
        if (plan.status !== "planned") {
          const message = plan.reason === "gps"
            ? "Rerouting needs a fresh, accurate GPS fix."
            : plan.reason === "stale-ride" || plan.reason === "ride-missing"
              ? "The ride changed on another screen. Return to Plan to update it."
              : detour === undefined
                ? "A new route couldn't be found right now. Keep riding toward the line."
                : `A route via ${detour.label} couldn't be found right now.`;
          set({ rerouteBusy: false, rerouteMessage: null, rerouteError: message });
          return;
        }
        const at = now();
        const applied = await controller.dispatch(modeChangedEvent("guided", at, plan.route));
        if (applied.outcome !== "applied" || applied.state === null || applied.persistence !== "durable") {
          set({
            rerouteBusy: false,
            rerouteMessage: null,
            rerouteError: applied.message ?? "The new route could not be saved to this ride.",
          });
          return;
        }
        pointer.write({
          sessionId: applied.state.sessionId,
          rideId: applied.state.plan.rideId,
          routeGeometryRef: plan.routeGeometryRef,
          routeDurationSeconds: plan.durationSeconds,
          ...(plan.instructions === undefined ? {} : { instructions: plan.instructions }),
          updatedAt: at,
        });
        const routeLine = await loadRouteLine(plan.routeGeometryRef);
        await syncNavigationEngine(applied.state);
        const boundNavigation = controller.navigationState() ?? deriveSessionNavigation(applied.state, { now: now() });
        rerouteMessageAt = Date.parse(now());
        set({
          rerouteBusy: false,
          rerouteError: null,
          rerouteMessage: `${wholeRoute ? "Heading to the start" : detour === undefined ? "New route" : `Via ${detour.label}`} · ${formatDistance(plan.distanceMeters)} to go`,
        });
        refresh();
        // Show the rider the new line, then keep following them along it.
        requestRideFit(
          buildRideScene({
            routeId: boundNavigation.plan.route?.routeId ?? null,
            routeLine: routeLine ?? NO_COORDINATES,
            position: { coordinate: boundNavigation.position.coordinate, quality: boundNavigation.position.quality },
          }),
          get().follow,
        );
      },

      async continueFreeRide(): Promise<void> {
        excursion = null;
        const state = controller.snapshot();
        if (!running || state === null || state.activity !== "guided" || state.recordingId !== null) return;
        const at = now();
        const applied = await controller.dispatch(modeChangedEvent("free", at));
        if (applied.outcome !== "applied" || applied.state === null || applied.persistence !== "durable") {
          set({ freeRideError: applied.message ?? "Free Ride could not be resumed." });
          return;
        }
        pointer.write({
          sessionId: applied.state.sessionId,
          rideId: applied.state.plan.rideId,
          routeGeometryRef: null,
          updatedAt: at,
        });
        await loadRouteLine(null);
        await syncNavigationEngine(applied.state);
        set({ freeRideError: null, freeRideStatusMessage: "Free Ride resumed." });
        refresh();
      },

      async retryRecordingSave(): Promise<void> {
        if (!running || recording === undefined) return;
        const result = await recording.retry();
        if (result.outcome === "accepted") {
          set({ statusMessage: "The waiting GPS points are saved on this device.", lastError: null });
        } else {
          const message = "The GPS points are still waiting to be saved. Free device storage, then retry.";
          set({ statusMessage: message, lastError: message });
        }
        refresh();
      },

      reportStartError(message: string): void {
        set({ statusMessage: message, lastError: message });
      },

      stop(): void {
        if (!running) return;
        running = false;
        flushLiveTelemetry();
        detachPageListeners?.();
        detachPageListeners = null;
        if (timer !== null) {
          unschedule(timer);
          timer = null;
        }
        unsubscribeEnvironment?.();
        unsubscribeEnvironment = null;
        environment?.setRideActive(false);
        environment?.dispose();
        environment = null;
        unsubscribeMotion?.();
        unsubscribeMotion = null;
        motion?.dispose();
        motion = null;
        leanState = INITIAL_LEAN_TELEMETRY_STATE;
        lastGravity = null;
        rideActive = null;
        if (navigationEngine !== null) {
          void navigationEngine.stop();
          navigationEngine = null;
          navigationEngineKey = null;
        }
        suggestionAbort?.abort();
        suggestionAbort = null;
        clearRideOffer();
        offerRequested = false;
        offerAttention = EMPTY_RIDE_OFFER_ATTENTION;
        pendingReturnAbort?.abort();
        pendingReturnAbort = null;
        rerouteAbort?.abort();
        rerouteAbort = null;
        clearSnapBack();
      },

      async retryRecovery(): Promise<void> {
        if (!running) return;
        set({ status: "loading", statusMessage: null });
        await recover();
      },

      setMapReady(ready: boolean): void {
        if (get().mapReady === ready) return;
        set({ mapReady: ready });
        refresh();
      },

      onCameraChanged(): void {
        autoFollowArmed = false;
        // Every pan restarts the clock: the camera comes back 10 s after the
        // rider last touched it, while the ride is moving (DV-10).
        clearSnapBack();
        snapBackTimer = setTimeout(() => {
          snapBackTimer = null;
          const state = get();
          if (!running || !state.cameraHeld || state.navigation === null || !movingActivity(state.navigation)) return;
          state.recenter();
        }, SNAP_BACK_MS);
        if (!get().follow && get().cameraHeld) return;
        set({ follow: false, cameraHeld: true, rideCamera: null });
      },

      recenter(): void {
        const viewModel = get().viewModel;
        if (viewModel === null || !viewModel.controls.recenter.enabled) return;
        const position = viewModel.mapPosition;
        if (position === null) return;
        clearSnapBack();
        followedAt = null;
        lastCameraKey = null;
        set({
          follow: true,
          cameraToken: get().cameraToken + 1,
          cameraHeld: false,
          cameraExtent: recenterExtent(position.coordinate),
        });
        followRider(viewModel, true);
      },

      overview(): void {
        const state = get();
        const scene = buildRideScene({
          routeId: state.navigation?.plan.route?.routeId ?? null,
          routeLine: state.routeLine,
          position: {
            coordinate: state.viewModel?.mapPosition?.coordinate ?? null,
            quality: state.viewModel?.mapPosition?.quality ?? "unavailable",
          },
        });
        if (scene.routes.length === 0) return;
        clearSnapBack();
        lastCameraKey = null;
        set({
          follow: false,
          cameraToken: state.cameraToken + 1,
          cameraHeld: false,
          cameraExtent: sceneExtent(scene),
          rideCamera: null,
        });
      },

      setFollow(follow: boolean): void {
        if (follow) {
          get().recenter();
          return;
        }
        set({ follow: false });
      },

      async pause(): Promise<void> {
        if (!get().viewModel?.controls.pause.enabled) return;
        await dispatchCommand(sessionPausedEvent(now(), "rider"));
        flushLiveTelemetry();
      },

      async resume(): Promise<void> {
        if (!get().viewModel?.controls.resume.enabled) return;
        await dispatchCommand(sessionResumedEvent(now()));
      },

      beginStop(): void {
        const controls = get().viewModel?.controls;
        if (controls === undefined || (!controls.finish.enabled && !controls.discard.enabled)) return;
        set({ stopConfirm: true });
      },

      cancelStop(): void {
        set({ stopConfirm: false });
      },

      async finish(): Promise<void> {
        if (!get().viewModel?.controls.finish.enabled) return;
        set({ stopConfirm: false });
        if (get().navigation?.recordingId !== null && recording !== undefined) {
          const finished = await recording.finish(now());
          if (finished.outcome === "failed") {
            set({ lastError: finished.message, statusMessage: finished.message });
          } else if (finished.outcome !== "finished") {
            set({ lastError: null, statusMessage: finished.message });
          } else {
            set({ lastError: null, statusMessage: `Saved ${finished.summary.distanceMeters} m to My rides.` });
          }
          await syncNavigationEngine();
          refresh();
          return;
        }
        if (await dispatchCommand(sessionCompletedEvent(now()))) pointer.clear();
      },

      async discard(): Promise<void> {
        if (!get().viewModel?.controls.discard.enabled) return;
        set({ stopConfirm: false });
        if (get().navigation?.recordingId !== null && recording !== undefined) {
          const discarded = await recording.discard(now());
          if (discarded.outcome !== "discarded") {
            set({ lastError: "The recording could not be discarded.", statusMessage: "The recording could not be discarded." });
          }
          await syncNavigationEngine();
          refresh();
          return;
        }
        if (await dispatchCommand(sessionAbandonedEvent(now()))) pointer.clear();
      },

      async retryLocationPermission(): Promise<void> {
        await environment?.requestLocationPermission();
        // Restart the position source the ride already uses (the native
        // watcher in the app), never a second one (DV-05).
        if (navigationEngine?.retryPosition !== undefined) await navigationEngine.retryPosition();
        else await navigationEngine?.syncLifecycle();
        refresh();
      },

      async headToStart(): Promise<void> {
        farFromStartSettled = true;
        set({ farFromStart: null });
        await get().reroute(undefined, { wholeRoute: true });
      },

      dismissFarFromStart(): void {
        // Settled only once the rider reaches the line; until then nothing
        // re-plans on its own, and the question is not asked again.
        farFromStartDismissed = true;
        set({ farFromStart: null });
      },
    };
  });

  return store;
}

/** "1 h", "1.5 h", "45 min": a loop's length the way a rider says it. */
function loopLengthLabel(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${Number((minutes / 60).toFixed(1))} h`;
}
