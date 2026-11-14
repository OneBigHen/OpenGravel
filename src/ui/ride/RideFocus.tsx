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
 *   road, and under them one line for the surface coming up ("Gravel in 0.4
 *   mi") with a small swatch in the surface bar's colours. The line exists only
 *   when the planner measured the surface; a GPX ride or a reroute has none and
 *   shows nothing, never a guess. A small warning badge appears on the card only
 *   when the GPS fix is bad.
 * - **Two turns in quick succession get a "then" line** under the action,
 *   shown only when the next maneuver is known and within a mile (it is
 *   `aria-hidden`: one card reads one instruction). A roundabout carries its
 *   exit badge only when the engine stated the number.
 * - **The bottom is one slim strip**: three instrument readouts (speed, miles
 *   left, time left by default; RIDE-INSTRUMENT-STRIP) and the Menu button.
 *   While moving, tapping a readout opens the Menu; while stopped or paused it
 *   opens the readout picker instead. The strip holds numbers only, so a
 *   five-character reading still fits its slot at 320 px.
 * - **Everything else lives in the Menu, one grouped list, in this order**:
 *   Emergency (first, unchanged), Pause and End ride, Stops and fuel, Sound,
 *   Screen, More. Live location sharing and the GPS details are one row each
 *   under More, and nothing in the Menu is a form field until the rider opens
 *   one. Ending is two steps, and the question replaces the Menu's contents so
 *   no row under it reads as an answer. An idle Menu closes by itself after 8 s;
 *   it never closes under a result list, a stop question or a picker, and stays
 *   open while the ride is paused or ended.
 * - **Only when needed**: the speed bubble (when the device reports a speed
 *   and no readout already shows it),
 *   Re-center (after the rider pans away; it also snaps back by itself), the
 *   "Head to the start" question (DV-07), one alert chip, and one dismissible
 *   line under the sheet's rows when the screen may sleep.
 * - **The map rail is glove-sized and is the one control column**: on a phone
 *   exactly three 56 px buttons, from the top Recenter (pressed again it shows
 *   the whole route), Stops, Mute. No zoom and no compass on a phone: pinch
 *   zooms, and north-up is a Menu row. Tablet and desktop keep the compass and
 *   the two-halves zoom pill above them. Every target is 56 px with 12 px
 *   between them.
 * - **Music only when it works**: a connected Spotify account gets one 64 px
 *   now-playing row above the strip. Not connected means no row at all — set-up,
 *   a missing Premium account and every other outcome live in Settings, never on
 *   top of the rider's menu.
 * - **Night means night.** The chrome is already dark; the map follows it, with
 *   the dark basemap where the deployment has one and a dark scrim where it does
 *   not. On Auto the screen also follows the sun at the rider's own coordinate,
 *   and the sheet carries Day / Night / Auto so a switch at dusk is never stuck.
 * - **Where the rider is looking**: when the line is lost, the suspended card
 *   carries the recovery itself — how far off route the engine measured, then
 *   "Reroute now" and "Details", both 56 px — so one thumb fixes it without the
 *   sheet. The strip's sheet toggle doubles as the recording indicator (a dot,
 *   REC and the elapsed time), so "is it recording?" is answerable at a glance.
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


import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import Link from "next/link";
import { useStore } from "zustand";

import { buildRideScene } from "@/application/map/build-ride-scene";
import type { PlaceSearchPort } from "@/application/geocoding/place-search";
import { asRouteCandidateId } from "@/domain/route/ids";
import { computeInsets, toRect, type MapInsets } from "@/application/map/insets";
import { formatDistance } from "@/application/planner/measurements";
import {
  buildPlannedTrackGpx,
  downloadExport,
  exportFilename,
  rideExportTitle,
} from "@/application/export/gpx-export";
import { MapZoomControls } from "@/ui/map/MapControls";
import { RideOfferCard } from "@/ui/ride/RideOfferCard";
import { RideRouteSketch } from "@/ui/ride/RideRouteSketch";
import { RideCard } from "@/ui/ride/RideCard";
import { opportunityDirection, opportunityReasons } from "@/application/free-ride/opportunity";
import { headBackDirection } from "@/application/ride-session/head-back";
import { isVoiceMuted, setVoiceMuted, subscribeVoiceMuted } from "@/application/ride-session/voice-mute";
import type { RideFocusManeuver } from "@/application/ride-session/ride-focus-view-model";
import type { PlacesSource } from "@/application/places";
import type { Coordinate } from "@/domain/ride/types";
import type { BasemapMode, MapHost, MapHostFactory, MapLoadStatus } from "@/application/map/map-host";
import type { MapIntent } from "@/application/map/types";
import {
  applyAppearance,
  applyResolvedTheme,
  readAppearanceMode,
  rememberRiderPlace,
  setAppearanceMode,
  type AppearanceMode,
} from "@/ui/appearance/appearance";
import { useAppearanceMode, useResolvedTheme } from "@/ui/appearance/use-appearance";
import type {
  RideFocusStore,
  RideFocusStoreStatus,
} from "@/ui/stores/ride-focus-store";
import { METERS_PER_MILE, lineLengthMeters, type MapLayersSource } from "@/application/map-layers";
import type { RideInterestDiscoverSource } from "@/application/ride-interest";
import { AppBar } from "@/ui/nav/AppBar";
import { LayeredMap } from "@/ui/layers/LayeredMap";
import type { CameraView } from "@/ui/map/PlannerMap";
import { RidePlacesMap } from "@/ui/places/RidePlacesMap";
import { RideDetour } from "@/ui/ride/RideDetour";
import { RoadBlockedMenuRow, RoadBlockedOverlay, RoadBlockedRailButton, roadBlockedRailShown, useRoadBlocked } from "@/ui/ride/RoadBlocked";
import { RideStopSearch } from "@/ui/ride/RideStopSearch";
import { RideFuelLine } from "@/ui/ride/RideFuelLine";
import { RideInterestCard } from "@/ui/ride/RideInterestCard";
import { RideInterestPanel } from "@/ui/ride/RideInterestPanel";
import { useRideInterest } from "@/ui/ride/useRideInterest";
import { useNoSignalRide, type RidePackLookup } from "@/ui/ride/useNoSignalRide";
import { RideNoSignalChip, RideNoSignalRows } from "@/ui/ride/RideNoSignal";
import { RideMetricPicker } from "@/ui/ride/RideMetricPicker";
import { RouteOutline } from "./RouteOutline";
import { RideMetricStrip } from "@/ui/ride/RideMetricStrip";
import { RideMusicEntry } from "@/ui/ride/RideMusicEntry";
import { RideSafetyOverlay, RideSafetyPanel } from "@/ui/ride/RideSafetyPanel";
import { EmergencyCard } from "@/ui/safety/EmergencyCard";
import { readRoadsNear } from "@/application/safety/emergency-roads";
import type { RideSafety } from "@/application/safety/ride-safety";
import { RIDE_METRIC_PRESETS, RIDE_METRIC_REGISTRY } from "@/application/ride-metrics/registry";
import type { SpotifyPlayerPort } from "@/application/ride-session/ports/spotify-player";
import type { StoreApi } from "zustand/vanilla";
import { bearingTo } from "@/domain/breadcrumb/route";
import { haversine } from "@/domain/geometry/analysis";
import { RECORDING_STOP_ASK_MS, recordingRowCopy, stopFollowingHint } from "@/ui/ride/recording-row";


export interface RideFocusProps {
  readonly store: StoreApi<RideFocusStore>;
  /** Kept rides (R3-7): with no signal, says whether this line is one. */
  readonly ridePacks?: RidePackLookup;
  /** The renderer factory, supplied by the composition root (05 §2). */
  readonly mapHostFactory: MapHostFactory;
  readonly basemap?: BasemapMode;
  readonly assetBasePath?: string;
  /** Browser-side places port, supplied by the app composition root when enabled. */
  readonly placesSource?: PlacesSource;
  /** The rider's map layers (phase 8): fuel, incidents and alerts on the ride. */
  readonly mapLayersSource?: MapLayersSource;
  /**
   * The app's own place search, for "search along this ride": the same port the
   * planner uses, biased to the rider's position here. Absent where the
   * deployment has none, and then the stop search simply is not offered.
   */
  readonly placeSearch?: PlaceSearchPort;
  /**
   * The active bike's usable range in miles (its range before the reserve), or
   * `null`/absent when the garage has none: the ride's "next gas" line judges
   * the road against it and says nothing it cannot measure without it.
   */
  readonly usableRangeMiles?: number | null;
  /** Wikimedia/Wikidata/OSM landmarks along the route (OGV#13), when wired in. */
  readonly discoverSource?: RideInterestDiscoverSource;
  /** Optional native Spotify App Remote player; absent in browsers/PWAs. */
  readonly spotifyPlayer?: SpotifyPlayerPort;
  /** Live location sharing and crash detection; absent where not composed. */
  readonly safety?: RideSafety;
  /** Asks for motion access from the Share tap (iOS gates it on a gesture). */
  readonly requestMotion?: () => Promise<unknown>;
  /** Where "Back to the planner" goes; the surface never decides routing. */
  readonly exitHref?: string;
}

