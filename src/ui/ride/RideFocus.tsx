"use client";

/**
 * The Ride Focus surface (08-RIDE-NAVIGATION-AND-FREE-RIDE §2–§8, §13, §24;
 * 12-DESIGN-SYSTEM-RESPONSIVE-ACCESSIBILITY §3, §4, §10, §15–§17; DV-10).
 *
 * Built like Google Maps navigation, because the phone is mounted on a
 * motorcycle and a rider only glances at it (DV-10, the owner's #1 complaint):
 *
 * - **The map is full-bleed.** It fills the screen behind two overlays, and the
 *   follow camera turns it heading-up, tilted, zoomed for speed.
 * - **The top is one compact maneuver card**: a big arrow, a big distance, the
 *   road. A small warning badge appears on it only when the GPS fix is bad.
 * - **The bottom is one slim strip**: three instrument readouts (speed, miles
 *   left, time left by default; RIDE-INSTRUMENT-STRIP), the sheet toggle, and
 *   a single Exit. While moving, tapping a readout opens the sheet; while
 *   stopped or paused it opens the readout picker instead.
 * - **Everything else lives in the sheet**: Pause, Fuel ahead, reroutes, the
 *   map's places and layers controls, GPS details, progress, Stop, and the way
 *   back to the planner. Nothing was dropped; it is hidden until asked for. The
 *   sheet closes by itself after 8 s, and stays open while the ride is paused,
 *   ended, or asking whether to stop.
 * - **Only when needed**: the speed bubble (when the device reports a speed
 *   and no readout already shows it),
 *   Re-center (after the rider pans away; it also snaps back by itself), the
 *   "Head to the start" question (DV-07), and one alert chip.
 *
 * "Stable" still has its mechanical meaning: the overlays are anchored to the
 * viewport edges, and a new maneuver, warning or lost fix changes text inside a
 * fixed box rather than re-laying the screen out at 50 mph. Every control is at
 * least 56×56 CSS px (12 §10, asserted against `globals.css`), and each disabled
 * control states its reason.
 *
 * This component holds no controller, no store and no ports: it renders the
 * view model it is given and calls back (`ride-focus-store.ts` holds the camera,
 * recovery and freshness rules).
 */


import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";

import { buildRideScene } from "@/application/map/build-ride-scene";
import { asRouteCandidateId } from "@/domain/route/ids";
import { computeInsets, toRect, type MapInsets } from "@/application/map/insets";
import { formatDistance } from "@/application/planner/measurements";
import { RideOfferCard } from "@/ui/ride/RideOfferCard";
import { opportunityDirection, opportunityReasons } from "@/application/free-ride/opportunity";
import { isVoiceMuted, setVoiceMuted, subscribeVoiceMuted } from "@/application/ride-session/voice-mute";
import type { RideFocusManeuver } from "@/application/ride-session/ride-focus-view-model";
import type { PlacesSource } from "@/application/places";
import type { BasemapMode, MapHostFactory, MapLoadStatus } from "@/application/map/map-host";
import type { MapIntent } from "@/application/map/types";
import type {
  RideFocusStore,
  RideFocusStoreStatus,
} from "@/ui/stores/ride-focus-store";
import type { MapLayersSource } from "@/application/map-layers";
import type { RideInterestDiscoverSource } from "@/application/ride-interest";
import { LayeredMap } from "@/ui/layers/LayeredMap";
import { RidePlacesMap } from "@/ui/places/RidePlacesMap";
import { RideDetour } from "@/ui/ride/RideDetour";
import { RideInterestCard } from "@/ui/ride/RideInterestCard";
import { RideInterestPanel } from "@/ui/ride/RideInterestPanel";
import { useRideInterest } from "@/ui/ride/useRideInterest";
import { RideMetricPicker } from "@/ui/ride/RideMetricPicker";
import { RideMetricStrip } from "@/ui/ride/RideMetricStrip";
import { RIDE_METRIC_PRESETS, RIDE_METRIC_REGISTRY } from "@/application/ride-metrics/registry";
import type { StoreApi } from "zustand/vanilla";

export interface RideFocusProps {
  readonly store: StoreApi<RideFocusStore>;
  /** The renderer factory, supplied by the composition root (05 §2). */
  readonly mapHostFactory: MapHostFactory;
  readonly basemap?: BasemapMode;
  readonly assetBasePath?: string;
  /** Browser-side places port, supplied by the app composition root when enabled. */
  readonly placesSource?: PlacesSource;
  /** The rider's map layers (phase 8): fuel, incidents and alerts on the ride. */
  readonly mapLayersSource?: MapLayersSource;
  /** Wikimedia/Wikidata/OSM landmarks along the route (OGV#13), when wired in. */
  readonly discoverSource?: RideInterestDiscoverSource;
  /** Where "Back to the planner" goes; the surface never decides routing. */
  readonly exitHref?: string;
}

/** The recovery screen's copy, per state: what happened, and what to do. */
const RECOVERY_COPY: Readonly<Record<Exclude<RideFocusStoreStatus, "ready">, string>> = {
  loading: "Opening your ride…",
  absent: "There is no ride in progress. Start one from the planner.",
  unrecoverable: "This ride's journal could not be replayed, so it can't be resumed.",
  unavailable: "This ride's saved data couldn't be opened.",
};

const NO_INSETS: MapInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function rideSafeArea(): MapInsets {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string): number => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  return {
    top: read("--og-safe-top"),
    right: read("--og-safe-right"),
    bottom: read("--og-safe-bottom"),
    left: read("--og-safe-left"),
  };
}

