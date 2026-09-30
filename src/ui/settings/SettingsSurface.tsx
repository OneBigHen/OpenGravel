"use client";

import { useState, type ReactNode } from "react";
import { AppBar } from "@/ui/nav/AppBar";
import {
  addBike,
  deleteBike,
  updateBike,
  validateBikeProfile,
  type BikeProfile,
  type Garage,
} from "@/application/garage/garage-model";
import type { OfflineRegionsPort } from "@/application/offline/offline-regions";
import { TELEMETRY_ACKNOWLEDGEMENT, type TelemetryConsentState } from "@/application/telemetry/consent";
import type { PlaceMatch } from "@/application/geocoding/place-search";
import { HomeSearch } from "./HomeSearch";
import { OfflineMapsSection } from "@/ui/settings/OfflineMapsSection";
import { AppearanceSection } from "@/ui/settings/AppearanceSection";
import { FeedbackSection } from "@/ui/settings/FeedbackSection";
import { InstallSection } from "@/ui/settings/InstallSection";
import { NavScreenSection } from "@/ui/settings/NavScreenSection";
import { DeviceSyncSection } from "@/ui/settings/DeviceSyncSection";

type BikeForm = Omit<BikeProfile, "id">;
const NEW_BIKE: BikeForm = {
  name: "",
  category: "adventure",
  fuelRangeMiles: 150,
  reserveMiles: 30,
  maintainedGravel: "allow",
  roughTracks: "avoid",
  unknownSurface: "allow-with-warning",
};

export interface SettingsSurfaceProps {
  readonly spotifySetup?: ReactNode;
  readonly garage: Garage;
  /** In the app: choose OpenGravel's ride screen or the native one. */
  readonly showNavScreen?: boolean;
  readonly onGarageChange: (garage: Garage) => void;
  readonly telemetryConsent?: TelemetryConsentState;
  readonly onTelemetryConsentChange?: (state: TelemetryConsentState) => void;
  readonly satellitePreferred?: boolean;
  readonly onSatellitePreferredChange?: (preferred: boolean) => void;
  readonly homeSaved?: boolean;
  /** The saved Home's place name, when it has one (RS-13). */
  readonly homeLabel?: string | null;
  readonly homeBusy?: boolean;
  /** Feedback for the Home action, shown where the rider just acted. */
  readonly homeFeedback?: string | null;
  readonly onSearchHome?: (query: string) => Promise<readonly PlaceMatch[]>;
  readonly onPickHome?: (place: PlaceMatch) => void;
  readonly onUseCurrentLocationAsHome?: () => void;
  readonly onClearHome?: () => void;
  readonly onExport?: () => void;
  readonly onDeleteAll?: () => void;
  readonly statusMessage?: string | null;
  /** Offline areas; the section is hidden where the device cannot store them. */
  readonly offlineRegions?: OfflineRegionsPort | null;
}

