"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchPinGlyph } from "@/application/geocoding/place-glyph";
import type { PlaceMatch } from "@/application/geocoding/place-search";
import { formatDuration } from "@/application/planner/measurements";
import { isSaved } from "@/application/geocoding/place-memory";
import type { LocateOutcome } from "@/application/geocoding/locate-once";
import { DEFAULT_MAP_EXTENT, type MapExtent } from "@/application/map/build-map-scene";
import type { MapIntent, MapPointAction } from "@/application/map/types";
import type { MapLayersSource } from "@/application/map-layers";
import { asPlaceId, type NearbyPlace } from "@/application/places";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import { directionsCommand, searchedEndpointCommand, insertStopCommand, placeStartCommand, type RideDocumentStore } from "@/ui/stores/ride-document-store";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";
import type { ComposerPlaceSearch, PlannerPlaceServices } from "@/ui/planner/usePlannerPlaces";
import { useMapLayers } from "@/ui/layers/useMapLayers";
import { haversine } from "@/domain/geometry/analysis";
import { PlaceSheet } from "./PlaceSheet";
import { RiderToast, type ToastNotice } from "./RiderToast";
import { TopSearch, type LayerChip, type SearchChip } from "./TopSearch";
import type { FuelGapRoute } from "./useRouteFuelGap";

type Selection = { readonly place: PlaceMatch; readonly dropped: boolean; readonly slot: "start" | "finish" };
/** A category chip, or the rider's own words run as a results list. */
type SearchQuery = { readonly id: string; readonly label: string; readonly query: string; readonly empty: string };
type Results = {
  readonly chip: SearchQuery;
  readonly places: readonly PlaceMatch[];
  readonly status: "searching" | "ready" | "unavailable";
  readonly message: string | null;
};

/**
 * "0.5 mi · 412 South York Road": the rider's distance (or the one the
 * search already gave) and the street, each once.
 */