function sameInsets(a: MapInsets, b: MapInsets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

/** A `ready` status never renders this screen, but the type has to say so. */
function recoveryCopy(status: RideFocusStoreStatus): string {
  return status === "ready" ? "" : RECOVERY_COPY[status];
}

const MANEUVER_GLYPH_PATHS: Readonly<Record<RideFocusManeuver["glyph"], string>> = {
  left: "M34 42V23c0-6-4-10-10-10H10m10-10L10 13l10 10",
  right: "M14 42V23c0-6 4-10 10-10h14M28 3l10 10-10 10",
  "slight-left": "M36 42V24c0-6-4-10-10-10h-7m8-8-8 8 8 8",
  "slight-right": "M12 42V24c0-6 4-10 10-10h7m-8-8 8 8-8 8",
  straight: "M24 42V7m-10 11L24 7l10 11",
  continue: "M24 42V7m-10 11L24 7l10 11",
  uturn: "M34 42V23c0-6-4-10-10-10s-10 4-10 10v19m-8-9 8 9 8-9",
  arrive: "M10 40V8m0 2h25l-6 8 6 8H10",
};

function ManeuverGlyph({ glyph }: { readonly glyph: RideFocusManeuver["glyph"] }) {
  return (
    <svg
      className="og-ride__maneuver-glyph"
      viewBox="0 0 48 48"
      aria-hidden="true"
      data-testid="ride-maneuver-glyph"
      data-glyph={glyph}
    >
      <path d={MANEUVER_GLYPH_PATHS[glyph]} />
    </svg>
  );
}

/** Loop lengths offered from Free Ride: short, a proper ride, an afternoon. */
const LOOP_LENGTHS = [60, 120, 180] as const;

/** The sheet closes by itself this long after the rider last touched it (DV-10). */
const SHEET_AUTO_CLOSE_MS = 8_000;

/** Phone landscape: the card and strip share a left column, the map the rest. */
const LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px)";

function isLandscapePhone(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(LANDSCAPE_QUERY).matches;
}

/** "31 mi" / "2,400 ft": how far the ride's start is, the way a rider says it. */
function farText(meters: number): string {
  return formatDistance(meters);
}

