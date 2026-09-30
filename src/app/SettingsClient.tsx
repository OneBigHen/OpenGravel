"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createLibraryService } from "@/application/library/library-service";
import { SATELLITE_PREFERENCE_KEY } from "@/application/map/preferences";
import { createGarage, type Garage } from "@/application/garage/garage-model";
import type { TelemetryConsentState } from "@/application/telemetry/consent";
import type { TelemetryConsentRead } from "@/application/telemetry/ports/telemetry-consent-store";
import { createLocalStorageTelemetryConsentStore } from "@/infrastructure/telemetry/local-storage-consent-store";
import { createLocalStorageGarageStorage } from "@/infrastructure/storage/garage-storage";
import { createHomeLocationStorage } from "@/infrastructure/storage/home-location-storage";
import { createLocalStorageRiderSettings } from "@/infrastructure/storage/rider-settings-storage";
import { createHttpPlaceSearch, type PlaceMatch } from "@/application/geocoding/place-search";
import { createBrowserCurrentLocationSource } from "@/infrastructure/ride/browser-current-location";
import { createLocalStorageBootstrapPointer } from "@/infrastructure/storage/bootstrap-pointer";
import { createLocalStorageRideFocusPointer } from "@/infrastructure/storage/ride-focus-pointer";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";
import { rideFocusGeometryRefs } from "@/application/persistence/ride-focus-pointer";
import { clearAllLocalData } from "@/infrastructure/storage/clear-all-local-data";
import type { OfflineRegionsPort } from "@/application/offline/offline-regions";
import { OfflineAreaStore } from "@/infrastructure/offline/offline-area-store";
import { SettingsSurface } from "@/ui/settings/SettingsSurface";
import { nativeNavigationBridge } from "@/infrastructure/native/ferrostar-bridge";
import { SpotifySetupSection } from "@/ui/settings/SpotifySetupSection";
import { clearSpotifyClientId, readSpotifyClientId, saveSpotifyClientId } from "@/infrastructure/spotify/client-id-storage";

function consentState(read: TelemetryConsentRead): TelemetryConsentState {
  return read.status === "found" ? read.state : { status: "unacknowledged" };
}

function readSatellitePreference(): boolean {
  try {
    return window.localStorage.getItem(SATELLITE_PREFERENCE_KEY) === "1";
  } catch {
    return false;
  }
}

const noSubscription = (): (() => void) => () => undefined;