/** The recovery screen's copy, per state: what happened, and what to do. */
const RECOVERY_COPY: Readonly<Record<Exclude<RideFocusStoreStatus, "ready" | "absent">, string>> = {
  loading: "Starting your ride…",
  unrecoverable: "This ride's journal could not be replayed, so it can't be resumed.",
  unavailable: "This ride's saved data couldn't be opened.",
};

/**
 * No session at all is not a failure: nothing was being tracked, so there is
 * nothing to retry. The card says so and offers the one thing that starts one.
 */
const NO_RIDE_HEADLINE = "Ready to ride?";

const NO_INSETS: MapInsets = { top: 0, right: 0, bottom: 0, left: 0 };


/** The three display choices, in the rider's words. */
const DISPLAY_CHOICES: readonly { readonly mode: AppearanceMode; readonly label: string }[] = [
  { mode: "auto", label: "Auto" },
  { mode: "day", label: "Day" },
  { mode: "night", label: "Night" },
];

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

/** A `ready` or `absent` status never renders this screen, but the type has to say so. */
function recoveryCopy(status: RideFocusStoreStatus): string {
  return status === "ready" || status === "absent" ? "" : RECOVERY_COPY[status];
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
  // A ring with the exit spur leaving it: the decision a roundabout asks for.
  roundabout: "M22 18a11 11 0 1 0 0 22 11 11 0 0 0 0-22M29.6 20.4 40 10m-7 0h7v7",
  // A fork, with the branch the rider must take drawn long and arrowed.
  "keep-left": "M24 42V28L10 14m0 8v-8h8M24 28l10-6",
  "keep-right": "M24 42V28l14-14m0 8v-8h-8M24 28l-10-6",
};

function ManeuverGlyph({
  glyph,
  variant,
}: {
  readonly glyph: RideFocusManeuver["glyph"];
  /** `then` draws the small second-line glyph (24 px), `card` the big one. */
  readonly variant?: "card" | "then";
}) {
  return (
    <svg
      className={
        variant === "then"
          ? "og-ride__maneuver-glyph og-ride__maneuver-glyph--then"
          : "og-ride__maneuver-glyph"
      }
      viewBox="0 0 48 48"
      aria-hidden="true"
      data-testid={variant === "then" ? "ride-maneuver-then-glyph" : "ride-maneuver-glyph"}
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

/** Why "Reroute now" is unavailable: the store's own rule, said the same way. */
const REROUTE_FIX_REASON = "Rerouting needs a fresh, accurate GPS fix.";

/** Phone landscape: the card and strip share a left column, the map the rest. */
const LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px)";

function isLandscapePhone(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(LANDSCAPE_QUERY).matches;
}

/** "31 mi" / "2,400 ft": how far the ride's start is, the way a rider says it. */
function farText(meters: number): string {
  return formatDistance(meters);
}

/**
 * How fresh the emergency card's fix is, in the card itself. A position read
 * aloud to a dispatcher must not pass a 90-second-old fix off as the present.
 */
function positionAgeText(ageMs: number | null): string {
  if (ageMs === null || !Number.isFinite(ageMs)) return "Your position from this device's GPS.";
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds <= 1) return "Your position from this device's GPS, just now.";
  if (seconds < 60) return `Your position from this device's GPS, updated ${seconds} s ago.`;
  return `Your position from this device's GPS, updated ${Math.round(seconds / 60)} min ago.`;
}