export function RideFocus({
  store,
  mapHostFactory,
  basemap = "empty",
  assetBasePath,
  placesSource,
  mapLayersSource,
  discoverSource,
  exitHref = "/",
}: RideFocusProps) {
  const status = useStore(store, (state) => state.status);
  const statusMessage = useStore(store, (state) => state.statusMessage);
  const lastError = useStore(store, (state) => state.lastError);
  const viewModel = useStore(store, (state) => state.viewModel);
  const navigation = useStore(store, (state) => state.navigation);
  const suggestions = useStore(store, (state) => state.suggestions);
  const liveSuggestion = useStore(store, (state) => state.liveSuggestion);
  const rideOffer = useStore(store, (state) => state.rideOffer);
  const rideOfferBusy = useStore(store, (state) => state.rideOfferBusy);
  const rideOffersAvailable = useStore(store, (state) => state.rideOffersAvailable);
  const liveSuggestionDistance = useStore(store, (state) => state.liveSuggestionDistanceMeters);
  const suggestionBusy = useStore(store, (state) => state.suggestionBusy);
  const returnBusy = useStore(store, (state) => state.returnBusy);
  const freeRideStatusMessage = useStore(store, (state) => state.freeRideStatusMessage);
  const freeRideError = useStore(store, (state) => state.freeRideError);
  const routeLine = useStore(store, (state) => state.routeLine);
  const routeLineAvailable = useStore(store, (state) => state.routeLineAvailable);
  const suggestionPreviewLine = useStore(store, (state) => state.suggestionPreviewLine);
  const mapReady = useStore(store, (state) => state.mapReady);
  const follow = useStore(store, (state) => state.follow);
  const cameraToken = useStore(store, (state) => state.cameraToken);
  const cameraExtent = useStore(store, (state) => state.cameraExtent);
  const cameraHeld = useStore(store, (state) => state.cameraHeld);
  const rideCamera = useStore(store, (state) => state.rideCamera);
  const voiceMuted = useSyncExternalStore(subscribeVoiceMuted, isVoiceMuted, () => false);
  const farFromStart = useStore(store, (state) => state.farFromStart);
  const stopConfirm = useStore(store, (state) => state.stopConfirm);
  const rerouteAvailable = useStore(store, (state) => state.rerouteAvailable);
  const rerouteBusy = useStore(store, (state) => state.rerouteBusy);
  const rerouteMessage = useStore(store, (state) => state.rerouteMessage);
  const rerouteError = useStore(store, (state) => state.rerouteError);
  const riderSettings = useStore(store, (state) => state.riderSettings);
  const surfaceReady = status === "ready" && viewModel !== null;
  const rootRef = useRef<HTMLElement | null>(null);
  const mapSlotRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLElement | null>(null);
  const stripRef = useRef<HTMLElement | null>(null);
  const [mapInsets, setMapInsets] = useState<MapInsets>(NO_INSETS);
  /** Free Ride's "Loop from here" is choosing how long (UX rework 2). */
  const [choosingLoop, setChoosingLoop] = useState(false);
  const [insetsReady, setInsetsReady] = useState(false);
  /** The rider opened the sheet (DV-10); some states hold it open by themselves. */
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Bumped by every touch inside the ride, so the auto-close clock restarts. */
  const [touchedAt, setTouchedAt] = useState(0);
  /** The readout slot whose picker is open (RIDE-INSTRUMENT-STRIP §2.2), or `null`. */
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  /** The last rider-made readout change, for the polite live region (§15). */
  const [metricAnnouncement, setMetricAnnouncement] = useState("");
  const slotButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const slotRef = useCallback((index: number) => (element: HTMLButtonElement | null): void => {
    slotButtons.current[index] = element;
  }, []);

  useEffect(() => {
    if (!surfaceReady) return;
    const measure = (): void => {
      const mapSlot = mapSlotRef.current;
      if (mapSlot === null) return;
      const top = topRef.current;
      const strip = stripRef.current;
      const safeArea = rideSafeArea();
      // The map's own pills sit under the card when the sheet shows them.
      if (top !== null) {
        rootRef.current?.style.setProperty("--og-ride-top-h", `${Math.round(top.getBoundingClientRect().bottom)}px`);
      }
      let measured: MapInsets;
      if (isLandscapePhone() && top !== null) {
        // The card and strip are a left column: the open map is to their right.
        const column = top.getBoundingClientRect();
        measured = {
          top: safeArea.top,
          right: safeArea.right,
          bottom: safeArea.bottom,
          left: Math.round(column.right),
        };
      } else {
        measured = computeInsets({
          viewport: { width: window.innerWidth, height: window.innerHeight },
          map: toRect(mapSlot.getBoundingClientRect()),
          dock: strip === null ? null : toRect(strip.getBoundingClientRect()),
          header: top === null ? null : toRect(top.getBoundingClientRect()),
          safeArea,
        });
      }
      setMapInsets((current) => sameInsets(current, measured) ? current : measured);
      setInsetsReady(true);
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    for (const element of [mapSlotRef.current, topRef.current, stripRef.current]) {
      if (element !== null) observer?.observe(element);
    }
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [surfaceReady]);

  const terminal = viewModel?.terminal ?? null;
  const recordingHud = viewModel?.recording ?? null;
  /**
   * States that keep the sheet open whatever the rider did: a ride that ended,
   * the stop question, a pause (the rider is stopped and wants Resume), and a
   * recording that could not be saved.
   */
  const sheetHeld =
    terminal !== null ||
    stopConfirm ||
    navigation?.activity === "paused" ||
    (recordingHud?.saveWarningText ?? null) !== null;
  const sheetVisible = sheetOpen || sheetHeld;

  // A hold the rider ends (Resume, Keep riding) leaves the sheet open for its
  // usual few seconds rather than snatching it from under their finger. A hold
  // that ends by itself — the brief "restored, paused" at the start of every
  // ride — does not: the ride opens on the map (owner, 2026-09-28: Free Ride
  // opened on a sheet over most of the screen).
  const wasHeld = useRef(sheetHeld);
  const touchedInHold = useRef(false);
  useEffect(() => {
    if (wasHeld.current && !sheetHeld && terminal === null && touchedInHold.current) {
      setSheetOpen(true);
      setTouchedAt(Date.now());
    }
    if (!sheetHeld) touchedInHold.current = false;
    wasHeld.current = sheetHeld;
  }, [sheetHeld, terminal]);
  const noteTouch = (): void => {
    if (sheetHeld) touchedInHold.current = true;
    if (sheetOpen) setTouchedAt(Date.now());
  };

  // The sheet closes itself once the rider stops touching it (DV-10): a mounted
  // phone must fall back to the map without a second tap.
  useEffect(() => {
    if (!sheetOpen || sheetHeld) return;
    const timer = window.setTimeout(() => setSheetOpen(false), SHEET_AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [sheetOpen, sheetHeld, touchedAt]);

  // §2.2: the picker exists only while the rider may customize. Starting to
  // move (or the ride ending) closes it during render, so it never paints at
  // speed and does not come back by itself at the next stop.
  const metricsCustomizable = viewModel?.metrics.customizable ?? false;
  if (pickerSlot !== null && (!metricsCustomizable || terminal !== null)) setPickerSlot(null);

  const availableRouteLine = routeLineAvailability(routeLineAvailable, routeLine);
  // OGV#13: only a guided ride's own route is worth prefetching landmarks,
  // fuel and events along — Free Ride has no fixed line to search a corridor
  // against, and re-keying on the route id (not the line) is what keeps a
  // route-line correction from re-triggering the one-shot prefetch.
  const guidedRouteId = navigation?.activity === "guided" ? navigation.plan.route?.routeId ?? null : null;
  const rideInterest = useRideInterest({
    discoverSource,
    mapLayersSource,
    placesSource,
    filter: riderSettings.uiPreferences.rideInterests,
    routeKey: guidedRouteId,
    routeLine: availableRouteLine,
    position: navigation?.position.coordinate ?? null,
  });

  const scene = useMemo(
    () => ({
      ...buildRideScene({
        routeId: navigation?.plan.route?.routeId ?? null,
        routeLine: availableRouteLine,
        suggestionPreview: rideOffer !== null ? {
          routeId: asRouteCandidateId(`offer:${rideOffer.id}`),
          routeLine: suggestionPreviewLine,
        } : liveSuggestion === null ? null : {
          routeId: liveSuggestion.route.routeId,
          routeLine: suggestionPreviewLine,
        },
        position: {
          coordinate: viewModel?.mapPosition?.coordinate ?? null,
          quality: viewModel?.mapPosition?.quality ?? "unavailable",
          // The arrow points where the heading-up camera looks: up the road.
          heading: rideCamera?.camera.bearing ?? null,
        },
      }),
      // Optional like the rest of `MapScene`: a ride with nothing to show
      // along it stays exactly the scene it was before OGV#13.
      ...(rideInterest.scenePlaces.length === 0 ? {} : { places: rideInterest.scenePlaces }),
    }),
    [availableRouteLine, liveSuggestion, navigation, rideCamera, rideInterest.scenePlaces, rideOffer, suggestionPreviewLine, viewModel],
  );

  const selectRideInterest = rideInterest.select;
  const onMapIntent = useCallback((intent: MapIntent): void => {
    if (intent.type === "camera-changed") store.getState().onCameraChanged();
    // OGV#13: a ride-interest pin rides the places source but is not a place;
    // route its tap to the ride's own card instead of the happy-hour one.
    if (intent.type === "place-click" && intent.placeId.startsWith("ri:")) selectRideInterest(intent.placeId);
  }, [selectRideInterest, store]);
  const followCamera = useMemo(
    () => (rideCamera === null || !insetsReady ? null : { key: `follow:${rideCamera.token}`, camera: rideCamera.camera }),
    [insetsReady, rideCamera],
  );
  const mapProps = {
    scene,
    onIntent: onMapIntent,
    hostFactory: mapHostFactory,
    basemap,
    ...(assetBasePath === undefined ? {} : { assetBasePath }),
    insets: mapInsets,
    // A `null` key while the rider holds the camera, or while the follow
    // camera owns it: nothing may snap a following map back to an overview.
    fitKey: cameraToken === 0 || !insetsReady || cameraHeld || rideCamera !== null ? null : `ride:${cameraToken}`,
    fitExtent: cameraExtent,
    followCamera,
    onLoadStatus: (statusUpdate: MapLoadStatus): void => {
      store.getState().setMapReady(statusUpdate.state === "ready");
    },
  };

  const map = (
    <div ref={mapSlotRef} className="og-ride__map" data-testid="ride-map-slot">
      {placesSource === undefined ? (
        <LayeredMap
          {...mapProps}
          layers={mapLayersSource === undefined ? undefined : { source: mapLayersSource }}
          label="Ride map with the route you are following and your current position"
          activeTool="pan"
          dimmed={false}
        />
      ) : (
        <RidePlacesMap
          {...mapProps}
          source={placesSource}
          layers={mapLayersSource === undefined ? undefined : { source: mapLayersSource }}
        />
      )}
    </div>
  );

  if (status !== "ready" || viewModel === null) {
    return (
      <main id="main" className="og-ride" data-testid="ride-focus" data-status={status}>
        <section className="og-ride__recovery" aria-labelledby="og-ride-recovery-title">
          <h1 id="og-ride-recovery-title" className="og-ride__title">
            Ride Focus
          </h1>
          <p className="og-ride__recovery-text" data-testid="ride-recovery" role="status">
            {statusMessage ?? recoveryCopy(status)}
          </p>
          <div className="og-ride__actions">
            {status === "loading" ? null : (
              <button
                type="button"
                className="og-ride__action"
                data-testid="ride-retry-recovery"
                onClick={(): void => {
                  void store.getState().retryRecovery();
                }}
              >
                Try again
              </button>
            )}
            <a className="og-ride__action og-ride__action--link" data-testid="ride-exit" href={exitHref}>
              Back to the planner
            </a>
          </div>
        </section>
      </main>
    );
  }

  const { guidance, position, progress, secondary, warnings, controls, recording, speedLimit } = viewModel;
  const critical = warnings.filter((warning) => warning.severity === "critical");
  const gpsUnavailable = critical.some((warning) => warning.id === "gps-unavailable");
  const sheetCritical = critical.filter((warning) => warning.id !== "gps-unavailable");
  // Free Ride has no route: no maneuver to wait for and no ETA or distance to
  // go, so those boxes stay off the screen instead of saying so (UX rework 2).
  const routeless = viewModel.activity === "free" || (navigation?.plan.route ?? null) === null;
  const caution = warnings.filter((warning) => warning.severity === "caution");
  // On the map, only what needs the rider now: a lost or blocked location is a
  // small badge on the card, other critical conditions one chip (DV-10).
  const alerts = critical.filter((warning) => warning.id !== "gps-unavailable");
  const alert = alerts[0] ?? null;
  const toast = rerouteError ?? rerouteMessage;
  const recenterShown = terminal === null && !follow && controls.recenter.enabled;
  const openSheet = (): void => {
    setSheetOpen(true);
    setTouchedAt(Date.now());
  };

  const metrics = viewModel.metrics;
  // The speed readout replaces the bubble; the posted-limit sign stays (§13.1).
  const speedShown = metrics.shownIds.includes("speed.current");
  const closePicker = (): void => {
    const slot = pickerSlot;
    setPickerSlot(null);
    if (slot !== null) slotButtons.current[slot]?.focus();
  };
  const toggleSheet = (): void => {
    if (sheetHeld) return;
    if (sheetOpen) setSheetOpen(false);
    else openSheet();
  };

  return (
    <main
      id="main"
      ref={rootRef}
      className="og-ride"
      data-testid="ride-focus"
      data-status={status}
      data-activity={viewModel.activity}
      data-gps={position.quality}
      data-follow={follow ? "true" : "false"}
      data-sheet={sheetVisible ? "open" : "closed"}
      onPointerDown={noteTouch}
      onKeyDown={noteTouch}
    >
      {map}

      {/*
        DV-10: the top is one compact maneuver card, where a glance lands. It is
        a fixed box the stream only rewrites; everything else is in the sheet.
      */}
      <header ref={topRef} className="og-ride__top">
        {terminal !== null || (routeless && guidance.kind === "waiting" && position.tone === "good") ? null : (
          <div
            className="og-ride__maneuver"
            data-testid="ride-maneuver"
            data-kind={guidance.kind}
            /*
              12 §17: a new maneuver and a suspended-guidance transition are the
              two things worth announcing; the 1 Hz stream is not a live region.
            */
            role={guidance.kind === "maneuver" || guidance.kind === "suspended" ? "status" : "presentation"}
            aria-live="polite"
          >
            {guidance.kind === "maneuver" ? (
              <>
                <ManeuverGlyph glyph={guidance.maneuver.glyph} />
                <p className="og-ride__maneuver-distance" data-testid="ride-maneuver-distance">
                  {guidance.maneuver.distanceText}
                </p>
                <p className="og-ride__maneuver-action">
                  {guidance.maneuver.actionText}
                  {guidance.maneuver.roadName === null ? null : (
                    <span className="og-ride__maneuver-road" data-testid="ride-maneuver-road">
                      {guidance.maneuver.roadPreposition === "onto" ? " onto " : " on "}
                      {guidance.maneuver.roadName}
                    </span>
                  )}
                </p>
              </>
            ) : (
              <p className="og-ride__maneuver-suspended" data-testid="ride-guidance-state">
                <span data-testid={gpsUnavailable ? "ride-warning-gps-unavailable" : undefined}>{guidance.text}</span>
              </p>
            )}
            {position.tone === "good" || terminal !== null ? null : (
              <button
                type="button"
                className="og-ride__gps-badge"
                data-testid="ride-gps-alert"
                data-tone={position.tone}
                aria-label={`${position.qualityLabel}. Show ride details`}
                title={position.qualityLabel}
                onClick={openSheet}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3 2 21h20L12 3Zm0 6v6m0 3v.5" />
                </svg>
              </button>
            )}
          </div>
        )}

        {farFromStart === null || terminal !== null ? null : (
          <div className="og-ride__card" data-testid="ride-far-from-start" role="alert">
            <p className="og-ride__card-text">
              You&apos;re {farText(farFromStart.meters)} from the start of this ride.
            </p>
            <div className="og-ride__actions">
              <button
                type="button"
                className="og-ride__action og-ride__action--primary"
                data-testid="ride-head-to-start"
                disabled={rerouteBusy}
                onClick={(): void => { void store.getState().headToStart(); }}
              >
                Head to the start
              </button>
              <button
                type="button"
                className="og-ride__action"
                data-testid="ride-far-dismiss"
                onClick={(): void => store.getState().dismissFarFromStart()}
              >
                I&apos;ll find it
              </button>
            </div>
          </div>
        )}

        {toast === null || terminal !== null ? null : (
          <p
            className="og-ride__toast"
            data-testid="ride-toast"
            data-tone={rerouteError !== null ? "error" : "info"}
            role="status"
          >
            {toast}
          </p>
        )}

        {alert === null || terminal !== null ? null : (
          <button
            type="button"
            className="og-ride__alert"
            data-testid="ride-alert"
            onClick={openSheet}
          >
            {alert.text}
            {alerts.length > 1 ? <span className="og-ride__alert-more"> +{alerts.length - 1}</span> : null}
          </button>
        )}
      </header>

      {/*
        COPILOT §5: one small card, one action. Doing nothing means no, so
        there is no "Later"; a critical alert outranks an optional road.
      */}
      {rideOffer === null || terminal !== null || alert !== null ? null : (
        <RideOfferCard
          key={rideOffer.id}
          summary={rideOffer.summary}
          shownAt={rideOffer.shownAt}
          lifetimeMs={rideOffer.lifetimeMs}
          onTake={(): void => { void store.getState().acceptRideOffer(); }}
          onSkip={(): void => store.getState().skipRideOffer()}
        />
      )}

      {liveSuggestion === null || rideOffer !== null || terminal !== null || alert !== null ? null : (
        <div className="og-ride__suggestion og-ride__floating-card" data-testid="free-ride-suggestion" role="status">
          <p className="og-ride__suggestion-head">
            <strong data-testid="free-ride-suggestion-label">{liveSuggestion.label}</strong>
            {" · "}
            <span data-testid="free-ride-suggestion-distance">
              {opportunityDirection(liveSuggestion.headingDeltaDegrees)} in{" "}
              {formatDistance(liveSuggestionDistance ?? liveSuggestion.distanceToDecisionMeters)}
            </span>
          </p>
          {(() => {
            const details = [...opportunityReasons(liveSuggestion)];
            if (liveSuggestion.durationSeconds !== undefined) {
              details.push(`${Math.max(1, Math.round(liveSuggestion.durationSeconds / 60))} min`);
            }
            return details.length === 0 ? null : (
              <p className="og-ride__suggestion-why" data-testid="free-ride-suggestion-why">{details.join(" · ")}</p>
            );
          })()}
          <button
            type="button"
            className="og-ride__action og-ride__action--primary og-ride__suggestion-take"
            data-testid="free-ride-accept-suggestion"
            onClick={(): void => { void store.getState().acceptLiveSuggestion(); }}
          >
            Take
          </button>
        </div>
      )}

      {/* OGV#13: a tapped ride-interest pin, wherever the rider tapped it from. */}
      {rideInterest.selectedPoint === null || terminal !== null ? null : (
        <RideInterestCard
          point={rideInterest.selectedPoint}
          onClose={rideInterest.clear}
          onAddStop={(point): void => {
            rideInterest.clear();
            void store.getState().reroute({ coordinate: point.coordinate, label: point.name });
          }}
        />
      )}

      {/*
        Only when needed: the device's speed, and Re-center after a pan (DV-10).
        On the right, a rail of round buttons like Google Maps: the whole route,
        and the voice on or off.
      */}
      <div className="og-ride__float">
        {terminal !== null || ((speedShown || position.speedText === null) && speedLimit === null) ? <span /> : (
          <div className="og-ride__speeds">
            {speedShown || position.speedText === null ? null : (
              <p
                className="og-ride__speed"
                data-testid="ride-speed-bubble"
                data-over={speedLimit?.over === true ? "true" : undefined}
              >
                <strong>{position.speedText.replace(/ mph$/, "")}</strong>
                <span>mph</span>
              </p>
            )}
            {speedLimit === null ? null : (
              <p
                className="og-ride__limit"
                data-testid="ride-speed-limit"
                aria-label={`Speed limit ${speedLimit.mph} miles per hour`}
              >
                <span aria-hidden="true">LIMIT</span>
                <strong aria-hidden="true">{speedLimit.mph}</strong>
              </p>
            )}
          </div>
        )}
        <div className="og-ride__float-end">
          {recenterShown ? (
            <button
              type="button"
              className="og-ride__recenter"
              data-testid="ride-recenter"
              onClick={(): void => store.getState().recenter()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 5 20l7-4 7 4-7-17Z" />
              </svg>
              Re-center
            </button>
          ) : null}
          {terminal !== null ? null : (
            <div className="og-ride__rail" role="group" aria-label="Map and voice">
              {routeless ? null : (
                <button
                  type="button"
                  className="og-ride__rail-button"
                  data-testid="ride-overview"
                  aria-label="Show the whole route"
                  title="Show the whole route"
                  onClick={(): void => store.getState().overview()}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="6" cy="18" r="2.2" />
                    <circle cx="18" cy="6" r="2.2" />
                    <path d="M8 17c5-1 3-6 8-9" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                className="og-ride__rail-button"
                data-testid="ride-mute"
                aria-label="Mute voice guidance"
                aria-pressed={voiceMuted}
                title={voiceMuted ? "Voice is off" : "Voice is on"}
                onClick={(): void => setVoiceMuted(!voiceMuted)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 9h4l5-4v14l-5-4H4z" />
                  {voiceMuted ? <path d="m17 9 5 6m0-6-5 6" /> : <path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12" />}
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      <section
        id="og-ride-sheet"
        className="og-ride__sheet"
        data-testid="ride-panel"
        aria-label="Ride controls"
        hidden={!sheetVisible}
      >
        {terminal === null ? null : (
          <div className="og-ride__terminal" data-testid="ride-terminal" role="status">
            <h2 className="og-ride__terminal-title">{terminal.title}</h2>
            <p className="og-ride__terminal-text">{terminal.text}</p>
            {terminal.reason !== "completed" || terminal.stats === undefined ? null : (
              <dl className="og-ride__summary" data-testid="ride-summary" aria-label="This ride">
                {terminal.stats.map((stat) => (
                  <div key={stat.id} className="og-ride__summary-stat" data-testid={`ride-summary-${stat.id}`}>
                    <dt>{stat.label}</dt>
                    <dd>
                      {stat.value}
                      {stat.unit === null ? null : <span className="og-ride__summary-unit"> {stat.unit}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        {/*
          `Stop ride` is two steps (8 §11): Finish / Discard / Keep riding, in
          place. A single mis-tap at speed must not end an unsaved ride.
        */}
        {terminal !== null || !stopConfirm ? null : (
          <div className="og-ride__confirm" data-testid="ride-stop-confirm">
            <p className="og-ride__confirm-text">End this ride?</p>
            <div className="og-ride__actions">
              <button
                type="button"
                className="og-ride__action og-ride__action--primary"
                data-testid="ride-finish"
                disabled={!controls.finish.enabled}
                title={controls.finish.reason ?? undefined}
                onClick={(): void => {
                  void store.getState().finish();
                }}
              >
                Finish ride
              </button>
              <button
                type="button"
                className="og-ride__action"
                data-testid="ride-discard"
                disabled={!controls.discard.enabled}
                title={controls.discard.reason ?? undefined}
                onClick={(): void => {
                  void store.getState().discard();
                }}
              >
                Discard ride
              </button>
              <button
                type="button"
                className="og-ride__action"
                data-testid="ride-keep-riding"
                onClick={(): void => store.getState().cancelStop()}
              >
                Keep riding
              </button>
            </div>
          </div>
        )}

        {recording === null ? null : (
          <section className="og-ride__recording" aria-label="Recording summary" data-testid="recording-hud">
            <div>
              <span>Moving</span>
              <strong data-testid="recording-timer">{recording.movingTimeText}</strong>
            </div>
            <div>
              <span>Distance</span>
              <strong data-testid="recording-distance">{recording.distanceText}</strong>
            </div>
            <div>
              <span>Current</span>
              <strong data-testid="recording-current-speed">{recording.currentSpeedText}</strong>
            </div>
            <div>
              <span>Average</span>
              <strong data-testid="recording-average-speed">{recording.averageSpeedText}</strong>
            </div>
            <p data-testid="recording-elapsed">{recording.elapsedTimeText} total</p>
            {recording.waitingForFix && terminal === null ? <p role="status">Waiting for the first GPS fix.</p> : null}
            {recording.saveWarningText === null ? null : (
              <div className="og-ride__recording-warning" role="alert" data-testid="recording-save-warning">
                <p>{recording.saveWarningText}</p>
                {recording.canRetrySave ? (
                  <button
                    type="button"
                    className="og-ride__action"
                    data-testid="recording-retry-save"
                    onClick={(): void => {
                      void store.getState().retryRecordingSave();
                    }}
                  >
                    Retry saving points
                  </button>
                ) : null}
              </div>
            )}
          </section>
        )}

        {terminal !== null ? null : navigation?.activity === "free" && navigation.recordingId === null ? (
          <section className="og-ride__free-ride" aria-label="Free Ride controls" data-testid="free-ride-controls">
            <div className="og-ride__free-ride-heading">
              <h2 className="og-visually-hidden">Free Ride</h2>
              <button
                type="button"
                className="og-ride__action"
                data-testid="free-ride-suggestions-toggle"
                aria-pressed={suggestions === "on"}
                onClick={(): void => { void store.getState().setSuggestions(suggestions !== "on"); }}
              >
                Suggestions {suggestions === "on" ? "on" : "off"}
              </button>
              {liveSuggestion === null && suggestions === "on" ? (
                <p className="og-ride__free-ride-copy" data-testid="free-ride-suggestion-state">
                  {suggestionBusy ? "Looking ahead…" : "Watching for a good road"}
                </p>
              ) : null}
            </div>
            {suggestions === "on" && rideOffersAvailable ? (
              <button
                type="button"
                className="og-ride__action"
                data-testid="ride-offer-request"
                disabled={rideOfferBusy || rideOffer !== null}
                onClick={(): void => store.getState().requestRideOffer()}
              >
                {rideOfferBusy ? "Finding a ride…" : "Offer me a ride"}
              </button>
            ) : null}
            <button
              type="button"
              className="og-ride__action og-ride__action--primary"
              data-testid="head-home"
              disabled={returnBusy}
              onClick={(): void => { void store.getState().headHome(); }}
            >
              {returnBusy ? "Planning return…" : "Head Home"}
            </button>
            {choosingLoop ? (
              <div className="og-ride__detour-actions" role="group" aria-label="Loop from here: how long?" data-testid="free-ride-loop-lengths">
                {LOOP_LENGTHS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className="og-ride__action og-ride__action--primary"
                    data-testid={`free-ride-loop-${minutes}`}
                    disabled={returnBusy}
                    onClick={(): void => {
                      setChoosingLoop(false);
                      void store.getState().loopFromHere(minutes);
                    }}
                  >
                    {minutes / 60} h loop
                  </button>
                ))}
                <button
                  type="button"
                  className="og-ride__action"
                  data-testid="free-ride-loop-cancel"
                  onClick={(): void => setChoosingLoop(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="og-ride__action"
                data-testid="free-ride-loop"
                disabled={returnBusy}
                onClick={(): void => setChoosingLoop(true)}
              >
                Loop from here
              </button>
            )}
            {/* The rarer ways back wait behind one tap (UX rework 2, #19). */}
            <details className="og-ride__more" data-testid="free-ride-more">
              <summary className="og-ride__action">More ways back</summary>
              <div className="og-ride__detour-actions">
                <button
                  type="button"
                  className="og-ride__action"
                  data-testid="free-ride-easier-way-back"
                  disabled={returnBusy}
                  onClick={(): void => { void store.getState().easierWayBack(); }}
                >
                  Easier way back
                </button>
                <button
                  type="button"
                  className="og-ride__action"
                  data-testid="free-ride-turn-around"
                  disabled={returnBusy}
                  onClick={(): void => { void store.getState().turnAround(); }}
                >
                  Turn around
                </button>
              </div>
            </details>
            {freeRideStatusMessage === null ? null : (
              <p className="og-ride__free-ride-copy" data-testid="free-ride-status" role="status">
                {freeRideStatusMessage}
              </p>
            )}
            {freeRideError === null ? null : (
              <p className="og-ride__error" data-testid="free-ride-error" role="alert">
                {freeRideError}
              </p>
            )}
          </section>
        ) : navigation?.activity === "guided" && navigation.recordingId === null && (suggestions === "on" || freeRideStatusMessage !== null) ? (
          <section className="og-ride__free-ride" aria-label="Free Ride controls" data-testid="free-ride-controls">
            {freeRideStatusMessage === null
              ? <p className="og-ride__free-ride-copy">Following a suggested route segment.</p>
              : <p className="og-ride__free-ride-copy" data-testid="free-ride-status" role="status">{freeRideStatusMessage}</p>}
            <button
              type="button"
              className="og-ride__action"
              data-testid="continue-free-ride"
              onClick={(): void => { void store.getState().continueFreeRide(); }}
            >
              Continue Free Ride
            </button>
            {freeRideError === null ? null : (
              <p className="og-ride__error" role="alert">{freeRideError}</p>
            )}
          </section>
        ) : null}

        {sheetCritical.length === 0 ? null : (
          <ul className="og-ride__warnings" data-testid="ride-warnings" role="alert">
            {sheetCritical.map((warning) => (
              <li key={warning.id} data-testid={`ride-warning-${warning.id}`} data-severity="critical">
                {warning.text}
              </li>
            ))}
          </ul>
        )}
        {caution.length === 0 ? null : (
          <ul className="og-ride__warnings" data-testid="ride-cautions">
            {caution.map((warning) => (
              <li key={warning.id} data-testid={`ride-warning-${warning.id}`} data-severity="caution">
                {warning.text}
              </li>
            ))}
          </ul>
        )}

        {terminal !== null || !rerouteAvailable || navigation?.activity !== "guided" ? null : (
          <RideDetour
            offRoute={navigation.offRouteState === "off-route"}
            busy={rerouteBusy}
            message={null}
            error={null}
            routeLine={routeLineAvailable ? routeLine : []}
            position={navigation.position.coordinate}
            fixGood={navigation.position.quality === "fresh-good"}
            source={mapLayersSource}
            onReroute={(detour): void => {
              void store.getState().reroute(detour);
            }}
            onEasierWayBack={(): void => {
              void store.getState().easierWayBack();
            }}
            onTurnAround={(): void => {
              void store.getState().turnAround();
            }}
          />
        )}

        {terminal !== null || navigation?.activity !== "guided" ? null : (
          <RideInterestPanel
            filter={riderSettings.uiPreferences.rideInterests}
            onSetFilter={(filter): void => store.getState().setRideInterestFilter(filter)}
            chip={rideInterest.chip}
            onOpenChip={(): void => {
              const point = rideInterest.chip?.point;
              if (point !== undefined) rideInterest.select(point.id);
            }}
          />
        )}

        {terminal !== null || stopConfirm ? null : (
          <div className="og-ride__actions" data-testid="ride-controls">
            {navigation?.activity === "paused" ? (
              <button
                type="button"
                className="og-ride__action og-ride__action--primary"
                data-testid="ride-resume"
                disabled={!controls.resume.enabled}
                title={controls.resume.reason ?? undefined}
                onClick={(): void => {
                  void store.getState().resume();
                }}
              >
                Resume
              </button>
            ) : (
              <button
                type="button"
                className="og-ride__action"
                data-testid="ride-pause"
                disabled={!controls.pause.enabled}
                title={controls.pause.reason ?? undefined}
                onClick={(): void => {
                  void store.getState().pause();
                }}
              >
                Pause
              </button>
            )}

            {/*
              8 §3: a blocked location keeps the session controllable. Retries
              also happen by themselves; this is the rider's "now".
            */}
            {position.tone === "good" ? null : (
              <button
                type="button"
                className="og-ride__action"
                data-testid="ride-retry-location"
                disabled={!controls.retryLocation.enabled}
                title={controls.retryLocation.reason ?? undefined}
                onClick={(): void => {
                  void store.getState().retryLocationPermission();
                }}
              >
                Retry location
              </button>
            )}

            <button
              type="button"
              className="og-ride__action og-ride__action--danger"
              data-testid="ride-stop"
              disabled={!controls.finish.enabled && !controls.discard.enabled}
              title={controls.finish.reason ?? controls.discard.reason ?? undefined}
              onClick={(): void => store.getState().beginStop()}
            >
              Stop ride
            </button>
          </div>
        )}

        {terminal !== null ? null : (
        <div className="og-ride__details">
          <div className="og-ride__identity">
            <p className="og-ride__activity" data-testid="ride-activity">
              {viewModel.activityLabel}
            </p>
            <p className="og-ride__gps" data-testid="ride-gps" data-tone={position.tone}>
              <span className="og-ride__gps-label">{gpsUnavailable ? "Waiting for location" : position.qualityLabel}</span>
              {position.ageText === null ? null : (
                <span className="og-ride__gps-age"> · {position.ageText}</span>
              )}
              {position.accuracyText === null ? null : (
                <span className="og-ride__gps-accuracy"> · {position.accuracyText}</span>
              )}
            </p>
          </div>
          <dl className="og-ride__telemetry">
            {routeless ? null : (
              <>
                <div>
                  <dt>ETA</dt>
                  <dd data-testid="ride-eta">{secondary.etaText}</dd>
                </div>
                <div>
                  <dt>Remaining</dt>
                  <dd data-testid="ride-remaining">{secondary.remainingText}</dd>
                </div>
              </>
            )}
            <div>
              <dt>Speed</dt>
              {/*
                8 §4: a speed the port withheld is absent, never the last known
                number. The em dash says "not current"; `0 mph` would be a lie.
              */}
              <dd data-testid="ride-speed">{position.speedText ?? "—"}</dd>
            </div>
            <div>
              <dt>Heading</dt>
              <dd data-testid="ride-heading">{position.headingText ?? "—"}</dd>
            </div>
          </dl>
          {routeless ? null : (
            <div className="og-ride__progress" data-testid="ride-progress">
              <div
                className="og-ride__progress-track"
                data-testid="ride-progress-track"
                data-known={progress.fraction === null ? "false" : "true"}
                aria-hidden="true"
              >
                <span
                  className="og-ride__progress-fill"
                  style={{ width: `${Math.round((progress.fraction ?? 0) * 100)}%` }}
                />
              </div>
              <p className="og-ride__progress-text" data-testid="ride-progress-text">
                {progress.fractionText}
              </p>
              {progress.stopsText === null || progress.stopsText === progress.fractionText ? null : (
                <p className="og-ride__progress-stops" data-testid="ride-progress-stops">
                  {progress.stopsText}
                </p>
              )}
            </div>
          )}
          <p className="og-ride__metrics-hint" data-testid="ride-metrics-hint">
            {metrics.customizable
              ? "Tap a readout below to change it."
              : "You can change the readouts when you're stopped."}
          </p>
          {routeLineAvailable || navigation?.plan.route === null ? null : (
            <p className="og-ride__progress-line" data-testid="ride-line-unavailable">
              The route line can&apos;t be drawn right now. The ride is unaffected.
            </p>
          )}
        </div>
        )}

        {statusMessage === null ? null : (
          <p className="og-ride__notice" data-testid="ride-status" role="status">
            {statusMessage}
          </p>
        )}
        {lastError === null ? null : (
          <p className="og-ride__error" data-testid="ride-error" role="alert">
            {lastError}
          </p>
        )}
        {terminal !== null || mapReady ? null : (
          <p className="og-ride__notice" data-testid="ride-map-unavailable">
            The map isn&apos;t loaded yet. The ride is unaffected.
          </p>
        )}

        <a className="og-ride__action og-ride__action--link" data-testid="ride-exit" href={exitHref}>
          Back to the planner
        </a>
      </section>

      {pickerSlot === null || terminal !== null ? null : (
        <RideMetricPicker
          model={metrics}
          slotIndex={pickerSlot}
          onChoose={(id): void => {
            const slot = pickerSlot;
            if (store.getState().setRideMetric(slot, id)) {
              setMetricAnnouncement(`Readout ${slot + 1} now shows ${RIDE_METRIC_REGISTRY[id].label}.`);
            }
            closePicker();
          }}
          onPreset={(id): void => {
            if (store.getState().applyRideMetricPreset(id)) {
              const preset = RIDE_METRIC_PRESETS.find((candidate) => candidate.id === id);
              setMetricAnnouncement(`Readouts set to ${preset?.label ?? "the preset"}.`);
            }
            closePicker();
          }}
          onClose={closePicker}
          onCalibrateLean={(): void => {
            store.getState().calibrateLean();
            setMetricAnnouncement("Lean calibrated to level.");
          }}
        />
      )}
      <p className="og-visually-hidden" role="status" data-testid="ride-metric-announcement">{metricAnnouncement}</p>

      {/*
        DV-10: the bottom is one slim strip — the three readouts, the sheet
        toggle and one Exit. Tapping a readout while moving opens the sheet.
      */}
      <footer ref={stripRef} className="og-ride__strip">
        {terminal !== null ? (
          <button
            type="button"
            className="og-ride__strip-summary"
            data-testid="ride-strip"
            aria-expanded={sheetVisible}
            aria-controls="og-ride-sheet"
            onClick={toggleSheet}
          >
            <span className="og-ride__strip-main">{terminal.title}</span>
            <span className="og-visually-hidden">{sheetVisible ? "Hide ride controls" : "Show ride controls"}</span>
          </button>
        ) : (
          <>
            <RideMetricStrip
              model={metrics}
              slotRef={slotRef}
              onShowControls={toggleSheet}
              onChooseSlot={(index): void => {
                // The picker takes the sheet's place unless a pause holds it.
                setSheetOpen(false);
                setPickerSlot(index);
              }}
            />
            <button
              type="button"
              className="og-ride-metrics__toggle"
              data-testid="ride-strip"
              data-held={sheetHeld ? "true" : undefined}
              aria-expanded={sheetVisible}
              aria-controls="og-ride-sheet"
              onClick={toggleSheet}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={sheetVisible ? "m6 9 6 6 6-6" : "m6 15 6-6 6 6"} />
              </svg>
              <span className="og-visually-hidden">{sheetVisible ? "Hide ride controls" : "Show ride controls"}</span>
            </button>
          </>
        )}
        {terminal !== null ? (
          <a className="og-ride__strip-end og-ride__strip-end--exit" data-testid="ride-strip-exit" href={exitHref} aria-label="Back to the planner">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </a>
        ) : (
          <button
            type="button"
            className="og-ride__strip-end"
            data-testid="ride-end"
            disabled={!controls.finish.enabled && !controls.discard.enabled}
            onClick={(): void => {
              store.getState().beginStop();
              setSheetOpen(true);
            }}
          >
            Exit
          </button>
        )}
      </footer>
    </main>
  );
}

/** An unavailable line is an empty list, never a straight line between ends. */
function routeLineAvailability(
  available: boolean,
  routeLine: readonly { readonly lon: number; readonly lat: number }[],
): readonly { readonly lon: number; readonly lat: number }[] {
  return available ? routeLine : [];
}