export function SettingsClient() {
  const garageStorage = useMemo(() => createLocalStorageGarageStorage(), []);
  const homeStorage = useMemo(() => createHomeLocationStorage(), []);
  const currentLocation = useMemo(() => createBrowserCurrentLocationSource(), []);
  const consentStore = useMemo(() => createLocalStorageTelemetryConsentStore(), []);
  const rideFocusPointer = useMemo(() => createLocalStorageRideFocusPointer(), []);
  const repository = useMemo(
    () => createRideRepository({
      bootstrapPointer: createLocalStorageBootstrapPointer(),
      protectedGeometryRefs: () => rideFocusGeometryRefs(rideFocusPointer),
    }),
    [rideFocusPointer],
  );
  const library = useMemo(() => createLibraryService(repository), [repository]);
  const [garage, setGarage] = useState<Garage>(createGarage);
  const [consent, setConsent] = useState<TelemetryConsentState>({ status: "unacknowledged" });
  const [satellitePreferred, setSatellitePreferred] = useState(false);
  const [homeSaved, setHomeSaved] = useState(false);
  const [homeLabel, setHomeLabel] = useState<string | null>(null);
  const placeSearch = useMemo(() => createHttpPlaceSearch(), []);
  const [homeBusy, setHomeBusy] = useState(false);
  const [homeFeedback, setHomeFeedback] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [offlineRegions, setOfflineRegions] = useState<OfflineRegionsPort | null>(null);
  // The server render never knows it is inside the app.
  const inApp = useSyncExternalStore(noSubscription, () => nativeNavigationBridge() !== undefined, () => false);

  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    const store = new OfflineAreaStore();
    const frame = window.requestAnimationFrame(() => setOfflineRegions(store));
    return () => {
      window.cancelAnimationFrame(frame);
      store.close();
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setGarage(garageStorage.read());
      setConsent(consentState(consentStore.read()));
      setSatellitePreferred(readSatellitePreference());
      const home = homeStorage.read();
      setHomeSaved(home.status === "found");
      setHomeLabel(home.status === "found" ? home.label : null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [garageStorage, consentStore, homeStorage]);

  function saveGarage(next: Garage): void {
    setGarage(next);
    garageStorage.write(next);
  }

  function saveConsent(next: TelemetryConsentState): void {
    setConsent(next);
    consentStore.write(next);
  }

  function saveSatellitePreference(next: boolean): void {
    setSatellitePreferred(next);
    try {
      window.localStorage.setItem(SATELLITE_PREFERENCE_KEY, next ? "1" : "0");
    } catch {
      setStatusMessage("The map preference could not be saved in this browser.");
    }
  }

  async function exportAllData(): Promise<void> {
    setStatusMessage(null);
    try {
      const summaries = await library.listRides();
      const rides = await Promise.all(summaries.map(async (summary) => {
        const record = await repository.loadRideRecord(summary.rideId);
        const exportSource = library.loadExportSource === undefined
          ? null
          : await library.loadExportSource(summary.rideId);
        return { summary, record, exportSource };
      }));
      const savedHome = homeStorage.read();
      const payload = {
        format: "opengravel-local-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        rides,
        garage,
        preferences: {
          distanceUnits: "miles",
          defaultMapStyle: satellitePreferred ? "satellite" : "map",
          telemetryConsent: consent,
          home: savedHome.status === "found" ? savedHome.coordinate : null,
          riderSettings: createLocalStorageRiderSettings().read(),
        },
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `opengravel-data-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatusMessage("Your data export was downloaded.");
    } catch {
      setStatusMessage("Could not export your data. Your local rides were left unchanged.");
    }
  }

  async function deleteAllData(): Promise<void> {
    setStatusMessage(null);
    setHomeFeedback(null);
    try {
      await clearAllLocalData();
      setGarage(createGarage());
      setConsent({ status: "unacknowledged" });
      setSatellitePreferred(false);
      setHomeSaved(false);
      setHomeLabel(null);
      setStatusMessage("Deleted this device's OpenGravel data: rides, route geometry, sessions, recordings, imports, road and share records, bikes, Home, map and telemetry preferences, saved place names, and ride pointers.");
    } catch {
      setStatusMessage("Could not delete all local data. Some data may remain on this device.");
    }
  }

  async function saveCurrentLocationAsHome(): Promise<void> {
    setHomeBusy(true);
    setHomeFeedback(null);
    try {
      const coordinate = await currentLocation.read();
      // Name the spot, so Settings can say which Home it keeps (RS-13).
      const named = await placeSearch.reverse(coordinate).catch(() => null);
      const label = named?.label ?? null;
      if (!homeStorage.write(coordinate, label)) {
        setHomeFeedback("Home could not be saved in this browser.");
        return;
      }
      setHomeSaved(true);
      setHomeLabel(label);
      setHomeFeedback(label === null ? "Your current location is saved as Home on this device." : `Home is set to ${label}.`);
    } catch (error: unknown) {
      setHomeFeedback(error instanceof Error && error.message === "location-denied"
        ? "Location access was denied. Allow it in your browser settings, then try again."
        : "Current location is unavailable. Check GPS and try again.");
    } finally {
      setHomeBusy(false);
    }
  }

  /** Home from a place search (RS-04), not only from where the phone is now. */
  async function searchHome(query: string): Promise<readonly PlaceMatch[]> {
    const outcome = await placeSearch.search(query);
    return outcome.status === "ok" ? outcome.places.slice(0, 5) : [];
  }

  function pickHome(place: PlaceMatch): void {
    if (!homeStorage.write(place.coordinate, place.label)) {
      setHomeFeedback("Home could not be saved in this browser.");
      return;
    }
    setHomeSaved(true);
    setHomeLabel(place.label);
    setHomeFeedback(`Home is set to ${place.label}.`);
  }

  function clearHome(): void {
    if (!homeStorage.clear()) {
      setHomeFeedback("Home could not be cleared in this browser.");
      return;
    }
    setHomeSaved(false);
    setHomeLabel(null);
    setHomeFeedback("Saved Home was cleared from this device.");
  }

  return <SettingsSurface
    spotifySetup={<SpotifySetupSection readClientId={readSpotifyClientId} saveClientId={saveSpotifyClientId} clearClientId={clearSpotifyClientId} />}
    garage={garage}
    showNavScreen={inApp}
    onGarageChange={saveGarage}
    telemetryConsent={consent}
    onTelemetryConsentChange={saveConsent}
    satellitePreferred={satellitePreferred}
    onSatellitePreferredChange={saveSatellitePreference}
    homeSaved={homeSaved}
    homeLabel={homeLabel}
    onSearchHome={searchHome}
    onPickHome={pickHome}
    homeBusy={homeBusy}
    homeFeedback={homeFeedback}
    onUseCurrentLocationAsHome={() => void saveCurrentLocationAsHome()}
    onClearHome={clearHome}
    onExport={() => void exportAllData()}
    onDeleteAll={() => void deleteAllData()}
    statusMessage={statusMessage}
    offlineRegions={offlineRegions}
  />;
}
