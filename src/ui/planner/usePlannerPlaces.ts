import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { LOCATE_FAILURE_COPY, locateOnce, type LocateOutcome } from "@/application/geocoding/locate-once";
import type { PlaceNameCache } from "@/application/geocoding/place-names";
import type { PlaceMatch, PlaceSearchPort } from "@/application/geocoding/place-search";
import {
  EMPTY_PLACE_MEMORY,
  isSaved,
  placeKey,
  rememberedPlaces,
  type PlaceMemoryStore,
  type RememberedPlace,
} from "@/application/geocoding/place-memory";
import type { MapExtent } from "@/application/map/build-map-scene";
import type { RiderPositionScene } from "@/application/map/types";
import type { PlaceNameLookup } from "@/application/planner/planner-view-model";
import type { PositionSource } from "@/application/ride-session/position-pipeline";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import {
  currentLocationStartCommand,
  searchedEndpointCommand,
  type RideDocumentStore,
} from "@/ui/stores/ride-document-store";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";

/**
 * The place services the composition root supplies (M1). All optional: a
 * surface without them keeps map placement and "Dropped pin" names, which is
 * exactly the honest state of an embedding with no geocoder.
 */
export interface PlannerPlaceServices {
  readonly search: PlaceSearchPort;
  readonly names: PlaceNameCache;
  readonly position?: PositionSource;
  /**
   * When a fresh ride may fill Start from the rider's location: only once the
   * browser says location is `granted` (never a prompt on page load), or also
   * on `prompt` in the installed app, where the Permissions API cannot see the
   * app's own grant and asking on first open is what a riding app does.
   */
  readonly autoLocate?: "when-granted" | "ask";
  /** Saved places and recents on this device (NV-02). */
  readonly memory?: PlaceMemoryStore;
  /** Home from Settings, offered first in an empty search. */
  readonly home?: () => PlaceMatch | null;
}

/** What the intent composer needs to offer search on its two rows. */
export interface ComposerPlaceSearch {
  readonly port: PlaceSearchPort;
  readonly bias?: Coordinate;
  readonly onPick: (slot: "start" | "finish", place: PlaceMatch, query: string) => void;
  readonly currentLocation?: {
    readonly onUse: () => void;
    readonly locating: boolean;
    readonly failure: string | null;
  };
  /** Home, saved places and recents matching a query (NV-02). */
  readonly remembered?: (query: string, limit: number) => readonly RememberedPlace[];
  /** The star beside a chosen start or destination (NV-02). */
  readonly saving?: {
    /** `null` when the slot has no point to save. */
    readonly isSaved: (slot: "start" | "finish") => boolean | null;
    readonly toggle: (slot: "start" | "finish") => void;
  };
}

/** The map's "center on me" button (owner request, like Google Maps). */
export interface PlannerLocateMe {
  readonly onLocate: () => void;
  readonly locating: boolean;
  readonly failure: string | null;
}

export interface PlannerPlaces {
  readonly placeNameFor: PlaceNameLookup | undefined;
  readonly composerSearch: ComposerPlaceSearch | undefined;
  /** The rider's last fix, drawn as the blue dot, or `null` before one. */
  readonly riderPosition: RiderPositionScene | null;
  /** Absent when the surface has no position source. */
  readonly locateMe: PlannerLocateMe | undefined;
}

/** Half the side of the window a lone searched place is framed in (~9 km). */
const PLACE_WINDOW_DEGREES = 0.08;

/** Half the side of the window "center on me" frames (~2 km, street level). */
const LOCATE_WINDOW_DEGREES = 0.018;

/** A fix this loose is drawn as uncertain, not as a confident dot. */
const LOOSE_FIX_METERS = 150;

/** The one line the rider reads when "center on me" can't find them. */
export const LOCATE_ME_FAILURE_COPY: Readonly<Record<Extract<LocateOutcome, { status: "failed" }>["code"], string>> = {
  "permission-denied": "Location is off for OpenGravel. Allow it in your browser or device settings to see yourself on the map.",
  "position-unavailable": "Your location isn't available right now.",
  timeout: "Finding your location took too long. Try again.",
  unsupported: "This browser can't share your location.",
};

/** The dot for a fix: Signal Blue when it is tight, uncertain when it is loose. */
export function riderDotFor(outcome: Extract<LocateOutcome, { status: "located" }>): RiderPositionScene {
  return {
    coordinate: outcome.coordinate,
    confidence: outcome.accuracyMeters > LOOSE_FIX_METERS ? "degraded" : "good",
  };
}

/** The street-level window "center on me" frames around the rider. */
export function locateExtent(coordinate: Coordinate): MapExtent {
  return {
    minLat: coordinate.lat - LOCATE_WINDOW_DEGREES,
    maxLat: coordinate.lat + LOCATE_WINDOW_DEGREES,
    minLon: coordinate.lon - LOCATE_WINDOW_DEGREES,
    maxLon: coordinate.lon + LOCATE_WINDOW_DEGREES,
  };
}

