"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlaceMatch } from "@/application/geocoding/place-search";
import { formatDuration } from "@/application/planner/measurements";
import { isSaved } from "@/application/geocoding/place-memory";
import type { LocateOutcome } from "@/application/geocoding/locate-once";
import { DEFAULT_MAP_EXTENT, type MapExtent } from "@/application/map/build-map-scene";
import type { MapIntent, MapPointAction } from "@/application/map/types";
import { asPlaceId, type NearbyPlace } from "@/application/places";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import { directionsCommand, searchedEndpointCommand, insertStopCommand, placeStartCommand, type RideDocumentStore } from "@/ui/stores/ride-document-store";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";
import type { ComposerPlaceSearch, PlannerPlaceServices } from "@/ui/planner/usePlannerPlaces";
import { enableMapLayer } from "@/ui/layers/useMapLayers";
import { PlaceSheet, placeDistance } from "./PlaceSheet";
import { RiderToast, type ToastNotice } from "./RiderToast";
import { TopSearch, type SearchChip } from "./TopSearch";

type Selection = { readonly place: PlaceMatch; readonly dropped: boolean; readonly slot: "start" | "finish" };
type Results = { readonly chip: SearchChip; readonly places: readonly PlaceMatch[]; readonly message: string | null };

function pinAt(coordinate: Coordinate): PlaceMatch {
  return { id: `dropped:${coordinate.lat}:${coordinate.lon}`, provider: "map", name: "Dropped pin", label: "Dropped pin", context: "", coordinate };
}

