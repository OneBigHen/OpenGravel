"use client";

import { useCallback, useEffect, useMemo, type ComponentProps } from "react";

import type { MapIntent } from "@/application/map/types";
import {
  PLANNER_PLACES_PREFERENCE_KEY,
  type NearbyPlace,
  type PlacesSource,
} from "@/application/places";
import { PlannerMap } from "@/ui/map/PlannerMap";
import { LayeredMap, type MapLayersProps } from "@/ui/layers/LayeredMap";

import { PlaceCard } from "./PlaceCard";
import { PlacesControl } from "./PlacesControl";
import { PlacesSheetRows } from "./PlacesSheetRows";
import { usePlacesOverlay } from "./usePlacesOverlay";

/** Planning is for later today as often as for now, so the planner opens on today. */
const PLANNER_PLACES_QUERY = { kinds: ["happy_hour", "event"] as const, window: "today" as const };

type PlannerMapProps = ComponentProps<typeof PlannerMap>;

export interface PlannerPlacesProps {
  readonly source: PlacesSource;
  readonly onOpenPlace?: (place: NearbyPlace) => void;
  /** "Add as stop" on a place card: the existing typed stop command. */
  readonly onAddStop: (place: NearbyPlace) => void;
  /**
   * Map taps are armed for placing points (Breadcrumb): a tap on a pin is a tap
   * on the map there, so it adds a waypoint instead of opening the place.
   */
  readonly inert?: boolean;
}

/**
 * The planner map with the sample places provider places overlay (OGV-D-274):
 * happy-hour and event pills on the map, a Places toggle, and a place card that
 * can add the place to the ride as a stop. Places are provider data, never ride
 * state — the only way one reaches the document is the rider's "Add as stop".
 * Without a source this is the plain planner map.
 */
export function PlannerPlacesMap({
  places,
  layers,
  ...map
}: PlannerMapProps & {
  readonly places?: PlannerPlacesProps | undefined;
  readonly layers?: MapLayersProps | undefined;
}) {
  if (places === undefined) return <LayeredMap {...map} layers={layers} mapStyleInSheet />;
  return <PlannerMapWithPlaces map={map} places={places} layers={layers} />;
}

function PlannerMapWithPlaces({
  map,
  places: { source, onAddStop, onOpenPlace, inert = false },
  layers,
}: {
  readonly map: PlannerMapProps;
  readonly places: PlannerPlacesProps;
  readonly layers: MapLayersProps | undefined;
}) {
  const selectedLine = map.scene.routes.find((route) => route.id === map.scene.selectedRouteId)?.geometry;
  const places = usePlacesOverlay({
    source,
    initialQuery: PLANNER_PLACES_QUERY,
    storageKey: PLANNER_PLACES_PREFERENCE_KEY,
    enabledByDefault: true,
    nearLine: selectedLine,
  });
  const { selectedPlace, clear: clearPlace } = places;
  useEffect(() => {
    if (selectedPlace === null || onOpenPlace === undefined) return;
    onOpenPlace(selectedPlace);
    clearPlace();
  }, [selectedPlace, clearPlace, onOpenPlace]);
  const scene = useMemo(
    () => ({ ...map.scene, places: [...(places.scenePlaces ?? []), ...(map.scene.places ?? [])] }),
    [places.scenePlaces, map.scene],
  );
  const { interceptIntent } = places;
  const { onIntent } = map;
  const intercept = useCallback(
    (intent: MapIntent): void => {
      if (intent.type === "place-click" && inert) { onIntent({ type: "map-click", coordinate: intent.coordinate }); return; }
      if (intent.type === "place-click" && intent.placeId.startsWith("search:")) { onIntent(intent); return; }
      if (intent.type === "place-click" && onOpenPlace !== undefined) {
        const place = places.scenePlaces?.some((p) => p.id === intent.placeId);
        if (place) { places.select(intent.placeId); return; }
      }
      const forwarded = interceptIntent(intent);
      if (forwarded !== null) onIntent(forwarded);
    },
    [inert, interceptIntent, onIntent, onOpenPlace, places],
  );
  const { clear } = places;
  const addStop = useCallback(
    (place: NearbyPlace): void => {
      onAddStop(place);
      clear();
    },
    [clear, onAddStop],
  );

  return (
    <>
      <LayeredMap
        {...map}
        scene={scene}
        onIntent={intercept}
        onViewport={(extent) => { places.onViewport(extent); map.onViewport?.(extent); }}
        layers={layers}
        mapStyleInSheet
        panelSettings={
          <PlacesSheetRows
            enabled={places.enabled}
            status={places.status}
            reason={places.reason}
            count={places.count}
            scope={places.scope}
            query={places.query}
            onToggle={places.toggle}
            setWindow={places.setWindow}
            setKinds={places.setKinds}
          />
        }
      />
      <div className="og-places-overlay og-places-overlay--planner" data-testid="places-overlay">
        <PlacesControl
          enabled={places.enabled}
          status={places.status}
          reason={places.reason}
          count={places.count}
          scope={places.scope}
          query={places.query}
          onToggle={places.toggle}
          setWindow={places.setWindow}
          setKinds={places.setKinds}
          collapsible
        />
        {onOpenPlace !== undefined || places.selectedPlace === null || places.selectedCard === null ? null : (
          <PlaceCard
            place={places.selectedPlace}
            card={places.selectedCard}
            attribution={places.attribution}
            onClose={places.clear}
            onAddStop={addStop}
          />
        )}
      </div>
    </>
  );
}
