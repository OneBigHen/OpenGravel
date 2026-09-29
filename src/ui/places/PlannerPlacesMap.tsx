"use client";

import { useCallback, useMemo, type ComponentProps } from "react";

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
import { usePlacesOverlay } from "./usePlacesOverlay";

/** Planning is for later today as often as for now, so the planner opens on today. */
const PLANNER_PLACES_QUERY = { kinds: ["happy_hour", "event"] as const, window: "today" as const };

type PlannerMapProps = ComponentProps<typeof PlannerMap>;

export interface PlannerPlacesProps {
  readonly source: PlacesSource;
  /** "Add as stop" on a place card: the existing typed stop command. */
  readonly onAddStop: (place: NearbyPlace) => void;
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
  if (places === undefined) return <LayeredMap {...map} layers={layers} />;
  return <PlannerMapWithPlaces map={map} places={places} layers={layers} />;
}

function PlannerMapWithPlaces({
  map,
  places: { source, onAddStop },
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
  const scene = useMemo(
    () => ({ ...map.scene, places: places.scenePlaces }),
    [places.scenePlaces, map.scene],
  );
  const { interceptIntent } = places;
  const { onIntent } = map;
  const intercept = useCallback(
    (intent: MapIntent): void => {
      const forwarded = interceptIntent(intent);
      if (forwarded !== null) onIntent(forwarded);
    },
    [interceptIntent, onIntent],
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
      <LayeredMap {...map} scene={scene} onIntent={intercept} onViewport={places.onViewport} layers={layers} />
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
        {places.selectedPlace === null || places.selectedCard === null ? null : (
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
