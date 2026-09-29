"use client";

import { useCallback, useMemo } from "react";

import type { MapExtent } from "@/application/map/build-map-scene";
import type { MapLoadStatus, MapHostFactory, BasemapMode } from "@/application/map/map-host";
import type { MapIntent, MapScene } from "@/application/map/types";
import type { MapInsets } from "@/application/map/insets";
import type { RideCamera } from "@/application/map/ride-camera";
import { RIDE_PLACES_PREFERENCE_KEY, type PlacesSource } from "@/application/places";
import { LayeredMap, type MapLayersProps } from "@/ui/layers/LayeredMap";

import { PlaceCard } from "./PlaceCard";
import { PlacesControl } from "./PlacesControl";
import { usePlacesOverlay } from "./usePlacesOverlay";

const RIDE_PLACES_QUERY = { kinds: ["happy_hour"] as const, window: "now" as const };

export interface RidePlacesMapProps {
  readonly source: PlacesSource;
  readonly scene: MapScene;
  readonly onIntent: (intent: MapIntent) => void;
  readonly hostFactory: MapHostFactory;
  readonly basemap: BasemapMode;
  readonly assetBasePath?: string;
  readonly insets: MapInsets;
  readonly fitKey: string | null;
  readonly fitExtent: MapExtent | null;
  readonly followCamera?: { readonly key: string; readonly camera: RideCamera } | null;
  readonly onLoadStatus: (status: MapLoadStatus) => void;
  /** The rider's map layers (phase 8): fuel, incidents and alerts on the ride. */
  readonly layers?: MapLayersProps | undefined;
}

export function RidePlacesMap({
  source,
  scene,
  onIntent,
  hostFactory,
  basemap,
  assetBasePath,
  insets,
  fitKey,
  fitExtent,
  followCamera = null,
  onLoadStatus,
  layers,
}: RidePlacesMapProps) {
  const places = usePlacesOverlay({
    source,
    initialQuery: RIDE_PLACES_QUERY,
    storageKey: RIDE_PLACES_PREFERENCE_KEY,
    enabledByDefault: true,
  });
  // OGV#13: ride-interest pins arrive already merged into `scene.places` (the
  // ride surface builds that scene); the happy-hour/events overlay adds its
  // own on top rather than replacing them.
  const mapScene = useMemo(
    () => ({ ...scene, places: [...(scene.places ?? []), ...(places.scenePlaces ?? [])] }),
    [places.scenePlaces, scene],
  );
  const interceptIntent = places.interceptIntent;
  const intercept = useCallback((intent: MapIntent): void => {
    // A ride-interest pin (OGV#13) is drawn through this same source but owned
    // by the ride surface, not the places overlay: let it through untouched.
    if (intent.type === "place-click" && intent.placeId.startsWith("ri:")) {
      onIntent(intent);
      return;
    }
    const forwarded = interceptIntent(intent);
    if (forwarded !== null) onIntent(forwarded);
  }, [interceptIntent, onIntent]);

  return (
    <>
      <LayeredMap
        layers={layers}
        scene={mapScene}
        label="Ride map with the route you are following and your current position"
        onIntent={intercept}
        onViewport={places.onViewport}
        hostFactory={hostFactory}
        {...(assetBasePath === undefined ? {} : { assetBasePath })}
        activeTool="pan"
        basemap={basemap}
        insets={insets}
        dimmed={false}
        fitKey={fitKey}
        fitExtent={fitExtent}
        followCamera={followCamera}
        onLoadStatus={onLoadStatus}
      />
      <div className="og-places-overlay" data-testid="places-overlay">
        <PlacesControl
          enabled={places.enabled}
          status={places.status}
          reason={places.reason}
          count={places.count}
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
          />
        )}
      </div>
    </>
  );
}