/**
 * Where the camera goes after a pick: the ride's two ends when both exist, else
 * a town-sized window around the one there is. A search is a rider asking to go
 * somewhere, unlike a first tap, which must not zoom (05 §8).
 */
export function searchFitExtent(document: RideDocument): MapExtent | null {
  const ends = [document.intent.start, document.intent.finish].flatMap((point) =>
    point === null ? [] : [point.coordinate],
  );
  if (ends.length === 0) return null;
  const lats = ends.map((coordinate) => coordinate.lat);
  const lons = ends.map((coordinate) => coordinate.lon);
  const pad = ends.length === 1 ? PLACE_WINDOW_DEGREES : 0;
  return {
    minLat: Math.min(...lats) - pad,
    maxLat: Math.max(...lats) + pad,
    minLon: Math.min(...lons) - pad,
    maxLon: Math.max(...lons) + pad,
  };
}

/** Resolves once the store's startup restore has finished (or at once). */
function restoreSettled(store: RideDocumentStore): Promise<void> {
  if (store.getState().restoreStatus.state !== "loading") return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe((state) => {
      if (state.restoreStatus.state === "loading") return;
      unsubscribe();
      resolve();
    });
  });
}

const NO_SUBSCRIPTION = (): (() => void) => () => undefined;
const ZERO = (): number => 0;
const NO_MEMORY = () => EMPTY_PLACE_MEMORY;
const HYDRATED = (): boolean => true;
const NOT_HYDRATED = (): boolean => false;

/**
 * Place search, place names and "Current location" for the planner (M1).
 *
 * Owns no ride state: a pick or a fix becomes exactly one typed command through
 * the document store, and a dropped pin's name is read from the name cache
 * (derived evidence, OGV-D-260) — never written into the document.
 */