export function usePlaceFlow({ services, search, rider, locateStart, rideStore, uiStore, hasRoute, onMapPointAction, onDirectionsReady }: {
  readonly onDirectionsReady: (document: RideDocument) => void;
  readonly services: PlannerPlaceServices | undefined;
  readonly search: ComposerPlaceSearch | undefined;
  readonly rider: Coordinate | null;
  readonly locateStart: () => Promise<LocateOutcome>;
  readonly rideStore: RideDocumentStore;
  readonly uiStore: PlannerUiStore;
  readonly hasRoute: boolean;
  readonly onMapPointAction: (action: MapPointAction, coordinate: Coordinate) => void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [extent, setExtent] = useState<MapExtent>(DEFAULT_MAP_EXTENT);
  const [busy, setBusy] = useState(false);
  const [travel, setTravel] = useState<{ readonly key: string; readonly seconds: number | null } | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [notice, setNotice] = useState<ToastNotice | null>(null);
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
    setSelection(null); setResults(null); setOptionsOpen(true);
    uiStore.getState().cancelPlacement();
    uiStore.getState().setSheetDetent("half");
    toast("Directions set", true);
    if (outcome.status === "located") onDirectionsReady(result.document);
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

  const pointAction = useCallback((action: MapPointAction, coordinate: Coordinate) => {
    if (action === "info") { open(pinAt(coordinate), "finish", true); return; }
    if (action === "finish" && !hasRoute && services !== undefined) { void directions(pinAt(coordinate)); return; }
    edit(() => onMapPointAction(action, coordinate), action === "start" ? "Start set" : action === "stop" ? "Stop added" : action === "loop" ? "Loop set" : "Destination set");
  }, [open, hasRoute, services, directions, edit, onMapPointAction]);

  const category = useCallback(async (chip: SearchChip) => {
    close(); setOptionsOpen(false);
    if (chip.id === "twisty" || chip.id === "gravel") {
      enableMapLayer(chip.id === "twisty" ? "great-roads" : "gravel");
      toast(chip.id === "twisty" ? "Twisty roads layer on. Zoom in to see roads." : "Gravel layer on. Zoom in to see roads.");
      return;
    }
    if (services === undefined) return;
    const controller = new AbortController(); request.current = controller;
    setResults({ chip, places: [], message: "Searching…" });
    uiStore.getState().setSheetDetent("half");
    try {
      const outcome = await services.search.search(chip.query, { bias, signal: controller.signal });
      if (controller.signal.aborted) return;
      setResults({ chip, places: outcome.status === "ok" ? outcome.places : [], message: outcome.status === "unavailable" ? outcome.reason : outcome.places.length === 0 ? "No places found here. Try moving the map." : null });
    } catch {
      if (!controller.signal.aborted) setResults({ chip, places: [], message: "Place search is unavailable right now." });
    }
  }, [close, toast, services, bias, uiStore]);

  const pick = useCallback((slot: "start" | "finish", place: PlaceMatch) => { open(place, slot); }, [open]);
  const composerSearch: ComposerPlaceSearch | undefined = search === undefined ? undefined : { ...search, bias, onPick: pick };
  const pins = useMemo(() => {
    const places = results?.places ?? [];
    const shown = selection === null || places.some((p) => p.id === selection.place.id) ? places : [...places, selection.place];
    return shown.map((place) => ({ id: asPlaceId(`search:${place.id}`), kind: "search", coordinate: place.coordinate, pill: place.name, tone: "soon" as const, priority: 1000, selected: selection?.place.id === place.id }));
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
  const sheet = place === undefined ? results === null ? null : <section className="og-category-results" data-testid="category-results" aria-label={`${results.chip.label} nearby`}>
    <h2>{results.chip.label}</h2><button type="button" className="og-place-sheet__close" aria-label="Close results" onClick={close}>×</button>
    {results.message === null ? null : <p role="status">{results.message}</p>}
    <ul>{results.places.map((place) => <li key={place.id}><button type="button" data-testid="category-result" onClick={() => open(place)}><strong>{place.name}</strong><span>{placeDistance(place.coordinate, rider) ?? place.context}</span>{place.openNow === undefined ? null : <span>{place.openNow ? "Open now" : "Closed now"}</span>}</button></li>)}</ul>
  </section> : <PlaceSheet key={place.id} place={place} rider={rider} busy={busy} driveTime={travel?.key === travelKey && travel?.seconds != null ? `${formatDuration(travel.seconds)} drive` : null}
    saved={services?.memory === undefined ? false : isSaved(services.memory.read(), place.coordinate)}
    onDirections={() => void directions(place)}
    onAddStop={hasRoute ? () => edit(() => { const doc = rideStore.getState().document; const command = insertStopCommand(doc, place.coordinate, undefined); rideStore.getState().dispatch({ ...command, stop: { ...command.stop, label: place.label } }); }, "Stop added") : undefined}
    onStart={selection?.dropped || selection?.slot === "start" ? () => edit(() => { const doc = rideStore.getState().document; rideStore.getState().dispatch(selection?.dropped ? placeStartCommand(doc, place.coordinate) : searchedEndpointCommand(doc, "start", { ...place, placeId: place.id }, place.label)); }, "Start set") : undefined}
    startLabel={selection?.dropped ? "Start here" : "Use as start"}
    onSave={() => { if (services?.memory === undefined) { toast("Saving places is unavailable here."); return; } services.memory.toggleSaved(place); toast("Saved places updated"); }}
    onShare={() => { const url = `https://www.google.com/maps/search/?api=1&query=${place.coordinate.lat},${place.coordinate.lon}`; void (async () => { try { if (navigator.share) await navigator.share({ title: place.name, url }); else { await navigator.clipboard.writeText(url); toast("Place link copied"); } } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) toast("Couldn't share this place. Try again."); } })(); }}
    onClose={close}/>;
  return { composerSearch, sheet, pins, intercept, pointAction, overlayPlace, optionsOpen, onViewport: setExtent,
    top: search === undefined ? null : <TopSearch search={{ ...search, bias, onPick: pick }} bias={bias} selected={selection !== null || results !== null} activeChip={results?.chip.id ?? null} onClear={close} onChip={(chip) => void category(chip)}/>,
    toast: notice === null ? null : <RiderToast notice={notice} onDismiss={dismissToast}/> };
}