export function SettingsSurface({
  spotifySetup,
  garage,
  showNavScreen = false,
  onGarageChange,
  telemetryConsent = { status: "unacknowledged" },
  onTelemetryConsentChange,
  satellitePreferred = false,
  onSatellitePreferredChange,
  homeSaved = false,
  homeLabel = null,
  homeBusy = false,
  homeFeedback = null,
  onSearchHome,
  onPickHome,
  onUseCurrentLocationAsHome,
  onClearHome,
  onExport,
  onDeleteAll,
  statusMessage,
  offlineRegions = null,
}: SettingsSurfaceProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<BikeForm>(NEW_BIKE);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [bikeToDelete, setBikeToDelete] = useState<string | null>(null);

  function beginAdd(): void {
    setEditorOpen(true);
    setEditingId(null);
    setForm(NEW_BIKE);
    setFormError(null);
  }

  function beginEdit(bike: BikeProfile): void {
    setEditorOpen(true);
    setEditingId(bike.id);
    setForm({
      name: bike.name,
      category: bike.category,
      fuelRangeMiles: bike.fuelRangeMiles,
      reserveMiles: bike.reserveMiles,
      maintainedGravel: bike.maintainedGravel,
      roughTracks: bike.roughTracks,
      unknownSurface: bike.unknownSurface,
      ...(bike.custom === undefined ? {} : { custom: bike.custom }),
    });
    setFormError(null);
  }

  function saveBike(): void {
    const errors = validateBikeProfile(form);
    if (errors.length > 0) {
      setFormError(errors[0] ?? "Check the bike details.");
      return;
    }
    const profile: BikeProfile = {
      ...form,
      id: editingId ?? `bike_${crypto.randomUUID()}`,
      name: form.name.trim(),
    };
    onGarageChange(editingId === null ? addBike(garage, profile) : updateBike(garage, profile));
    setEditingId(null);
    setEditorOpen(false);
    setForm(NEW_BIKE);
    setFormError(null);
  }

  function confirmBikeDelete(): void {
    if (bikeToDelete === null) return;
    const result = deleteBike(garage, bikeToDelete);
    if (!result.ok) {
      setFormError("Keep at least one bike in your garage.");
      return;
    }
    onGarageChange(result.garage);
    setBikeToDelete(null);
  }

  return (
    <main id="main" className="og-settings">
      <AppBar current="/settings" />
      <header className="og-settings__header">
        <div>
          <p className="og-settings__eyebrow">YOUR GARAGE</p>
          <h1>Settings</h1>
          <p>Set up your bikes and choose how OpenGravel works on this device.</p>
        </div>
      </header>

      <div className="og-settings__layout">
        <AppearanceSection />
        {showNavScreen ? <NavScreenSection /> : null}
        <InstallSection />
        <DeviceSyncSection />
        {spotifySetup}

        <section className="og-settings__section" aria-labelledby="settings-bikes-title">
          <div className="og-settings__section-heading">
            <div><p className="og-settings__eyebrow">GARAGE</p><h2 id="settings-bikes-title">Your bikes</h2></div>
            <button className="og-settings__button og-settings__button--quiet" type="button" onClick={beginAdd}>Add bike</button>
          </div>
          <p className="og-settings__section-copy">A ride keeps the bike settings it was planned with. Changing your garage affects new rides.</p>
          <ul className="og-settings__bike-list">
            {garage.bikes.map((bike) => (
              <li className="og-settings__bike" key={bike.id}>
                <div className="og-settings__bike-main">
                  <div><h3>{bike.name}</h3><p>{bike.category === "dual-sport" ? "Dual-sport" : bike.category[0]!.toUpperCase() + bike.category.slice(1)} · {bike.fuelRangeMiles} mi range · {bike.reserveMiles} mi reserve</p></div>
                  {garage.activeBikeId === bike.id ? <span className="og-settings__active">Active</span> : <button className="og-settings__text-button" type="button" onClick={() => onGarageChange({ ...garage, activeBikeId: bike.id })}>Make active</button>}
                </div>
                <div className="og-settings__bike-details"><span>Gravel {bike.maintainedGravel === "allow" ? "allowed" : "avoided"}</span><span>Rough tracks {bike.roughTracks === "allow" ? "allowed" : "avoided"}</span><span>Unknown: {bike.unknownSurface === "allow-with-warning" ? "allow with warning" : "avoid when possible"}</span></div>
                <div className="og-settings__bike-actions"><button className="og-settings__text-button" type="button" onClick={() => beginEdit(bike)}>Edit</button>{garage.bikes.length > 1 ? <button className="og-settings__text-button og-settings__text-button--danger" type="button" onClick={() => { setBikeToDelete(bike.id); setFormError(null); }}>Delete</button> : <span className="og-settings__hint">Your only bike: add another before deleting this one.</span>}</div>
              </li>
            ))}
          </ul>
          {editorOpen ? (
            <div className="og-settings__editor" aria-label="Bike editor">
              <h3>{editingId === null ? "Add a bike" : "Edit bike"}</h3>
              <label>Bike name<input aria-label="Bike name" value={form.name} maxLength={60} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as BikeProfile["category"] })}><option value="street">Street</option><option value="touring">Touring</option><option value="adventure">Adventure</option><option value="dual-sport">Dual-sport</option></select></label>
              <div className="og-settings__field-row"><label>Fuel range (miles)<input type="number" min={20} max={600} value={form.fuelRangeMiles} onChange={(event) => setForm({ ...form, fuelRangeMiles: Number(event.target.value) })} /></label><label>Reserve (miles)<input type="number" min={0} max={100} value={form.reserveMiles} onChange={(event) => setForm({ ...form, reserveMiles: Number(event.target.value) })} /></label></div>
              <label>Maintained gravel<select value={form.maintainedGravel} onChange={(event) => setForm({ ...form, maintainedGravel: event.target.value as BikeProfile["maintainedGravel"] })}><option value="allow">Allow maintained gravel</option><option value="avoid">Avoid maintained gravel</option></select></label>
              <label>Rough tracks<select value={form.roughTracks} onChange={(event) => setForm({ ...form, roughTracks: event.target.value as BikeProfile["roughTracks"] })}><option value="allow">Allow rough tracks</option><option value="avoid">Avoid rough tracks</option></select></label>
              <label>Unknown surfaces<select value={form.unknownSurface} onChange={(event) => setForm({ ...form, unknownSurface: event.target.value as BikeProfile["unknownSurface"] })}><option value="allow-with-warning">Allow with a warning</option><option value="avoid-when-possible">Avoid when possible</option></select></label>
              {formError !== null && <p className="og-settings__error" role="alert">{formError}</p>}
              <div className="og-settings__editor-actions"><button className="og-settings__button" type="button" onClick={saveBike}>Save bike</button><button className="og-settings__button og-settings__button--quiet" type="button" onClick={() => { setEditingId(null); setEditorOpen(false); setForm(NEW_BIKE); setFormError(null); }}>Cancel</button></div>
            </div>
          ) : null}
          {bikeToDelete !== null && <div className="og-settings__confirm" role="group" aria-label="Delete bike confirmation"><p>Delete this bike from your garage?</p>{formError !== null && <p className="og-settings__error" role="alert">{formError}</p>}<button type="button" className="og-settings__text-button" onClick={confirmBikeDelete}>Confirm bike delete</button><button type="button" className="og-settings__text-button" onClick={() => { setBikeToDelete(null); setFormError(null); }}>Cancel</button></div>}
        </section>

        <section className="og-settings__section" aria-labelledby="settings-home-title">
          <div className="og-settings__section-heading">
            <div><p className="og-settings__eyebrow">RETURN ROUTING</p><h2 id="settings-home-title">Home</h2></div>
            <span className="og-settings__status" data-testid="settings-home-status">{homeSaved ? (homeLabel ?? "Saved on this device") : "Not set"}</span>
          </div>
          <p className="og-settings__section-copy">Head Home uses this location when you choose it during a Free Ride. Your Home stays on this device.</p>
          <div className="og-settings__home-actions">
            <button
              className="og-settings__button"
              type="button"
              data-testid="settings-save-home"
              disabled={homeBusy || onUseCurrentLocationAsHome === undefined}
              onClick={onUseCurrentLocationAsHome}
            >
              {homeBusy ? "Getting location…" : "Use my current location as Home"}
            </button>
            <button
              className="og-settings__button og-settings__button--quiet"
              type="button"
              data-testid="settings-clear-home"
              disabled={!homeSaved || homeBusy || onClearHome === undefined}
              onClick={onClearHome}
            >
              Clear
            </button>
          </div>
          {homeFeedback === null ? null : (
            <p className="og-settings__home-feedback" role="status" data-testid="settings-home-feedback">{homeFeedback}</p>
          )}
          {onSearchHome === undefined || onPickHome === undefined ? null : (
            <HomeSearch onSearch={onSearchHome} onPick={onPickHome} />
          )}
        </section>

        {offlineRegions !== null ? <OfflineMapsSection regions={offlineRegions} /> : null}

        <section className="og-settings__section" aria-labelledby="settings-units-title">
          <div className="og-settings__section-heading"><div><p className="og-settings__eyebrow">DISPLAY</p><h2 id="settings-units-title">Units</h2></div></div>
          <label>Distance units<select aria-label="Distance units" value="miles" disabled><option value="miles">Miles</option></select></label>
          <p className="og-settings__section-copy">Distances are shown in miles throughout OpenGravel.</p>
        </section>

        <section className="og-settings__section" aria-labelledby="settings-map-title">
          <div className="og-settings__section-heading"><div><p className="og-settings__eyebrow">MAP</p><h2 id="settings-map-title">Default map style</h2></div></div>
          <label>Map style<select aria-label="Default map style" value={satellitePreferred ? "satellite" : "map"} onChange={(event) => onSatellitePreferredChange?.(event.target.value === "satellite")}><option value="map">Map</option><option value="satellite">Satellite</option></select></label>
          <p className="og-settings__section-copy">Satellite imagery is available when this device has a supported basemap.</p>
        </section>

        <section className="og-settings__section" aria-labelledby="settings-privacy-title">
          <div className="og-settings__section-heading"><div><p className="og-settings__eyebrow">PRIVACY</p><h2 id="settings-privacy-title">Usage data</h2></div><span className="og-settings__status">{telemetryConsent.status === "acknowledged" ? "Acknowledged" : "Off"}</span></div>
          <p>{TELEMETRY_ACKNOWLEDGEMENT.collectedSummary}</p><p className="og-settings__section-copy">{TELEMETRY_ACKNOWLEDGEMENT.neverCollectedSummary}</p><p className="og-settings__section-copy">{TELEMETRY_ACKNOWLEDGEMENT.mapContextDisclosure}</p>
          <label className="og-settings__check"><input type="checkbox" checked={telemetryConsent.status === "acknowledged"} onChange={(event) => onTelemetryConsentChange?.(event.target.checked ? { status: "acknowledged", acknowledgedAt: new Date().toISOString(), policyVersion: 1 } : { status: "unacknowledged" })} />I understand and acknowledge this collection</label>
          <p className="og-settings__section-copy">{TELEMETRY_ACKNOWLEDGEMENT.offUntilAcknowledgedNote}</p>
        </section>

        <FeedbackSection />

        <section className="og-settings__section og-settings__section--data" aria-labelledby="settings-data-title">
          <div className="og-settings__section-heading"><div><p className="og-settings__eyebrow">LOCAL FIRST</p><h2 id="settings-data-title">Your data</h2></div></div>
          <p>Rides are stored on this device. Export to keep a copy. Your export also includes your garage and device preferences.</p>
          <button className="og-settings__button og-settings__button--quiet" type="button" onClick={onExport}>Export all data</button>
          {statusMessage && <p className="og-settings__section-copy" role="status">{statusMessage}</p>}
          <div className="og-settings__danger-zone"><h3>Delete local data</h3><p>This removes saved rides, drafts, garage settings and preferences from this device.</p>
            {onDeleteAll !== undefined && <>{deleteConfirmationOpen ? <><label htmlFor="settings-delete-confirm">Type DELETE to confirm</label><input id="settings-delete-confirm" aria-label="Type DELETE to confirm" autoComplete="off" value={confirmDelete} onChange={(event) => setConfirmDelete(event.target.value)} /><button className="og-settings__button og-settings__button--danger" type="button" disabled={confirmDelete !== "DELETE"} onClick={onDeleteAll}>Confirm delete</button></> : <button className="og-settings__button og-settings__button--danger" type="button" onClick={() => setDeleteConfirmationOpen(true)}>Delete all data</button>}</>}
          </div>
        </section>
      </div>
    </main>
  );
}