export function RideFocus({
  store,
  mapHostFactory,
  basemap = "empty",
  assetBasePath,
  placesSource,
  mapLayersSource,
  placeSearch,
  discoverSource,
  spotifyPlayer,
  safety,
  requestMotion,
  exitHref = "/",
  usableRangeMiles = null,
  ridePacks,
}: RideFocusProps) {
  const status = useStore(store, (state) => state.status);
  const statusMessage = useStore(store, (state) => state.statusMessage);
  const lastError = useStore(store, (state) => state.lastError);
  const viewModel = useStore(store, (state) => state.viewModel);
  const navigation = useStore(store, (state) => state.navigation);
  const breadcrumbWaypoints = useStore(store, (state) => state.breadcrumbWaypoints);
  const recordedLine = useStore(store, (state) => state.recordedLine);
  const backtrackBusy = useStore(store, (state) => state.backtrackBusy);
  const suggestions = useStore(store, (state) => state.suggestions);
  const liveSuggestion = useStore(store, (state) => state.liveSuggestion);
  const rideOffer = useStore(store, (state) => state.rideOffer);
  const rideOfferBusy = useStore(store, (state) => state.rideOfferBusy);
  const rideOffersAvailable = useStore(store, (state) => state.rideOffersAvailable);
  const liveSuggestionDistance = useStore(store, (state) => state.liveSuggestionDistanceMeters);
  const returnBusy = useStore(store, (state) => state.returnBusy);
  const freeRideStatusMessage = useStore(store, (state) => state.freeRideStatusMessage);
  const freeRideError = useStore(store, (state) => state.freeRideError);
  const routeLine = useStore(store, (state) => state.routeLine);
  const surfaceRuns = useStore(store, (state) => state.surfaceRuns);
  const routeLineAvailable = useStore(store, (state) => state.routeLineAvailable);
  const suggestionPreviewLine = useStore(store, (state) => state.suggestionPreviewLine);
  const mapReady = useStore(store, (state) => state.mapReady);
  const follow = useStore(store, (state) => state.follow);
  const cameraToken = useStore(store, (state) => state.cameraToken);
  const cameraExtent = useStore(store, (state) => state.cameraExtent);
  const cameraHeld = useStore(store, (state) => state.cameraHeld);
  const rideCamera = useStore(store, (state) => state.rideCamera);
  const rideBearing = useStore(store, (state) => state.rideBearing);
  const northUp = useStore(store, (state) => state.northUp);
  const appearanceMode = useAppearanceMode();
  const theme = useResolvedTheme();
  /** The live renderer, so the rail's own zoom and compass drive the same map. */
  const hostRef = useRef<MapHost | null>(null);
  /** The map's own bearing and zoom, reported by the renderer (not guessed). */
  const [camera, setCamera] = useState<CameraView | null>(null);
  const voiceMuted = useSyncExternalStore(subscribeVoiceMuted, isVoiceMuted, () => false);
  const farFromStart = useStore(store, (state) => state.farFromStart);
  const stopConfirm = useStore(store, (state) => state.stopConfirm);
  const recordingToggleBusy = useStore(store, (state) => state.recordingToggleBusy);
  const recordingCleanupPending = useStore(store, (state) => state.recordingCleanupPending);
  const canSaveFreeRideSummary = useStore(store, (state) => state.canSaveFreeRideSummary);
  const savedSummaryRideId = useStore(store, (state) => state.savedSummaryRideId);
  const rideCard = useStore(store, (state) => state.rideCard);
  const rerouteAvailable = useStore(store, (state) => state.rerouteAvailable);
  const rerouteBusy = useStore(store, (state) => state.rerouteBusy);
  const rerouteMessage = useStore(store, (state) => state.rerouteMessage);
  const rerouteError = useStore(store, (state) => state.rerouteError);
  const newerVersionReady = useStore(store, (state) => state.newerVersionReady);
  const riderSettings = useStore(store, (state) => state.riderSettings);
  const surfaceReady = status === "ready" && viewModel !== null;
  const subscribeMusic = useCallback(
    (listener: () => void): (() => void) => spotifyPlayer?.subscribe(listener) ?? ((): void => undefined),
    [spotifyPlayer],
  );
  const musicConnected = useSyncExternalStore(
    subscribeMusic,
    () => spotifyPlayer?.snapshot().connection === "connected",
    () => false,
  );
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
  /** "Add a stop" is showing its list or its picker, so the sheet must wait. */
  const [stopFinderHold, setStopFinderHold] = useState(false);
  /** The finish card's GPX download failed, said in the card rather than swallowed. */
  const [exportError, setExportError] = useState<string | null>(null);
  /** The emergency card is open over the ride (HIKE-MODE-PLAN H4 §19). */
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const roadBlocked = useRoadBlocked(navigation?.position ?? null);
  /** The "your screen may sleep" line is one the rider can put away for the ride. */
  const [screenNoteDismissed, setScreenNoteDismissed] = useState(false);
  /** OG-18: the first press on a running Recording row asks before it deletes the track. */
  const [recordingStopAsk, setRecordingStopAsk] = useState(false);
  useEffect(() => {
    if (!recordingStopAsk) return undefined;
    const timer = window.setTimeout(() => setRecordingStopAsk(false), RECORDING_STOP_ASK_MS);
    return (): void => window.clearTimeout(timer);
  }, [recordingStopAsk]);

  // iPad/iPhone Safari keeps the on-screen keyboard (and a shrunken viewport)
  // alive when the planner's text box was focused as the ride opened, which left
  // the whole ride screen dead to taps (owner, 2026-10-05). Drop focus and reset
  // the scroll so the ride always opens on a clean, tappable viewport.
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
    window.scrollTo(0, 0);
  }, []);
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

  /*
    Auto follows the sky while a ride is open. The phone's light/dark setting is
    a guess about the room the rider is in; the ride knows where they are, so
    dusk is a fact rather than a schedule. Day and Night stay the rider's own
    choice, and the phone's setting comes back when the ride closes: this is a
    display for now, not a stored preference.

    The fact comes from the store (`sunlight`, derived from its own clock and the
    latest fix), so the screen follows the sun without a second timer and the
    map can open in the right look instead of turning a moment later.
  */
  const sunlight = useStore(store, (state) => state.sunlight);
  const mapTheme = appearanceMode === "auto" ? sunlight ?? theme : theme;
  useEffect(() => {
    // The ride's fix is the rider's place for the rest of the app's Auto too.
    const fix = store.getState().navigation?.position.coordinate ?? null;
    if (fix !== null) rememberRiderPlace(fix);
    if (appearanceMode !== "auto" || sunlight === null) return;
    applyResolvedTheme(sunlight);
  }, [appearanceMode, store, sunlight]);
  // Leaving the ride hands Auto back to the sun at the rider's place.
  useEffect(() => () => {
    if (readAppearanceMode() === "auto") applyAppearance("auto");
  }, []);

  const terminal = viewModel?.terminal ?? null;
  const recordingHud = viewModel?.recording ?? null;
  /**
   * The finish card's sketch is described with the summary's own distance, so
   * the picture and the numbers say the same thing. A ride too short to sum up
   * has no distance stat and the sketch simply says less.
   */
  const summaryDistance =
    terminal?.reason === "completed" ? terminal.stats?.find((stat) => stat.id === "distance") ?? null : null;
  const summaryDistanceText =
    summaryDistance === null
      ? null
      : summaryDistance.unit === null
        ? summaryDistance.value
        : `${summaryDistance.value} ${summaryDistance.unit}`;
  /**
   * States that keep the sheet open whatever the rider did: a ride that ended,
   * the stop question, a pause (the rider is stopped and wants Resume), a
   * recording that could not be saved, a list or a picker the rider is choosing
   * from — a rider reading station names must not lose the list mid-decision.
   * (The readout picker is never behind the sheet: it takes the sheet's place,
   * so no auto-close is running while it shows.)
   */
  const sheetHeld =
    terminal !== null ||
    stopConfirm ||
    navigation?.activity === "paused" ||
    stopFinderHold ||
    choosingLoop ||
    (recordingHud?.saveWarningText ?? null) !== null;
  const sheetVisible = sheetOpen || sheetHeld;
  /**
   * The end question takes the sheet's place: a row left under it would read as
   * an answer to it, and the answers are Save, Discard and Keep riding.
   */
  const confirmAsking = stopConfirm && terminal === null;

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
  /** Stable, so the detour block reports its own state without re-rendering loops. */
  const holdSheetForStopFinder = useCallback((held: boolean): void => setStopFinderHold(held), []);

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
  const noSignalRide = useNoSignalRide(store, availableRouteLine, ridePacks);
  // OGV#13: only a guided ride's own route is worth prefetching landmarks,
  // fuel and events along — Free Ride has no fixed line to search a corridor
  // against, and re-keying on the route id (not the line) is what keeps a
  // route-line correction from re-triggering the one-shot prefetch.
  const guidedRouteId = navigation?.activity === "guided" ? navigation.plan.route?.routeId ?? null : null;
  /**
    The nearest road for the emergency card, asked only when the card opens.
    The ride map holds no road features of its own, so this is the one optional
    read on an otherwise offline card: offline, it says "unknown" and the
    coordinates, altitude, 911 and sharing still work.
  */
  const emergencyRoadRequest = useMemo(
    () =>
      mapLayersSource === undefined
        ? undefined
        : (point: Coordinate, signal: AbortSignal) => readRoadsNear(mapLayersSource, point, signal),
    [mapLayersSource],
  );

  const rideInterest = useRideInterest({
    discoverSource,
    mapLayersSource,
    placesSource,
    filter: riderSettings.uiPreferences.rideInterests,
    routeKey: guidedRouteId,
    routeLine: availableRouteLine,
    position: navigation?.position.coordinate ?? null,
  });

  // The engine's own progress answer, and only while it holds the rider on the
  // line: an off-route, rejoining or not-yet-decided match projects onto a line
  // the rider is not on, so the map must not paint a split it cannot stand
  // behind (08 §5). A null fraction (no telemetry, or a stale fix the view model
  // has already dropped) leaves the whole line ahead.
  const onRoute = navigation?.offRouteState === "on-route";
  const progressFraction = onRoute ? viewModel?.progress.fraction ?? null : null;

  /*
    How far along the line the rider is, in miles, for the "next gas" range.
    It is the engine's own progress fraction measured against the line the
    surface draws, so it is the same answer the progress bar shows; with no
    fraction (off the line, or no telemetry yet) there is no measurement and the
    fuel line states the next station without a range verdict.
  */
  const alongMiles = useMemo(() => {
    if (progressFraction === null || availableRouteLine.length < 2) return null;
    const meters = lineLengthMeters(availableRouteLine.map((point) => [point.lon, point.lat] as const));
    return (progressFraction * meters) / METERS_PER_MILE;
  }, [availableRouteLine, progressFraction]);

  const scene = useMemo(
    () => {
      const projected = buildRideScene({
        routeId: navigation?.plan.route?.routeId ?? (breadcrumbWaypoints !== null && (navigation?.activity === "track" || navigation?.resumeActivity === "track") ? asRouteCandidateId("route_breadcrumb") : null),
        routeLine: availableRouteLine,
        surfaceRuns,
        progressFraction,
        onRoute,
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
          // Up the road, not up the screen: the bearing is the direction of
          // travel, so a north-up map turns the view without turning the arrow.
          heading: rideBearing,
        },
      });
      return {
      ...projected,
      routes: breadcrumbWaypoints === null || recordedLine.length < 2 || navigation?.recordingId === null ? projected.routes : [...projected.routes, { id: asRouteCandidateId("route_recording"), role: null, geometry: recordedLine, state: "travelled" as const }],
      // Optional like the rest of `MapScene`: a ride with nothing to show
      // along it stays exactly the scene it was before OGV#13.
      ...(rideInterest.scenePlaces.length === 0 ? {} : { places: rideInterest.scenePlaces }),
    }; },
    [availableRouteLine, breadcrumbWaypoints, liveSuggestion, navigation, onRoute, progressFraction, recordedLine, rideBearing, rideInterest.scenePlaces, rideOffer, suggestionPreviewLine, surfaceRuns, viewModel],
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
  /** The renderer's handle, kept so the rail moves this map and no other. */
  const onHost = useCallback((host: MapHost | null): void => {
    hostRef.current = host;
    if (host === null) setCamera(null);
  }, []);
  const onCamera = useCallback((next: CameraView): void => {
    setCamera((previous) =>
      previous !== null &&
      previous.bearing === next.bearing &&
      previous.zoom === next.zoom &&
      previous.minZoom === next.minZoom &&
      previous.maxZoom === next.maxZoom
        ? previous
        : next,
    );
  }, []);
  /*
    The rail's own zoom and compass. They go through the same `MapHost` port as
    the planner's column: one press is one step, and the store remembers the
    level so the follow camera does not put the speed zoom straight back.
  */
  /**
   * One press, one step. While the map is following, the ride camera is its one
   * owner: the press holds the level in the store and the follow frame is issued
   * at it, so a gloved rider keeps following the road after zooming. A map the
   * rider has panned has no follow frame to re-issue, so the press goes to the
   * renderer through the same `zoomBy` call the planner's column uses.
   */
  const pressZoom = useCallback((delta: 1 | -1): void => {
    const current = camera;
    if (current === null) {
      hostRef.current?.zoomBy?.(delta);
      return;
    }
    const next = Math.min(current.maxZoom, Math.max(current.minZoom, current.zoom + delta));
    if (next === current.zoom) return;
    if (follow) {
      store.getState().zoomTo(next);
      return;
    }
    hostRef.current?.zoomBy?.(delta);
  }, [camera, follow, store]);
  /** The compass shows while the map is turned, or north-up (so it can turn back). */
  const compassShown = northUp || (camera !== null && Math.abs(((camera.bearing + 540) % 360) - 180) > 1.5);
  const mapProps = {
    scene,
    onIntent: onMapIntent,
    hostFactory: mapHostFactory,
    basemap,
    ...(assetBasePath === undefined ? {} : { assetBasePath }),
    // The map turns dark with the screen: Night contrast where the deployment
    // has a dark style, the scrim over its basemap where it does not.
    forcedLook: mapTheme === "night" ? ("night" as const) : ("map" as const),
    onHost,
    onCamera,
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
      {mapReady ? null : <RouteOutline line={availableRouteLine} />}
    </div>
  );

  /*
    Nothing is running. That is an ordinary state, not an error (the old
    screen offered a dead "Try again" on a blank page with no tab bar, so a
    rider who opened /ride was stranded). It keeps the app's
    frame — the shared bar, which is the bottom tab bar on a phone — and the
    same invitation card the My rides library opens with: a headline, Plan a
    ride and Find a ride. Ride mode below drops all of it.
  */
  if (status === "absent") {
    return (
      <main id="main" className="og-ride og-ride--state" data-testid="ride-focus" data-status={status}>
        <AppBar current="" />
        <section className="og-ride__empty og-empty-state" aria-labelledby="og-ride-empty-title">
          <div className="og-empty-state__body">
            <h1 id="og-ride-empty-title" data-testid="ride-recovery">
              {NO_RIDE_HEADLINE}
            </h1>
            {statusMessage === null ? null : (
              <p className="og-ride__empty-note" data-testid="ride-empty-note" role="status">
                {statusMessage}
              </p>
            )}
            <div className="og-empty-state__actions">
              {/*
                Only Plan a ride. Free Ride and Record start a session through
                the planner's own handoff (its ride document store, session
                controller and bootstrap pointer, composed in PlannerClient),
                which this surface does not own — so offering them here would
                duplicate that logic instead of reusing it. They are one tap
                away on the planner this card leads to.
              */}
              <Link className="og-primary" href={exitHref} data-testid="ride-plan-ride">
                Plan a ride
              </Link>
              <Link className="og-secondary" href="/explore">
                Find a ride
              </Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  /*
    Start never shows a title page (round 3, restructure call 8). While the
    ride opens, the screen is already the ride: the maneuver card and the
    metric strip in their places, the map filling in behind. The way back to
    the planner appears only if opening fails.
  */
  if (status === "loading" || (status === "ready" && viewModel === null)) {
    return (
      <main id="main" className="og-ride" data-testid="ride-focus" data-status="loading">
        <div className="og-ride__map" data-testid="ride-map-slot" />
        <header className="og-ride__top">
          <div className="og-ride__maneuver" data-testid="ride-maneuver" role="status" aria-live="polite">
            <p className="og-ride__maneuver-action" data-testid="ride-recovery">
              {statusMessage ?? "Starting your ride…"}
            </p>
          </div>
        </header>
        <footer className="og-ride__strip" data-testid="ride-strip-bar">
          <div className="og-ride-metrics" role="group" aria-label="Ride readouts">
            {["Speed", "Dist left", "Arrive"].map((caption) => (
              <span key={caption} className="og-ride-metrics__slot">
                <span className="og-ride-metrics__reading" aria-hidden="true">
                  <span className="og-ride-metrics__value">—</span>
                </span>
                <span className="og-ride-metrics__caption">{caption}</span>
              </span>
            ))}
          </div>
        </footer>
      </main>
    );
  }

  // A ride that could not be opened: retrying is meaningful here, and the exit
  // stays reachable while the tab bar does.
  if (status !== "ready" || viewModel === null) {
    return (
      <main id="main" className="og-ride og-ride--state" data-testid="ride-focus" data-status={status}>
        <AppBar current="" />
        <section className="og-ride__recovery" aria-labelledby="og-ride-recovery-title">
          <h1 id="og-ride-recovery-title" className="og-ride__title">
            Your ride didn&apos;t open
          </h1>
          <p className="og-ride__recovery-text" data-testid="ride-recovery" role="status">
            {statusMessage ?? recoveryCopy(status)}
          </p>
          <div className="og-ride__actions">
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
            <a className="og-ride__action og-ride__action--link" data-testid="ride-exit" href={exitHref}>
              Back to the planner
            </a>
          </div>
        </section>
      </main>
    );
  }

  const { guidance, position, progress, secondary, warnings, controls, recording, speedLimit, surfaceAhead } = viewModel;
  const followingBreadcrumb = breadcrumbWaypoints !== null && (navigation?.activity === "track" || navigation?.resumeActivity === "track");
  const breadcrumbPosition = navigation?.position.quality === "fresh-good" || navigation?.position.quality === "fresh-poor" ? navigation.position.coordinate : null;
  const breadcrumbAlong = progress.fraction === null || breadcrumbWaypoints === null ? 0 : progress.fraction * (breadcrumbWaypoints.at(-1)?.distanceAlongMeters ?? 0);
  const nextBreadcrumb = breadcrumbWaypoints === null ? null : breadcrumbWaypoints.find((point, index) => index > 0 && point.distanceAlongMeters > breadcrumbAlong + 15) ?? breadcrumbWaypoints.at(-1) ?? null;
  const critical = warnings.filter((warning) => warning.severity === "critical");
  const gpsUnavailable = critical.some((warning) => warning.id === "gps-unavailable");
  // A blocked location keeps its Retry row even while an older fix still reads
  // as good: the rider has been told location is blocked, so "try again" is
  // always one press away rather than waiting for the fix to age out.
  const locationBlocked = critical.some((warning) => warning.id === "location-denied");
  const sheetCritical = critical.filter((warning) => warning.id !== "gps-unavailable");
  // Free Ride has no route: no maneuver to wait for and no ETA or distance to
  // go, so those boxes stay off the screen instead of saying so (UX rework 2).
  const routeless = !followingBreadcrumb && (viewModel.activity === "free" || (navigation?.plan.route ?? null) === null);
  const caution = warnings.filter(
    (warning) => warning.severity === "caution" && warning.id !== "wake-lock",
  );
  /**
   * The screen may sleep. It is one short line under the sheet's rows, not a box
   * between them, and the rider can put it away: nothing they can do about it
   * needs to stay on screen. The view model's full sentence stays on the row's
   * title, so the reason is still there to read.
   */
  const wakeNote = warnings.find((warning) => warning.id === "wake-lock") ?? null;
  // On the map, only what needs the rider now: a lost or blocked location is a
  // small badge on the card, other critical conditions one chip (DV-10).
  const alerts = critical.filter((warning) => warning.id !== "gps-unavailable");
  const alert = alerts[0] ?? null;
  const toast = rerouteError ?? rerouteMessage;
  const musicShown = musicConnected && terminal === null;
  const recenterShown = terminal === null && !follow && controls.recenter.enabled;
  const openSheet = (): void => {
    setSheetOpen(true);
    setTouchedAt(Date.now());
  };
  /**
   * North up, from the compass (tablet, desktop) or the Menu's Screen group
   * (phones): the follow camera is re-issued, and a map the rider has panned has
   * no follow frame to turn, so the press is carried out on the map they are
   * looking at.
   */
  const toggleNorthUp = (): void => {
    const next = !northUp;
    store.getState().setNorthUp(next);
    if (next && !follow) hostRef.current?.faceNorth?.();
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
  /**
   * The finish card's one export: the line this ride was ridden on, as a GPX
   * track a device can open. The surface holds the line and nothing else about
   * the ride's storage, so that is what it exports — and it says so if the file
   * cannot be made rather than leaving a dead button.
   */
  const exportRideGpx = (): void => {
    // The line ridden when the ride recorded one (the card's own line), else the
    // plan's. A card cannot export a line it is not showing.
    const line = recordedLine.length >= 2 ? recordedLine : availableRouteLine;
    if (line.length < 2) return;
    try {
      const title = rideExportTitle(null);
      downloadExport(
        new TextEncoder().encode(buildPlannedTrackGpx({
          title,
          geometry: line,
          createdTime: navigation?.endedAt ?? null,
        })),
        exportFilename(title, "planned-track"),
      );
      setExportError(null);
    } catch {
      setExportError("Could not make the GPX file. The ride is unaffected.");
    }
  };

  /*
    DV-10: while the rider is off the line the recovery sits on the card they
    are already looking at, so it is one thumb away without the sheet. The
    button calls the store's own reroute — the same action the automatic
    reroute uses, with the same freshness rule and cooldown — so it is an
    override, never a second loop.
  */
  const offRouteActionsShown =
    terminal === null &&
    guidance.kind === "suspended" &&
    guidance.reason === "off-route" &&
    rerouteAvailable;
  const rerouteFixGood = position.quality === "fresh-good";
  // Which way the route is, from the rider's own heading (never guessed: with no
  // heading the card says where, not left or right).
  const offRouteHere = terminal === null && guidance.kind === "suspended" && guidance.reason === "off-route";
  const headBack =
    offRouteHere && navigation?.position.coordinate != null
      ? headBackDirection(availableRouteLine, navigation.position.coordinate, navigation.position.headingDegrees)
      : null;
  // The reroute's own status lives inside the card as one small line (never a pill).
  const cardNote = rerouteError ?? rerouteMessage;
  const headBackRoad = navigation?.instruction?.roadName ?? null;
  const headBackText =
    headBack?.glyph === "uturn"
      ? "Turn around"
      : headBackRoad === null
        ? "Head back to the route"
        : `Head back to ${headBackRoad}`;

  /*
    Is it recording? Every ride records from Start now (R3-2), so a guided
    ride's strip says nothing about it: the Menu row does, and the line would
    cost 20 px of map on every ride. In Record mode — where recording is the
    ride's own mode, and a rider asked for it — the strip keeps its one small
    red dot and the word "Recording". Nothing pulses and nothing counts up
    beside it: the moving time is already one of the readings.
  */
  const recordingIndicator =
    terminal === null &&
    navigation?.activity === "free" &&
    (navigation.recordingId ?? null) !== null
      ? recording
      : null;

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
      data-music={musicShown ? "true" : undefined}
      /* The strip grows one 20 px line while a recording runs; its own height
         and everything stacked above it read that state from this attribute. */
      data-recording={recordingIndicator === null ? undefined : "true"}
      onPointerDown={noteTouch}
      onKeyDown={noteTouch}
      onClick={noteTouch}
    >
      {map}

      {/*
        DV-10: the top is one compact maneuver card, where a glance lands. It is
        a fixed box the stream only rewrites; everything else is in the sheet.
      */}
      <header ref={topRef} className="og-ride__top">
        {terminal !== null ? null : followingBreadcrumb ? (
          <div className="og-ride__maneuver" data-testid="breadcrumb-guidance" role="status" aria-live="polite">
            {breadcrumbPosition === null || nextBreadcrumb === null ? <p className="og-ride__maneuver-action">Waiting for location</p> : <>
              <p className="og-ride__maneuver-distance">{formatDistance(haversine(breadcrumbPosition, nextBreadcrumb.coordinate))}</p>
              <p className="og-ride__maneuver-action">{Math.round(bearingTo(breadcrumbPosition, nextBreadcrumb.coordinate)) % 360}° to {nextBreadcrumb.name || "next waypoint"}</p>
              {navigation?.offRouteState === "off-route" || navigation?.offRouteState === "rejoining" ? <p className="og-ride__off-route-distance" data-testid="breadcrumb-off-line">Off the line · return to the route</p> : null}
            </>}
          </div>
        ) : (routeless && guidance.kind === "waiting" && position.tone === "good") ? null : (
          <div
            className="og-ride__maneuver"
            data-testid="ride-maneuver"
            data-kind={guidance.kind}
            data-reason={guidance.kind === "suspended" ? guidance.reason : undefined}
            data-compact={guidance.kind === "suspended" ? "true" : undefined}
            /*
              The card only reserves the extra row when there really is a
              second maneuver inside a mile, so it never grows for a guess
              ("then" would otherwise be permanent clutter).
            */
            data-then={
              guidance.kind === "maneuver" && guidance.maneuver.then !== null ? "true" : "false"
            }
            /*
              12 §17: a new maneuver and a suspended-guidance transition are the
              two things worth announcing; the 1 Hz stream is not a live region.
            */
            role={guidance.kind === "maneuver" || guidance.kind === "suspended" ? "status" : "presentation"}
            aria-live="polite"
          >
            {guidance.kind === "maneuver" ? (
              <>
                <span className="og-ride__maneuver-symbol">
                  <ManeuverGlyph glyph={guidance.maneuver.glyph} />
                  {/*
                    A provider-stated roundabout exit, and only that: with no
                    number there is no badge, never a guessed "1st".
                  */}
                  {guidance.maneuver.exitNumber === null ? null : (
                    <span
                      className="og-ride__maneuver-exit"
                      data-testid="ride-maneuver-exit"
                      aria-hidden="true"
                    >
                      {guidance.maneuver.exitNumber}
                    </span>
                  )}
                </span>
                {/* The distance and the road share the card's first row; a long
                    road name wraps under the distance rather than being cut. */}
                <div className="og-ride__maneuver-turn">
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
                </div>
                {/*
                  The surface coming up, the card's second row: one line and a
                  small swatch in the surface bar's colours. Only when the plan
                  measured it (the view model decides; a GPX ride or a reroute
                  has none and this row is absent, never a guess). Display-only
                  like the "then" line, so the 1 Hz card does not read it out.
                */}
                {surfaceAhead === null ? null : (
                  <p
                    className="og-ride__maneuver-surface"
                    data-testid="ride-surface-ahead"
                    data-surface={surfaceAhead.kind}
                    aria-hidden="true"
                  >
                    <span className="og-ride__surface-swatch" data-testid="ride-surface-swatch" data-surface={surfaceAhead.kind} />
                    {surfaceAhead.text}
                  </p>
                )}
                {/*
                  The "then" line: the next maneuver, only when it is known and
                  within a mile. It is display-only — `aria-hidden` keeps the
                  1 Hz card from reading two instructions, and the spoken
                  announcement still describes the maneuver being ridden now.
                */}
                {guidance.maneuver.then === null ? null : (
                  <p
                    className="og-ride__maneuver-then"
                    data-testid="ride-maneuver-then"
                    aria-hidden="true"
                  >
                    <span className="og-ride__maneuver-then-label">Then</span>
                    <ManeuverGlyph glyph={guidance.maneuver.then.glyph} variant="then" />
                    <span className="og-ride__maneuver-then-action">
                      {guidance.maneuver.then.actionText}
                      {guidance.maneuver.then.roadName === null ? null : (
                        <span className="og-ride__maneuver-then-road">
                          {guidance.maneuver.then.roadPreposition === "on" ? " on " : " onto "}
                          {guidance.maneuver.then.roadName}
                        </span>
                      )}
                    </span>
                  </p>
                )}
              </>
            ) : guidance.kind === "suspended" && guidance.reason === "off-route" ? (
              <>
                {/*
                  Off the line, the same card still says the next action: which
                  way the route is, and the one thing to tap if the rider would
                  rather have a new route from here.
                */}
                <span className="og-ride__maneuver-symbol">
                  <ManeuverGlyph glyph={headBack?.glyph ?? "straight"} />
                </span>
                <p className="og-ride__maneuver-suspended" data-testid="ride-guidance-state">
                  {headBackText}
                </p>
                {(cardNote ?? guidance.offRouteDistanceText) === null ? null : (
                  <p className="og-ride__off-route-distance" data-testid="ride-off-route-distance">
                    {cardNote ?? guidance.offRouteDistanceText}
                  </p>
                )}
                {offRouteActionsShown ? (
                  <div className="og-ride__off-route-actions" data-testid="ride-off-route-actions">
                    <button
                      type="button"
                      className="og-ride__action og-ride__action--primary og-ride__off-route-action"
                      data-testid="ride-reroute-now"
                      disabled={rerouteBusy || !rerouteFixGood}
                      aria-busy={rerouteBusy ? "true" : undefined}
                      title={rerouteBusy || rerouteFixGood ? undefined : REROUTE_FIX_REASON}
                      onClick={(): void => { void store.getState().reroute(); }}
                    >
                      {rerouteBusy ? "Routing…" : "New route from here"}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="og-ride__maneuver-suspended" data-testid="ride-guidance-state">
                  <span data-testid={gpsUnavailable ? "ride-warning-gps-unavailable" : undefined}>{guidance.text}</span>
                </p>
                {/* One small line, never a second pill: what the ride is doing right now. */}
                {cardNote === null ? null : (
                  <p className="og-ride__off-route-distance" data-testid="ride-card-note">{cardNote}</p>
                )}
                {guidance.kind === "suspended" && guidance.reason === "not-moving" && navigation?.activity === "paused" ? (
                  <div className="og-ride__off-route-actions">
                    <button
                      type="button"
                      className="og-ride__action og-ride__action--primary og-ride__off-route-action"
                      data-testid="ride-card-resume"
                      disabled={!controls.resume.enabled}
                      title={controls.resume.reason ?? undefined}
                      onClick={(): void => { void store.getState().resume(); }}
                    >
                      Resume
                    </button>
                  </div>
                ) : null}
              </>
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

        {!noSignalRide.noSignal || terminal !== null ? null : <RideNoSignalChip kept={noSignalRide.kept !== null} />}

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
                disabled={rerouteBusy || noSignalRide.noSignal}
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

        {toast === null || terminal !== null || guidance.kind === "suspended" ? null : (
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
          {/*
            One right-hand column of 56 px buttons. On a phone it is exactly
            three, from the top: Recenter (pressed again it shows the whole
            route), Stops and Mute. The compass and the zoom pill are the
            tablet and desktop extras at its head and the stylesheet hides them
            on a phone: pinch zooms there, and north-up is a Menu row. Where they
            show, zoom still gets two 56 px halves of its own, because a
            glove cannot pinch.
          */}
          {terminal !== null ? null : (
            <div className="og-ride__rail" role="group" aria-label="Map and voice" data-testid="ride-rail">
              <div className="og-ride__rail-extra" role="group" aria-label="Map view" data-testid="ride-rail-extra">
                {!compassShown ? null : (
                  <button
                    type="button"
                    className="og-ride__rail-button og-ride__rail-compass"
                    data-testid="ride-compass"
                    aria-pressed={northUp}
                    // One name, one state: pressed means the map is north-up. The
                    // needle says which way north is in either case.
                    aria-label="North up"
                    title={northUp ? "North up" : "Heading up"}
                    style={{ "--og-bearing": String(camera?.bearing ?? 0) } as CSSProperties}
                    onClick={toggleNorthUp}
                  >
                    <svg className="og-ride__compass-needle" viewBox="0 0 24 24" aria-hidden="true">
                      <path className="og-ride__compass-tip" d="M12 2.5 16.5 12h-9z" />
                      <path className="og-ride__compass-tail" d="M12 21.5 7.5 12h9z" />
                    </svg>
                  </button>
                )}
                <div className="og-ride__rail-zoom" role="group" aria-label="Zoom" data-testid="ride-zoom">
                  <MapZoomControls
                    zoom={camera?.zoom ?? 0}
                    minZoom={camera?.minZoom ?? Number.NEGATIVE_INFINITY}
                    maxZoom={camera?.maxZoom ?? Number.POSITIVE_INFINITY}
                    onZoomIn={(): void => pressZoom(1)}
                    onZoomOut={(): void => pressZoom(-1)}
                  />
                </div>
              </div>
              {recenterShown ? (
                <button
                  type="button"
                  className="og-ride__rail-button"
                  data-testid="ride-recenter"
                  aria-label="Re-center"
                  title="Re-center on me"
                  onClick={(): void => store.getState().recenter()}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3 5 20l7-4 7 4-7-17Z" />
                  </svg>
                </button>
              ) : routeless ? null : (
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
              {/* Gas, food and anywhere along the rest of the route: it opens
                  the Menu on "Add a stop". */}
              {!rerouteAvailable || navigation?.activity !== "guided" ? null : (
                <button
                  type="button"
                  className="og-ride__rail-button"
                  data-testid="ride-search-along"
                  aria-label="Find gas, food or a stop along the route"
                  title="Find a stop along the route"
                  onClick={(): void => {
                    openSheet();
                    window.setTimeout(() => {
                      const addStop = document.querySelector<HTMLButtonElement>('[data-testid="ride-add-stop"][aria-expanded="false"]');
                      addStop?.click();
                    }, 60);
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="10.5" cy="10.5" r="6.5" />
                    <path d="m16 16 5 5" />
                  </svg>
                </button>
              )}
              {roadBlockedRailShown(navigation?.position ?? null) ? <RoadBlockedRailButton state={roadBlocked} /> : null}
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
        {terminal === null ? null : rideCard !== null && terminal.reason === "completed" ? (
          /*
            The ride card (R3-2): the line, the ride's name and day, and the four
            numbers. One headline, once: the card is the end of the ride, and
            "Ride finished" is said here and nowhere else.
          */
          <div className="og-ride__terminal" data-testid="ride-terminal">
            <RideCard
              card={rideCard}
              headline="Ride finished"
              doneHref="/rides?tab=ridden"
              onGpx={exportRideGpx}
              exitHref={exitHref}
            />
            {exportError === null ? null : (
              <p className="og-ride__error" role="alert" data-testid="ride-summary-export-error">
                {exportError}
              </p>
            )}
          </div>
        ) : terminal === null ? null : (
          <div className="og-ride__terminal" data-testid="ride-terminal">
            {/* The headline is the live region; the numbers and the two ways
                onward stay outside it, so the card never re-reads itself to a
                rider. This is the card for a ride whose numbers were never
                recorded (storage failed) and for a discarded ride. */}
            <h2 className="og-ride__terminal-title" role="status">
              {savedSummaryRideId !== null ? "Free Ride summary saved" : terminal.title}
            </h2>
            {terminal.reason !== "completed" ? null : (
              <RideRouteSketch
                routeLine={availableRouteLine}
                fraction={progress.fraction}
                distanceText={summaryDistanceText}
              />
            )}
            {/* One obvious next action, and the two ways on: My rides always,
                because the library is where a finished ride lives; Export GPX
                only when this surface holds a line worth exporting. This is
                the card for a ride with no numbers of its own (a discarded
                recording, or a storage failure), so it shows no stats. */}
            <div className="og-ride__actions">
              <Link
                className="og-ride__action og-ride__action--primary"
                data-testid="ride-summary-rides"
                href="/rides"
              >
                My rides
              </Link>
              {terminal.reason !== "completed" || availableRouteLine.length < 2 ? null : (
                <button
                  type="button"
                  className="og-ride__action"
                  data-testid="ride-summary-export"
                  onClick={exportRideGpx}
                >
                  Export GPX
                </button>
              )}
              <a className="og-ride__action og-ride__action--link" data-testid="ride-exit" href={exitHref}>
                Back to the planner
              </a>
            </div>
            {exportError === null ? null : (
              <p className="og-ride__error" role="alert" data-testid="ride-summary-export-error">
                {exportError}
              </p>
            )}
          </div>
        )}

        {/*
          `End ride` is two steps (8 §11): Save / Discard / Keep riding. While the
          question is open it takes the sheet's place — the rows underneath it
          would read as answers to it.
        */}
        {terminal !== null || !stopConfirm ? null : (
          <div className="og-ride__confirm" data-testid="ride-stop-confirm">
            <p className="og-ride__confirm-text">End this ride?</p>
            <div className="og-ride__actions">
              {/*
                The one obvious action, on its own row: saving is what keeps
                the ride, so it leads and the ways out sit under it. A ride with
                no recording still has a summary, and that is what "Save
                summary" keeps — no paragraph explains it.
              */}
              <button
                type="button"
                className="og-ride__action og-ride__action--primary"
                data-testid="ride-finish"
                disabled={recordingToggleBusy || recordingCleanupPending || !controls.finish.enabled}
                title={controls.finish.reason ?? undefined}
                onClick={(): void => {
                  void store.getState().finish();
                }}
              >
                {navigation?.recordingId == null
                  ? canSaveFreeRideSummary
                    ? "Save summary"
                    : "End ride"
                  : "Save ride"}
              </button>
              <button
                type="button"
                className="og-ride__action"
                data-testid="ride-discard"
                disabled={recordingToggleBusy || recordingCleanupPending || !controls.discard.enabled}
                title={controls.discard.reason ?? undefined}
                onClick={(): void => {
                  void store.getState().discard();
                }}
              >
                Discard
              </button>
              <button
                type="button"
                className="og-ride__action"
                data-testid="ride-keep-riding"
                onClick={(): void => store.getState().cancelStop()}
              >
                Keep riding
              </button>
              {/* A summary that cannot be saved still lets the ride end, and
                  says so in the same word as everything else here. */}
              {navigation?.recordingId == null && canSaveFreeRideSummary ? (
                <button
                  type="button"
                  className="og-ride__action og-ride__action--link"
                  data-testid="ride-finish-without-saving"
                  onClick={(): void => { void store.getState().finish(false); }}
                >
                  End without saving
                </button>
              ) : null}
            </div>
          </div>
        )}

        {/*
          The Menu is one grouped list, in the order a rider needs it:
          Emergency first, then Pause and End ride, Stops and fuel, Sound,
          Screen, More. Each group is a well of 56 px rows a hairline apart, and
          nothing in it is a form field until the rider opens one.
        */}
        {confirmAsking ? null : (
          <>
        {/*
          The way out: coordinates, 911 and sharing, one press away. It lives in
          the Menu now (it was a rail disc) and does exactly what it did.
        */}
        {terminal !== null ? null : (
          /* OG-16: pinned to the sheet's top edge; the rows scroll under it. */
          <div className="og-ride__sheet-pin" data-testid="ride-menu-pin">
          <div className="og-ride__menu-group" data-testid="ride-menu-emergency">
            <button
              type="button"
              className="og-ride__sheet-row og-ride__sheet-row--danger"
              data-testid="ride-emergency"
              data-tone="danger"
              aria-label="Emergency: where am I?"
              onClick={(): void => setEmergencyOpen(true)}
            >
              <span className="og-ride__sheet-row-label">Emergency</span>
              <span className="og-ride__sheet-row-hint">Where am I, call 911</span>
            </button>
          </div>
          </div>
        )}
        {terminal !== null ? null : <RoadBlockedMenuRow state={roadBlocked} onOpened={(): void => setSheetOpen(false)} />}

        {/*
          This ride: Pause (or Resume), then the two ways out in plain words and
          kept apart. "Stop following this route" drops the line but keeps
          riding, and recording, as Free Ride; "End ride" asks whether to save.
        */}
        {terminal !== null || stopConfirm ? null : (
          <div className="og-ride__menu-group" data-testid="ride-controls" role="group" aria-label="This ride">
            {navigation?.activity === "paused" ? (
              <button
                type="button"
                className="og-ride__sheet-row og-ride__sheet-row--primary"
                data-testid="ride-resume"
                disabled={!controls.resume.enabled}
                title={controls.resume.reason ?? undefined}
                onClick={(): void => {
                  void store.getState().resume();
                }}
              >
                <span className="og-ride__sheet-row-label">Resume</span>
              </button>
            ) : (
              <button
                type="button"
                className="og-ride__sheet-row"
                data-testid="ride-pause"
                disabled={!controls.pause.enabled}
                title={controls.pause.reason ?? undefined}
                onClick={(): void => {
                  void store.getState().pause();
                }}
              >
                <span className="og-ride__sheet-row-label">Pause</span>
              </button>
            )}

            {/*
              8 §3: a blocked location keeps the session controllable. Retries
              also happen by themselves; this is the rider's "now".
            */}
            {position.tone === "good" && !locationBlocked ? null : (
              <button
                type="button"
                className="og-ride__sheet-row"
                data-testid="ride-retry-location"
                disabled={!controls.retryLocation.enabled}
                title={controls.retryLocation.reason ?? undefined}
                onClick={(): void => {
                  void store.getState().retryLocationPermission();
                }}
              >
                <span className="og-ride__sheet-row-label">Retry location</span>
              </button>
            )}
            {navigation?.activity !== "guided" ? null : (
              <button
                type="button"
                className="og-ride__sheet-row"
                data-testid="continue-free-ride"
                onClick={(): void => { void store.getState().continueFreeRide(); }}
              >
                <span className="og-ride__sheet-row-label">Stop following this route</span>
                <span className="og-ride__sheet-row-hint">{stopFollowingHint(navigation.recordingId !== null)}</span>
              </button>
            )}
            {/*
              Recording is on from Start (R3-2). The switch stays for the rider
              who wants it off: one row, the state in the hint, and the same
              promise as before — turning it off discards the track.
            */}
            {navigation === null || navigation.activity === "free" || navigation.activity === "completed" ? null : (() => {
              const row = recordingRowCopy({
                recording: navigation.recordingId !== null,
                busy: recordingToggleBusy,
                cleanupPending: recordingCleanupPending,
                asking: recordingStopAsk,
              });
              return (
                <button
                  type="button"
                  className={`og-ride__sheet-row${row.tone === "plain" ? "" : ` og-ride__sheet-row--${row.tone}`}`}
                  data-testid="ride-recording-toggle"
                  data-tone={row.tone}
                  data-confirm={recordingStopAsk && navigation.recordingId !== null ? "true" : "false"}
                  aria-pressed={navigation.recordingId !== null}
                  disabled={recordingToggleBusy}
                  onClick={(): void => {
                    if (recordingCleanupPending) {
                      void store.getState().stopRecording();
                    } else if (navigation.recordingId !== null) {
                      // Turning recording off deletes the track: ask once, in red.
                      if (!recordingStopAsk) {
                        setRecordingStopAsk(true);
                        return;
                      }
                      setRecordingStopAsk(false);
                      void store.getState().stopRecording();
                    } else {
                      void store.getState().startRecording(navigation.plan.rideId, navigation.plan.rideRevision);
                    }
                  }}
                >
                  <span className="og-ride__sheet-row-label">{row.label}</span>
                  <span className="og-ride__sheet-row-hint">{row.hint}</span>
                </button>
              );
            })()}
            <button
              type="button"
              className="og-ride__sheet-row og-ride__sheet-row--danger"
              data-testid="ride-stop"
              disabled={!controls.finish.enabled && !controls.discard.enabled}
              title={controls.finish.reason ?? controls.discard.reason ?? undefined}
              onClick={(): void => store.getState().beginStop()}
            >
              <span className="og-ride__sheet-row-label">End ride</span>
              <span className="og-ride__sheet-row-hint">Save it or let it go</span>
            </button>
          </div>
        )}

        {/* What the ride has to say right now sits under the ride's own rows,
            not at the foot of a long list. */}
        {/*
          A newer version of the ride exists (it was edited on another screen).
          Never an alarm: the loaded version keeps being ridden, and the way to
          the newer one is one quiet row.
        */}
        {terminal !== null || !newerVersionReady ? null : (
          <div className="og-ride__newer" data-testid="ride-newer-version">
            <span className="og-ride__newer-text">A newer version of this ride is ready</span>
            <Link className="og-ride__newer-switch" href={exitHref}>
              Switch
            </Link>
          </div>
        )}

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
            {terminal === null ? <button type="button" className="og-ride__action" data-testid="breadcrumb-back-to-start" disabled={backtrackBusy || recordedLine.length < 2 || navigation?.activity === "paused"} onClick={() => void store.getState().backToStart()}>{backtrackBusy ? "Preparing return…" : "Back to start"}</button> : null}
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

        {terminal === null && recordingCleanupPending && navigation?.activity !== "free" ? (
          <section aria-label="Recording cleanup">
            <p>Retry turning recording off before finishing this ride.</p>
            <button type="button" className="og-ride__action" disabled={recordingToggleBusy}
              onClick={(): void => { void store.getState().stopRecording(); }}>Retry turning recording off</button>
          </section>
        ) : null}

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
        {terminal !== null || routeLineAvailable || navigation?.plan.route === null ? null : (
          <p className="og-ride__progress-line" data-testid="ride-line-unavailable">
            The route line can&apos;t be drawn right now. The ride is unaffected.
          </p>
        )}
        {/*
          Stops and fuel. Add a stop, then a new route from here: the two things
          a rider asks for most while riding. A Free Ride has its own rows here
          instead (recording, suggestions, ways home).
        */}
        {terminal !== null || !noSignalRide.noSignal || navigation?.activity !== "guided" ? null : <RideNoSignalRows />}
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
            /* While its gas/food list is open the sheet must not time out. */
            onHoldChange={holdSheetForStopFinder}
            search={placeSearch}
            remainingMeters={viewModel?.secondary.remainingDistanceMeters ?? null}
            remainingSeconds={viewModel?.secondary.remainingDurationSeconds ?? null}
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

        {/* "Next gas": one line, and one button when the tank will not reach
            the station ahead (maps-for-riders §5). */}
        {terminal !== null || noSignalRide.noSignal ? null : (
          <RideFuelLine
            stations={rideInterest.fuelAhead}
            stationsFound={rideInterest.fuelFound}
            routeKey={guidedRouteId}
            alongMiles={alongMiles}
            position={navigation?.position.coordinate ?? null}
            headingDegrees={navigation?.position.headingDegrees ?? null}
            usableMiles={usableRangeMiles}
            source={mapLayersSource}
            onAddStop={(coordinate, name): void => {
              void store.getState().reroute({ coordinate, label: name });
            }}
          />
        )}

        {terminal !== null ? null : navigation?.activity === "free" ? (
          <section className="og-ride__free-ride" aria-label="Free Ride controls" data-testid="free-ride-controls">
            <h2 className="og-visually-hidden">Free Ride</h2>
            {/*
              Two rows, one switch each: recording and the suggestions that
              find roads. The row says what the press does ("Record this ride" /
              "Stop recording"); the switch beside it says whether it is on, so
              the sheet never explains itself in a sentence.
            */}
            <div className="og-ride__switch-rows">
              <button
                type="button"
                className="og-ride__switch-row"
                data-testid="free-ride-recording-toggle"
                disabled={recordingToggleBusy}
                onClick={(): void => {
                  if (recordingCleanupPending || navigation.recordingId !== null) void store.getState().stopRecording();
                  else void store.getState().startRecording(navigation.plan.rideId, navigation.plan.rideRevision);
                }}
              >
                <span className="og-ride__switch-row-label">Recording</span>
                <span className="og-ride__sheet-row-hint">
                  {recordingCleanupPending
                    ? "Retry turning it off"
                    : navigation.recordingId === null
                      ? "Off"
                      : "On"}
                </span>
                <span
                  className="og-ride__switch"
                  aria-hidden="true"
                  data-on={navigation.recordingId === null ? "false" : "true"}
                >
                  <span className="og-ride__switch-knob" />
                </span>
              </button>
              <button
                type="button"
                className="og-ride__switch-row"
                data-testid="free-ride-suggestions-toggle"
                aria-pressed={suggestions === "on"}
                onClick={(): void => { void store.getState().setSuggestions(suggestions !== "on"); }}
              >
                <span className="og-ride__switch-row-label">Suggest roads nearby</span>
                <span className="og-ride__switch" aria-hidden="true" data-on={suggestions === "on" ? "true" : "false"}>
                  <span className="og-ride__switch-knob" />
                </span>
              </button>
            </div>
            {/* One short line, and only while there is a track to lose. */}
            {navigation.recordingId === null ? null : (
              <p className="og-ride__free-ride-note">Turning recording off discards the track.</p>
            )}
            {suggestions === "on" && rideOffersAvailable ? (
              <button
                type="button"
                className="og-ride__action"
                data-testid="ride-offer-request"
                disabled={rideOfferBusy || rideOffer !== null}
                onClick={(): void => {
                  store.getState().requestRideOffer();
                  setSheetOpen(false);
                }}
              >
                {rideOfferBusy ? "Finding a ride…" : "Offer me a ride"}
              </button>
            ) : null}
            {/* One more row before the ways back: anywhere the rider can name,
                searched from here and navigated to through the same session. */}
            <RideStopSearch
              mode="nearby"
              search={placeSearch}
              position={navigation.position.coordinate}
              routeLine={[]}
              busy={returnBusy}
              fixGood={navigation.position.quality === "fresh-good"}
              onGo={(place): void => {
                void store.getState().navigateTo({ coordinate: place.coordinate, label: place.name });
              }}
            />
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
              <p className="og-ride__free-ride-status" data-testid="free-ride-status" role="status">
                {freeRideStatusMessage}
              </p>
            )}
            {freeRideError === null ? null : (
              <p className="og-ride__error" data-testid="free-ride-error" role="alert">
                {freeRideError}
              </p>
            )}
          </section>
        ) : navigation?.activity === "guided" && (freeRideStatusMessage !== null || freeRideError !== null) ? (
          <section className="og-ride__free-ride" aria-label="Free Ride controls" data-testid="free-ride-controls">
            {freeRideStatusMessage === null ? null : (
              <p className="og-ride__free-ride-status" data-testid="free-ride-status" role="status">{freeRideStatusMessage}</p>
            )}
            {freeRideError === null ? null : (
              <p className="og-ride__error" role="alert">{freeRideError}</p>
            )}
          </section>
        ) : null}

        {/* Sound: the voice on or off. The rail's Mute button is the same switch. */}
        {terminal !== null ? null : (
          <div className="og-ride__menu-group" data-testid="ride-menu-sound">
            <button
              type="button"
              className="og-ride__switch-row"
              data-testid="ride-sound"
              role="switch"
              aria-checked={!voiceMuted}
              onClick={(): void => setVoiceMuted(!voiceMuted)}
            >
              <span className="og-ride__switch-row-label">Voice guidance</span>
              <span className="og-ride__switch" aria-hidden="true" data-on={voiceMuted ? "false" : "true"}>
                <span className="og-ride__switch-knob" />
              </span>
            </button>
          </div>
        )}

        {/*
          Screen: how it looks and what the map points out along the way. Day /
          Night where the rider is, not three taps away in Settings: a switch at
          sunset that cannot be overridden at the roadside is not automatic, it
          is stuck. Auto follows the sun while a ride is open. North up is here
          too, because a phone has no compass button.
        */}
        {terminal !== null ? null : (
          <div className="og-ride__menu-group">
            <details className="og-ride__more og-ride__style" data-testid="ride-style">
              <summary className="og-ride__sheet-row">
                <span className="og-ride__sheet-row-label">Screen</span>
                <span className="og-ride__sheet-row-hint">Day or night, north up</span>
              </summary>
              <div className="og-ride__display" data-testid="ride-display" role="group" aria-label="Screen">
                {DISPLAY_CHOICES.map((choice) => (
                  <button
                    key={choice.mode}
                    type="button"
                    className="og-ride__action og-ride__display-option"
                    data-testid={`ride-display-${choice.mode}`}
                    aria-pressed={appearanceMode === choice.mode}
                    onClick={(): void => setAppearanceMode(choice.mode)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="og-ride__switch-row"
                data-testid="ride-north-up"
                role="switch"
                aria-checked={northUp}
                onClick={toggleNorthUp}
              >
                <span className="og-ride__switch-row-label">North up</span>
                <span className="og-ride__switch" aria-hidden="true" data-on={northUp ? "true" : "false"}>
                  <span className="og-ride__switch-knob" />
                </span>
              </button>
              {navigation?.activity !== "guided" ? null : (
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
            </details>
          </div>
        )}

        {/*
          More: live location sharing and the GPS details, one row each. Sharing
          is a frozen feature and only moved here; its form opens on request.
        */}
        {terminal !== null ? null : (
          <div className="og-ride__menu-group">
            <details className="og-ride__more" data-testid="ride-menu-more">
              <summary className="og-ride__sheet-row">
                <span className="og-ride__sheet-row-label">More</span>
                <span className="og-ride__sheet-row-hint">{safety === undefined ? "GPS and ride details" : "Live location, GPS"}</span>
              </summary>
              {safety === undefined ? null : (
                <LiveShareRow
                  safety={safety}
                  routeLine={availableRouteLine}
                  remainingDurationSeconds={viewModel?.secondary.remainingDurationSeconds ?? null}
                  {...(requestMotion === undefined ? {} : { requestMotion })}
                />
              )}
              <details className="og-ride__more" data-testid="ride-gps-details">
                <summary className="og-ride__sheet-row">
                  <span className="og-ride__sheet-row-label">GPS and ride details</span>
                  <span className="og-ride__sheet-row-hint">Signal, speed, progress</span>
                </summary>
                <div className="og-ride__details">
                  <div className="og-ride__identity">
                    <p className="og-ride__activity" data-testid="ride-activity">
                      {viewModel.activityLabel}
                    </p>
                    <p className="og-ride__gps" data-testid="ride-gps" data-tone={position.tone}>
                      <span className="og-ride__gps-label">{gpsUnavailable ? "Finding GPS" : position.qualityLabel}</span>
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
                </div>
              </details>
            </details>
          </div>
        )}

        {terminal !== null || mapReady ? null : (
          <p className="og-ride__notice" data-testid="ride-map-unavailable">
            The map isn&apos;t loaded yet. The ride is unaffected.
          </p>
        )}

        {/*
          The screen may sleep, so keep it on. One line, under the rows instead
          of in a box between them, and the rider can put it away: there is
          nothing to do about it, and it is not an alarm. The full sentence
          stays on the row's title.
        */}
        {wakeNote === null || screenNoteDismissed || terminal !== null ? null : (
          <p
            className="og-ride__screen-note"
            data-testid="ride-wake-note"
            title={wakeNote.text}
            role="status"
          >
            <span>Keep your screen on, it may sleep</span>
            <button
              type="button"
              className="og-ride__screen-note-dismiss"
              data-testid="ride-wake-note-dismiss"
              aria-label="Dismiss the screen note"
              onClick={(): void => setScreenNoteDismissed(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </p>
        )}

        {/* The way out lives on the finish card itself; a running ride keeps it
            at the end of the sheet's own content. */}
        {terminal === null ? (
          <a className="og-ride__action og-ride__action--link" data-testid="ride-exit" href={exitHref}>
            Back to the planner
          </a>
        ) : null}
          </>
        )}
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
        DV-10: the bottom is one slim strip — the three readouts and the sheet
        toggle, plus one line naming the recording while one runs. Tapping a
        readout while moving opens the sheet.
      */}
      {/* Connected music is one 64 px row on the map, right above the strip.
          Nothing at all when Spotify is not connected: set-up and its failures
          belong in Settings, never on top of a rider's menu. */}
      {spotifyPlayer === undefined || terminal !== null ? null : (
        <RideMusicEntry player={spotifyPlayer} />
      )}
      <footer
        ref={stripRef}
        className="og-ride__strip"
        data-testid="ride-strip-bar"
        data-recording={recordingIndicator === null ? undefined : "true"}
      >
        {terminal !== null ? (
          <button
            type="button"
            className="og-ride__strip-summary"
            data-testid="ride-strip"
            aria-expanded={sheetVisible}
            aria-controls="og-ride-sheet"
            onClick={toggleSheet}
          >
            <span className="og-ride__strip-main">Ride summary</span>
            <span className="og-visually-hidden">{sheetVisible ? "Hide ride controls" : "Show ride controls"}</span>
          </button>
        ) : (
          <>
            {recordingIndicator === null ? null : (
              <p className="og-ride__recording-state" data-testid="ride-recording-state">
                <span className="og-ride__recording-state-dot" aria-hidden="true" />
                Recording
                <span className="og-visually-hidden">, {recordingIndicator.elapsedTimeSpoken}</span>
              </p>
            )}
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
              data-testid="ride-menu"
              data-held={sheetHeld ? "true" : undefined}
              aria-expanded={sheetVisible}
              aria-controls="og-ride-sheet"
              onClick={toggleSheet}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={sheetVisible ? "m6 9 6 6 6-6" : "m6 15 6-6 6 6"} />
              </svg>
              <span className="og-ride-metrics__toggle-label" aria-hidden="true">Menu</span>
              <span className="og-visually-hidden">{sheetVisible ? "Hide ride controls" : "Show ride controls"}</span>
            </button>
          </>
        )}
        {terminal === null ? null : (
          <a className="og-ride__strip-end og-ride__strip-end--exit" data-testid="ride-strip-exit" href={exitHref} aria-label="Back to the planner">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </a>
        )}
      </footer>
      {safety === undefined ? null : <RideSafetyOverlay safety={safety} />}
      {terminal !== null ? null : (
        <RoadBlockedOverlay
          state={roadBlocked}
          onReroute={rerouteAvailable && navigation?.activity === "guided" ? (): void => { void store.getState().reroute(); } : undefined}
          rerouteBusy={rerouteBusy || !rerouteFixGood}
        />
      )}
      {emergencyOpen ? (
        <EmergencyCard
          coordinate={navigation?.position.coordinate ?? null}
          altitudeMeters={navigation?.position.altitudeMeters ?? null}
          accuracyMeters={navigation?.position.accuracyMeters ?? null}
          note={
            navigation?.position.coordinate == null
              ? "Waiting for this device's GPS."
              : positionAgeText(navigation.position.ageMs)
          }
          {...(emergencyRoadRequest === undefined ? {} : { roadRequest: emergencyRoadRequest })}
          onClose={(): void => setEmergencyOpen(false)}
        />
      ) : null}
    </main>
  );
}

/**
 * "Share live location", one row under the Menu's More. The row says whether a
 * link is live; the form (a name and a finish time) is mounted only when the
 * rider opens it, so the Menu never opens on a field. Everything inside the
 * panel is the frozen feature, unchanged.
 */
function LiveShareRow({
  safety,
  routeLine,
  remainingDurationSeconds,
  requestMotion,
}: {
  readonly safety: RideSafety;
  readonly routeLine: readonly Coordinate[];
  readonly remainingDurationSeconds: number | null;
  readonly requestMotion?: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const sharing = useSyncExternalStore(
    (listener) => safety.subscribe(listener),
    () => safety.snapshot().live.status === "sharing",
    () => false,
  );
  return (
    <div className="og-ride__more-row">
      <button
        type="button"
        className="og-ride__sheet-row"
        data-testid="ride-share-live"
        aria-expanded={open}
        onClick={(): void => setOpen(!open)}
      >
        <span className="og-ride__sheet-row-label">Share live location</span>
        <span className="og-ride__sheet-row-hint">{sharing ? "Sharing now" : "Send a link"}</span>
      </button>
      {!open ? null : (
        <RideSafetyPanel
          safety={safety}
          routeLine={routeLine}
          remainingDurationSeconds={remainingDurationSeconds}
          {...(requestMotion === undefined ? {} : { requestMotion })}
        />
      )}
    </div>
  );
}

/** An unavailable line is an empty list, never a straight line between ends. */
function routeLineAvailability(
  available: boolean,
  routeLine: readonly { readonly lon: number; readonly lat: number }[],
): readonly { readonly lon: number; readonly lat: number }[] {
  return available ? routeLine : [];
}