export function usePlannerPlaces(input: {
  readonly document: RideDocument;
  readonly rideDocumentStore: RideDocumentStore;
  readonly plannerUiStore: PlannerUiStore;
  readonly places: PlannerPlaceServices | undefined;
}): PlannerPlaces {
  const { document, rideDocumentStore, plannerUiStore, places } = input;
  const names = places?.names;

  const version = useSyncExternalStore(
    names === undefined ? NO_SUBSCRIPTION : names.subscribe,
    names === undefined ? ZERO : names.version,
    ZERO,
  );

  // Ask for a name for every point that has none of its own. The cache keys on
  // the coordinate, so a moved pin is simply a new question.
  const { start, stops, finish } = document.intent;
  useEffect(() => {
    if (names === undefined) return;
    for (const point of [start, ...stops, finish]) {
      if (point === null || (point.label !== undefined && point.label.length > 0)) continue;
      names.request(point.coordinate);
    }
  }, [names, start, stops, finish]);

  const placeNameFor = useMemo<PlaceNameLookup | undefined>(
    () => (names === undefined ? undefined : (coordinate) => names.nameFor(coordinate)),
    // `version` is the cache's change signal: a new name is a new lookup identity,
    // which is what lets the view-model memo see it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [names, version],
  );

  const memoryStore = places?.memory;
  const memory = useSyncExternalStore(
    memoryStore?.subscribe ?? NO_SUBSCRIPTION,
    memoryStore?.read ?? NO_MEMORY,
    NO_MEMORY,
  );
  // Home lives in device storage, which the server render cannot see: read it
  // after mount so the first client render matches the server's HTML.
  const homeOf = places?.home;
  const hydrated = useSyncExternalStore(NO_SUBSCRIPTION, HYDRATED, NOT_HYDRATED);

  const onPick = useCallback(
    (slot: "start" | "finish", place: PlaceMatch, query: string): void => {
      if (place.provider !== "home") memoryStore?.record(place);
      const state = rideDocumentStore.getState();
      const result = state.dispatch(
        searchedEndpointCommand(
          state.document,
          slot,
          {
            label: place.label,
            coordinate: place.coordinate,
            provider: place.provider,
            placeId: place.id,
          },
          query,
        ),
      );
      if (result.outcome === "applied") {
        plannerUiStore.getState().requestFit(searchFitExtent(result.document));
      }
    },
    [rideDocumentStore, plannerUiStore, memoryStore],
  );

  const [locating, setLocating] = useState(false);
  const [locateFailure, setLocateFailure] = useState<string | null>(null);
  // Every fix the planner is handed also becomes the blue dot, whichever
  // control asked for it: the rider has already said yes to being located.
  const [riderPosition, setRiderPosition] = useState<RiderPositionScene | null>(null);
  const position = places?.position;
  const onUseLocation = useCallback((): void => {
    if (position === undefined) return;
    setLocating(true);
    setLocateFailure(null);
    void locateOnce(position).then((outcome) => {
      setLocating(false);
      if (outcome.status === "failed") {
        setLocateFailure(LOCATE_FAILURE_COPY[outcome.code]);
        return;
      }
      setRiderPosition(riderDotFor(outcome));
      const state = rideDocumentStore.getState();
      const result = state.dispatch(currentLocationStartCommand(state.document, outcome));
      if (result.outcome === "applied") {
        plannerUiStore.getState().requestFit(searchFitExtent(result.document));
      }
    });
  }, [position, rideDocumentStore, plannerUiStore]);

  /**
   * UX rework 2 (#6): a fresh ride opens on the rider, with Start set to their
   * current location, as Google/Apple Maps and Calimoto do. Only when location
   * is already granted, so the planner never opens on a permission prompt. It
   * runs once, and never over a ride that has (or gains) its own points.
   */
  const autoLocateMode = places?.autoLocate;
  const autoLocated = useRef(false);
  useEffect(() => {
    if (autoLocated.current || position === undefined) return;
    autoLocated.current = true;
    if (start !== null || finish !== null) return;
    let cancelled = false;
    // The rider's own action always wins over this background fill: if they
    // set a start or destination, or left the planner (Record, Just ride),
    // while the fix was on its way, the answer is dropped. Not a revision or
    // ride fence: startup itself restores the saved ride and applies the
    // garage's bike, and in the iOS app the first fix lands after both.
    const stillFresh = (): boolean => {
      const document = rideDocumentStore.getState().document;
      return !cancelled && document.intent.start === null && document.intent.finish === null;
    };
    const askAllowed = autoLocateMode === "ask";
    void position.permission().then(async (permission) => {
      if ((permission !== "granted" && !(askAllowed && permission === "prompt")) || !stillFresh()) return;
      const outcome = await locateOnce(position);
      // Startup seeds a new ride with the garage's active bike only while the
      // ride is untouched; a fix that lands first would keep the default bike.
      await restoreSettled(rideDocumentStore);
      if (outcome.status === "failed") return;
      setRiderPosition(riderDotFor(outcome));
      if (!stillFresh()) return;
      const state = rideDocumentStore.getState();
      const result = state.dispatch(currentLocationStartCommand(state.document, outcome));
      if (result.outcome === "applied") {
        plannerUiStore.getState().requestFit(searchFitExtent(result.document));
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [position, start, finish, rideDocumentStore, plannerUiStore, autoLocateMode]);

  /**
   * "Center on me" (owner request, like Google Maps): find the rider, draw the
   * dot and frame the streets around it. It moves the camera only; the ride's
   * Start stays whatever the rider set (that is "Current location" in the
   * composer). One fix per press, so nothing tracks the rider while they plan.
   */
  const [centering, setCentering] = useState(false);
  const [centerFailure, setCenterFailure] = useState<string | null>(null);
  const centeringRef = useRef(false);
  const onLocateMe = useCallback((): void => {
    if (position === undefined || centeringRef.current) return;
    centeringRef.current = true;
    setCentering(true);
    setCenterFailure(null);
    void locateOnce(position).then((outcome) => {
      centeringRef.current = false;
      setCentering(false);
      if (outcome.status === "failed") {
        setCenterFailure(LOCATE_ME_FAILURE_COPY[outcome.code]);
        return;
      }
      setRiderPosition(riderDotFor(outcome));
      plannerUiStore.getState().requestFit(locateExtent(outcome.coordinate));
    });
  }, [position, plannerUiStore]);
  const locateMe = useMemo<PlannerLocateMe | undefined>(
    () =>
      position === undefined
        ? undefined
        : { onLocate: onLocateMe, locating: centering, failure: centerFailure },
    [position, onLocateMe, centering, centerFailure],
  );

  const bias = (start ?? finish)?.coordinate;
  const search = places?.search;

  // The chosen point as a place to star: its own label, else its looked-up name.
  const pointPlace = useCallback(
    (slot: "start" | "finish"): PlaceMatch | null => {
      const point = slot === "start" ? start : finish;
      if (point === null) return null;
      const label = point.label ?? names?.nameFor(point.coordinate) ?? "Dropped pin";
      const [name = label, ...rest] = label.split(", ");
      return {
        id: `saved:${placeKey(point.coordinate)}`,
        label,
        name,
        context: rest.join(", "),
        coordinate: point.coordinate,
        provider: "saved",
      };
    },
    // `version` re-reads a name that arrived after the pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start, finish, names, version],
  );

  const composerSearch = useMemo<ComposerPlaceSearch | undefined>(() => {
    if (search === undefined) return undefined;
    return {
      port: search,
      ...(bias === undefined ? {} : { bias }),
      onPick,
      ...(position === undefined
        ? {}
        : { currentLocation: { onUse: onUseLocation, locating, failure: locateFailure } }),
      ...(memoryStore === undefined
        ? {}
        : {
            remembered: (query: string, limit: number) =>
              rememberedPlaces(memory, hydrated ? (homeOf?.() ?? null) : null, query, limit),
            saving: {
              isSaved: (slot: "start" | "finish") => {
                const place = pointPlace(slot);
                return place === null ? null : isSaved(memory, place.coordinate);
              },
              toggle: (slot: "start" | "finish") => {
                const place = pointPlace(slot);
                if (place !== null) memoryStore.toggleSaved(place);
              },
            },
          }),
    };
  }, [search, bias, onPick, position, onUseLocation, locating, locateFailure, memoryStore, memory, homeOf, hydrated, pointPlace]);

  return { placeNameFor, composerSearch, riderPosition, locateMe };
}