function resultMeta(context: string, miles: number | null): string {
  const parts = context.split(" · ").map((part) => part.trim()).filter(Boolean);
  const given = parts.find((part) => /^\d+(\.\d+)? mi$/.test(part)) ?? null;
  const street = parts.find((part) => part !== given)?.split(",")[0]?.trim() ?? null;
  const distance = miles === null ? given : `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
  return [distance, street].filter(Boolean).join(" · ");
}

function pinAt(coordinate: Coordinate): PlaceMatch {
  return { id: `dropped:${coordinate.lat}:${coordinate.lon}`, provider: "map", name: "Dropped pin", label: "Dropped pin", context: "", coordinate };
}

export function usePlaceFlow({ services, search, rider, locateStart, rideStore, uiStore, hasRoute, route, mapLayers, onMapPointAction, onDirectionsReady }: {
  readonly onDirectionsReady: (document: RideDocument) => void;
  readonly services: PlannerPlaceServices | undefined;
  readonly search: ComposerPlaceSearch | undefined;
  readonly rider: Coordinate | null;
  readonly locateStart: () => Promise<LocateOutcome>;
  readonly rideStore: RideDocumentStore;
  readonly uiStore: PlannerUiStore;
  readonly hasRoute: boolean;
  /** The open route, whose fuel gaps can earn the chip after Gas. */
  readonly route?: FuelGapRoute | null;
  /** The map-layer provider that answers the along-route fuel search. */
  readonly mapLayers?: MapLayersSource | undefined;
  readonly onMapPointAction: (action: MapPointAction, coordinate: Coordinate) => void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [extent, setExtent] = useState<MapExtent>(DEFAULT_MAP_EXTENT);
  const [busy, setBusy] = useState(false);
  const [travel, setTravel] = useState<{ readonly key: string; readonly seconds: number | null } | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [notice, setNotice] = useState<ToastNotice | null>(null);
  const layers = useMapLayers(undefined);
  const request = useRef<AbortController | null>(null);
  const operation = useRef(0);
  const bias = useMemo(() => rider ?? { lat: (extent.minLat + extent.maxLat) / 2, lon: (extent.minLon + extent.maxLon) / 2 }, [rider, extent]);
  const dismissToast = useCallback(() => setNotice(null), []);
  const toast = useCallback((message: string, undo = false) => {
    setNotice((current) => ({ id: (current?.id ?? 0) + 1, message, ...(undo ? { undo: () => { rideStore.getState().undo(); setOptionsOpen(false); uiStore.getState().setSheetDetent("peek"); } } : {}) }));
  }, [rideStore, uiStore]);
  const close = useCallback(() => {
    operation.current++;
    request.current?.abort();
    setSelection(null); setResults(null); setBusy(false);
    uiStore.getState().setSheetDetent(hasRoute ? "ride" : "peek");
  }, [uiStore, hasRoute]);
  useEffect(() => () => { operation.current++; request.current?.abort(); }, []);

  const open = useCallback((place: PlaceMatch, slot: "start" | "finish" = "finish", dropped = false) => {
    operation.current++;
    setBusy(false); setSelection({ place, dropped, slot }); setOptionsOpen(false);
    services?.memory?.record(place);
    uiStore.getState().cancelPlacement();
    uiStore.getState().setSheetDetent("half");
    uiStore.getState().requestFit({ minLat: place.coordinate.lat - .018, maxLat: place.coordinate.lat + .018, minLon: place.coordinate.lon - .018, maxLon: place.coordinate.lon + .018 });
  }, [services, uiStore]);

  // A held pin remains a pin; reverse naming changes only the displayed card.
  useEffect(() => {
    if (!selection?.dropped || selection.place.provider !== "map" || services === undefined) return;
    const controller = new AbortController();
    const id = selection.place.id;
    void services.search.reverse(selection.place.coordinate, { signal: controller.signal }).then((place) => {
      if (controller.signal.aborted || place === null) return;
      setSelection((current) => current?.place.id === id ? { ...current, place: { ...place, id, coordinate: current.place.coordinate } } : current);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [selection?.dropped, selection?.place.id, selection?.place.provider, selection?.place.coordinate, services]);

  const directions = useCallback(async (place: PlaceMatch) => {
    const ticket = ++operation.current;
    const revision = rideStore.getState().document.revision;
    setBusy(true);
    const outcome = await locateStart();
    if (ticket !== operation.current || rideStore.getState().document.revision !== revision) { setBusy(false); return; }
    const document = rideStore.getState().document;
    const result = rideStore.getState().dispatch(directionsCommand(document, { ...place, placeId: place.id }, outcome.status === "located" ? outcome : null));
    setBusy(false);
    if (result.outcome !== "applied") return;
    setSelection(null); setResults(null); setOptionsOpen(outcome.status === "located");
    uiStore.getState().cancelPlacement();
    uiStore.getState().setSheetDetent("half");
    toast("Directions set", true);
    if (outcome.status === "located") {
      uiStore.getState().setCameraUserOwned(false);
      uiStore.getState().requestFit(null);
      onDirectionsReady(result.document);
    }
    if (outcome.status === "failed") {
      // The destination mounts the start editor; focus after that render.
      requestAnimationFrame(() => window.document.querySelector<HTMLInputElement>('[data-testid="start-search"]')?.focus());
    }
  }, [rideStore, locateStart, uiStore, toast, onDirectionsReady]);

  const edit = useCallback((action: () => void, message: string) => {
    const before = rideStore.getState().document.revision;
    action();
    if (rideStore.getState().document.revision !== before) toast(message, true);
    close();
  }, [rideStore, toast, close]);

  /**
   * A rider sends a place to another rider, not to Google Maps. There is no
   * place deep link yet, so the text carries the coordinate and the app's own
   * address; the native sheet gets it first and the clipboard is the fallback.
   */
  const sharePlace = useCallback(async (place: PlaceMatch) => {
    const coordinate = `${place.coordinate.lat.toFixed(5)}, ${place.coordinate.lon.toFixed(5)}`;
    const text = `${place.name} — ${coordinate}`;
    const origin = typeof window === "undefined" ? null : window.location.origin;
    const link = origin === null || origin === "null" || !/^https?:$/.test(window.location.protocol) ? null : origin;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: place.name, text, ...(link === null ? {} : { url: link }) });
        toast("Place shared");
        return;
      } catch (error) {
        // A cancelled share is not a failure; anything else still gets copied.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(link === null ? text : `${text}\n${link}`);
      toast("Place copied");
    } catch {
      toast("Couldn't share this place. Try again.");
    }
  }, [toast]);

  const pointAction = useCallback((action: MapPointAction, coordinate: Coordinate) => {
    if (action === "info") { open(pinAt(coordinate), "finish", true); return; }
    if (action === "finish" && !hasRoute && services !== undefined) { void directions(pinAt(coordinate)); return; }
    edit(() => onMapPointAction(action, coordinate), action === "start" ? "Start set" : action === "stop" ? "Stop added" : action === "loop" ? "Loop set" : "Destination set");
  }, [open, hasRoute, services, directions, edit, onMapPointAction]);

  /**
   * One chip search against one map view. `Search this area` calls it again
   * with the view the rider has panned to, so an empty answer is never a lie
   * about the whole map.
   */
  const searchChip = useCallback(async (chip: SearchQuery, at: Coordinate) => {
    if (services === undefined) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setResults({ chip, places: [], status: "searching", message: null });
    uiStore.getState().setSheetDetent("half");
    try {
      const outcome = await services.search.search(chip.query, { bias: at, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (outcome.status === "ok" && outcome.places.length > 0) {
        const latitudes = outcome.places.map((place) => place.coordinate.lat);
        const longitudes = outcome.places.map((place) => place.coordinate.lon);
        uiStore.getState().requestFit({
          minLat: Math.min(...latitudes) - .004, maxLat: Math.max(...latitudes) + .004,
          minLon: Math.min(...longitudes) - .004, maxLon: Math.max(...longitudes) + .004,
        });
      }
      setResults({
        chip,
        places: outcome.status === "ok" ? outcome.places : [],
        status: outcome.status === "unavailable" ? "unavailable" : "ready",
        message: outcome.status === "unavailable" ? outcome.reason : null,
      });
    } catch {
      if (!controller.signal.aborted) setResults({ chip, places: [], status: "unavailable", message: "Place search is unavailable right now." });
    }
  }, [services, uiStore]);

  const category = useCallback((chip: SearchChip) => {
    close(); setOptionsOpen(false);
    void searchChip(chip, bias);
  }, [close, searchChip, bias]);

  /** Re-run the open category on the map view now on screen. */
  /** Enter on words that name many places ("coffee", "wawa"): the same
      matches the rider just saw, as a list with pins, like Google. */
  const searchList = useCallback((query: string, places: readonly PlaceMatch[]) => {
    close(); setOptionsOpen(false); request.current?.abort();
    setResults({ chip: { id: "query", label: query, query, empty: `Nothing found for “${query}” here` }, places, status: "ready", message: null });
    uiStore.getState().setSheetDetent("half");
    if (places.length > 0) {
      const latitudes = places.map((entry) => entry.coordinate.lat), longitudes = places.map((entry) => entry.coordinate.lon);
      uiStore.getState().requestFit({ minLat: Math.min(...latitudes) - .004, maxLat: Math.max(...latitudes) + .004, minLon: Math.min(...longitudes) - .004, maxLon: Math.max(...longitudes) + .004 });
    }
  }, [close, uiStore]);

  const searchThisArea = useCallback(() => {
    if (results === null) return;
    void searchChip(results.chip, { lat: (extent.minLat + extent.maxLat) / 2, lon: (extent.minLon + extent.maxLon) / 2 });
  }, [results, extent, searchChip]);

  const toggleLayer = useCallback((chip: LayerChip) => {
    const on = layers.enabled.includes(chip.layer);
    layers.toggle(chip.layer);
    toast(on ? `${chip.label} off` : `${chip.label} on. Zoom in to see roads.`);
  }, [layers, toast]);

  const pick = useCallback((slot: "start" | "finish", place: PlaceMatch) => { open(place, slot); }, [open]);
  const composerSearch: ComposerPlaceSearch | undefined = search === undefined ? undefined : { ...search, bias, onPick: pick };
  const pins = useMemo(() => {
    const places = results?.places ?? [];
    const shown = selection === null || places.some((p) => p.id === selection.place.id) ? places : [...places, selection.place];
    return shown.map((place) => ({ id: asPlaceId(`search:${place.id}`), kind: "search", glyph: searchPinGlyph(place.name, place.context, places.some((item) => item.id === place.id) ? results?.chip.id ?? null : null), coordinate: place.coordinate, pill: place.name, tone: "soon" as const, priority: 1000, selected: selection?.place.id === place.id }));
  }, [results, selection]);
  const intercept = useCallback((intent: MapIntent): boolean => {
    if (intent.type === "map-click") close();
    if (intent.type !== "place-click" || !intent.placeId.startsWith("search:")) return false;
    const match = results?.places.find((place) => `search:${place.id}` === intent.placeId) ?? selection?.place;
    if (match !== undefined && match !== null) open(match);
    return true;
  }, [close, results, selection, open]);
  const overlayPlace = useCallback((place: NearbyPlace) => open({ id: place.id, name: place.name, label: place.name, context: [place.category, place.address || place.city].filter(Boolean).join(" · "), coordinate: place.coordinate, provider: "places" }), [open]);
  const place = selection?.place;
  const travelKey = place === undefined || rider === null ? null : `${place.id}:${rider.lat}:${rider.lon}`;
  useEffect(() => {
    if (place === undefined || rider === null || services?.driveTime === undefined || travelKey === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    void services.driveTime(rider, place.coordinate, controller.signal).then((seconds) => {
      if (!controller.signal.aborted) setTravel({ key: travelKey, seconds });
    }).catch(() => undefined);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [place, rider, services, travelKey]);
  // Nearest first, like Google, when the rider's position is known; without
  // it the search's own order (its relevance and distances) stands.
  const sortedResults = useMemo(() => {
    const rows = (results?.places ?? []).map((entry) => ({ place: entry, miles: haversine(entry.coordinate, rider ?? bias) / 1609.344 }));
    return rider === null ? rows : rows.sort((a, b) => a.miles - b.miles);
  }, [results, rider, bias]);
  const sheet = place === undefined ? results === null ? null : <section className="og-category-results" data-testid="category-results" aria-label={`${results.chip.label} nearby`}>
    <h2>{results.chip.label}</h2><button type="button" className="og-place-sheet__close" aria-label="Close results" onClick={close}>×</button>
    {results.status === "searching" ? <p role="status">Searching…</p> : results.status === "unavailable" ? <p role="status">{results.message}</p> : results.places.length === 0 ? <>
      <p>{results.chip.empty}</p>
      <button type="button" className="og-secondary" data-testid="search-this-area" onClick={searchThisArea}>Search this area</button>
    </> : <ul>{sortedResults.map(({ place, miles }) => <li key={place.id} className="og-result-row">
      <button type="button" className="og-result-row__main" data-testid="category-result" aria-current={selection?.place.id === place.id ? "true" : undefined} onClick={() => open(place)}>
        <strong>{place.name}</strong>
        <span className="og-result-row__meta">
          {resultMeta(place.context, rider === null ? null : miles)}
        </span>
        {place.openNow === undefined ? null : <span className="og-result-row__open" data-open={place.openNow ? "true" : "false"}>{place.openNow ? "Open now" : "Closed now"}</span>}
      </button>
      {/* Google's per-row Directions: straight to the ride, no card first. */}
      <button type="button" className="og-result-row__go" data-testid="category-result-directions" aria-label={`Directions to ${place.name}`} title="Directions" onClick={() => void directions(place)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20v-6a4 4 0 0 1 4-4h10M14 6l4 4-4 4"/></svg>
      </button>
    </li>)}</ul>}
  </section> : <PlaceSheet key={place.id} place={place} rider={rider} busy={busy} driveTime={travel?.key === travelKey && travel?.seconds != null ? `${formatDuration(travel.seconds)} drive` : null}
    saved={services?.memory === undefined ? false : isSaved(services.memory.read(), place.coordinate)}
    onDirections={() => void directions(place)}
    onAddStop={hasRoute ? () => edit(() => { const doc = rideStore.getState().document; const command = insertStopCommand(doc, place.coordinate, undefined); rideStore.getState().dispatch({ ...command, stop: { ...command.stop, label: place.label } }); }, "Stop added") : undefined}
    onStart={selection?.dropped || selection?.slot === "start" ? () => edit(() => { const doc = rideStore.getState().document; rideStore.getState().dispatch(selection?.dropped ? placeStartCommand(doc, place.coordinate) : searchedEndpointCommand(doc, "start", { ...place, placeId: place.id }, place.label)); }, "Start set") : undefined}
    onSave={() => { if (services?.memory === undefined) { toast("Saving places is unavailable here."); return; } services.memory.toggleSaved(place); toast("Saved places updated"); }}
    onShare={() => void sharePlace(place)}
    onClose={close}/>;
  return { composerSearch, sheet, dismissSheet: close, pins, intercept, pointAction, overlayPlace, optionsOpen,
    /** Leaves the Directions options view (the route was closed). */
    closeOptions: () => setOptionsOpen(false), onViewport: setExtent,
    top: search === undefined ? null : <TopSearch search={{ ...search, bias, onPick: pick }} onSearchList={searchList} bias={bias} selected={selection !== null || results !== null} activeChip={results?.chip.id ?? null} layerOn={(layer) => layers.enabled.includes(layer)} onClear={close} onChip={category} onLayer={toggleLayer} route={route ?? null} mapLayers={mapLayers}/>,
    toast: notice === null ? null : <RiderToast notice={notice} onDismiss={dismissToast}/> };
}
