"use client";

import { ActivitySwitch } from "@/ui/planner/ActivitySwitch";
import { Fragment, useState, type ReactNode } from "react";
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
import { TELEMETRY_ACKNOWLEDGEMENT, telemetryGateOpen, acknowledgedConsentState, type TelemetryConsentState } from "@/application/telemetry/consent";
import type { PlaceMatch } from "@/application/geocoding/place-search";
import { HomeSearch } from "./HomeSearch";
import { OfflineMapsSection } from "@/ui/settings/OfflineMapsSection";
import { AppearanceRow } from "@/ui/settings/AppearanceSection";
import { FeedbackSection } from "@/ui/settings/FeedbackSection";
import { InstallSection } from "@/ui/settings/InstallSection";
import { NavScreenRow } from "@/ui/settings/NavScreenSection";
import { Chevron, SettingsGroup, SettingsRowButton } from "@/ui/settings/SettingsGroup";

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
  /** The last delete's outcome, shown in the danger zone where the rider acted. */
  readonly deleteResult?: DeleteResult | null;
  /** Bumped after a successful wipe: sections remount and re-read device storage. */
  readonly localDataEpoch?: number;
  /** Offline areas; the section is hidden where the device cannot store them. */
  readonly offlineRegions?: OfflineRegionsPort | null;
}

export interface DeleteResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * The destructive control keeps its own confirmation state so a successful wipe
 * (which bumps `localDataEpoch` and remounts the settings layout) returns to
 * the plain "Delete all data" row instead of leaving Confirm armed.
 */
function DangerZone({
  onDeleteAll,
  deleteResult,
}: {
  readonly onDeleteAll?: (() => void) | undefined;
  readonly deleteResult: DeleteResult | null;
}) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  return (
    <div className="og-settings__danger-zone">
      {deleteResult !== null && <p className="og-settings__note" role={deleteResult.ok ? "status" : "alert"}>{deleteResult.message}</p>}
      {onDeleteAll !== undefined && (confirmationOpen ? (
        <div className="og-settings__confirm">
          <p className="og-settings__note">Deletes rides, saved places, garage and settings from this device. This cannot be undone.</p>
          <label className="og-settings__field" htmlFor="settings-delete-confirm">Type DELETE to confirm
            <input id="settings-delete-confirm" aria-label="Type DELETE to confirm" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </label>
          <button className="og-settings__button og-settings__button--danger" type="button" disabled={confirmation !== "DELETE"} onClick={onDeleteAll}>Confirm delete</button>
        </div>
      ) : (
        <button className="og-settings__row og-settings__row--button og-settings__row--danger" type="button" onClick={() => setConfirmationOpen(true)}>
          <span className="og-settings__row-text"><span className="og-settings__row-label">Delete all data</span></span>
        </button>
      ))}
    </div>
  );
}

function categoryLabel(bike: BikeProfile): string {
  return bike.category === "dual-sport" ? "Dual-sport" : bike.category[0]!.toUpperCase() + bike.category.slice(1);
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
  deleteResult = null,
  localDataEpoch = 0,
  offlineRegions = null,
}: SettingsSurfaceProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<BikeForm>(NEW_BIKE);
  const [formError, setFormError] = useState<string | null>(null);
  const [bikeToDelete, setBikeToDelete] = useState<string | null>(null);

  function closeEditor(): void {
    setEditingId(null);
    setEditorOpen(false);
    setForm(NEW_BIKE);
    setFormError(null);
  }

  function beginAdd(): void {
    setEditorOpen(true);
    setEditingId(null);
    setForm(NEW_BIKE);
    setFormError(null);
    setBikeToDelete(null);
  }

  function beginEdit(bike: BikeProfile): void {
    if (editingId === bike.id) {
      closeEditor();
      return;
    }
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
    setBikeToDelete(null);
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

  /** The bike editor, opened by a bike row (edit) or the Add bike row (new). */
  function bikeEditor(): ReactNode {
    const editorId = editingId === null ? "settings-bike-editor-new" : `settings-bike-editor-${editingId}`;
    return (
      <div className="og-settings__editor" id={editorId} aria-label="Bike editor">
        <h3>{editingId === null ? "Add a bike" : "Edit bike"}</h3>
        <label className="og-settings__field">Bike name
          <input aria-label="Bike name" value={form.name} maxLength={60} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label className="og-settings__field">Category
          <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as BikeProfile["category"] })}><option value="street">Street</option><option value="touring">Touring</option><option value="adventure">Adventure</option><option value="dual-sport">Dual-sport</option></select>
        </label>
        <div className="og-settings__field-row">
          <label className="og-settings__field">Fuel range (miles)<input type="number" min={20} max={600} value={form.fuelRangeMiles} onChange={(event) => setForm({ ...form, fuelRangeMiles: Number(event.target.value) })} /></label>
          <label className="og-settings__field">Reserve (miles)<input type="number" min={0} max={100} value={form.reserveMiles} onChange={(event) => setForm({ ...form, reserveMiles: Number(event.target.value) })} /></label>
        </div>
        <label className="og-settings__field">Maintained gravel<select value={form.maintainedGravel} onChange={(event) => setForm({ ...form, maintainedGravel: event.target.value as BikeProfile["maintainedGravel"] })}><option value="allow">Allow</option><option value="avoid">Avoid</option></select></label>
        <label className="og-settings__field">Rough tracks<select value={form.roughTracks} onChange={(event) => setForm({ ...form, roughTracks: event.target.value as BikeProfile["roughTracks"] })}><option value="allow">Allow</option><option value="avoid">Avoid</option></select></label>
        <label className="og-settings__field">Unknown surface<select value={form.unknownSurface} onChange={(event) => setForm({ ...form, unknownSurface: event.target.value as BikeProfile["unknownSurface"] })}><option value="allow-with-warning">Warn me</option><option value="avoid-when-possible">Avoid if possible</option></select></label>
        {formError !== null && <p className="og-settings__error" role="alert">{formError}</p>}
        <div className="og-settings__editor-actions">
          <button className="og-settings__button" type="button" onClick={saveBike}>Save bike</button>
          <button className="og-settings__button og-settings__button--quiet" type="button" onClick={closeEditor}>Cancel</button>
          {editingId !== null && garage.bikes.length > 1 ? (
            <button className="og-settings__text-button og-settings__text-button--danger" type="button" onClick={() => { setBikeToDelete(editingId); setFormError(null); }}>Delete bike</button>
          ) : null}
        </div>
        {bikeToDelete === null ? null : (
          <div className="og-settings__confirm" role="group" aria-label="Delete bike confirmation">
            <p className="og-settings__note">Delete {garage.bikes.find((bike) => bike.id === bikeToDelete)?.name ?? "this bike"}?</p>
            <div className="og-settings__editor-actions">
              <button type="button" className="og-settings__button og-settings__button--danger" onClick={confirmBikeDelete}>Delete</button>
              <button type="button" className="og-settings__button og-settings__button--quiet" onClick={() => { setBikeToDelete(null); setFormError(null); }}>Keep bike</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <main id="main" className="og-settings">
      <AppBar current="/settings" />
      <header className="og-settings__header">
        <h1>Settings</h1>
      </header>

      <div className="og-settings__layout" key={`local-data-${localDataEpoch}`}>
        <SettingsGroup id="settings-display-title" label="Display">
          <AppearanceRow />
          {showNavScreen ? <NavScreenRow /> : null}
        </SettingsGroup>

        <SettingsGroup id="settings-activity-title" label="Activity"><div className="og-settings__row"><span className="og-settings__row-label">Planning activity</span><ActivitySwitch /></div></SettingsGroup>
        <SettingsGroup id="settings-map-title" label="Map">
          <div className="og-settings__row">
            <span className="og-settings__row-text">
              <span className="og-settings__row-label" id="settings-map-style-label">Style</span>
            </span>
            <div className="og-settings__row-control">
              <select
                aria-labelledby="settings-map-style-label"
                value={satellitePreferred ? "satellite" : "map"}
                onChange={(event) => onSatellitePreferredChange?.(event.target.value === "satellite")}
              >
                <option value="map">Map</option>
                <option value="satellite">Satellite</option>
              </select>
            </div>
          </div>
        </SettingsGroup>

        {spotifySetup}

        <SettingsGroup id="settings-bikes-title" label="Your bikes">
          {garage.bikes.map((bike) => {
            const isActive = garage.bikes.length > 1 && garage.activeBikeId === bike.id;
            return (
              <Fragment key={bike.id}>
                <div className="og-settings__row og-settings__row--bike">
                  <button
                    type="button"
                    className="og-settings__row-open"
                    aria-expanded={editingId === bike.id}
                    aria-controls={`settings-bike-editor-${bike.id}`}
                    onClick={() => beginEdit(bike)}
                  >
                    <span className="og-settings__row-text">
                      <span className="og-settings__row-label">{bike.name}</span>
                      <span className="og-settings__row-meta">{categoryLabel(bike)} · {bike.fuelRangeMiles} mi range</span>
                      {isActive ? <span className="og-settings__row-note">New rides use this bike</span> : null}
                    </span>
                    <Chevron />
                  </button>
                  {garage.bikes.length === 1 || isActive ? null : (
                    <button
                      className="og-settings__row-action"
                      type="button"
                      aria-label="Use for new rides"
                      onClick={() => onGarageChange({ ...garage, activeBikeId: bike.id })}
                    >
                      Use
                    </button>
                  )}
                </div>
                {editingId === bike.id ? bikeEditor() : null}
              </Fragment>
            );
          })}
          <SettingsRowButton label="Add bike" onClick={beginAdd} expanded={editorOpen && editingId === null} controls="settings-bike-editor-new" />
          {editorOpen && editingId === null ? bikeEditor() : null}
        </SettingsGroup>

        <SettingsGroup id="settings-home-title" label="Home" hint="Free Ride’s Head Home goes here.">
          <div className="og-settings__row">
            <span className="og-settings__row-text">
              <span className="og-settings__row-label">Home</span>
            </span>
            <span className="og-settings__row-value" data-testid="settings-home-status">{homeSaved ? (homeLabel ?? "Saved on this device") : "Not set"}</span>
          </div>
          <SettingsRowButton
            label={homeBusy ? "Getting location…" : "Use current location"}
            onClick={() => onUseCurrentLocationAsHome?.()}
            disabled={homeBusy || onUseCurrentLocationAsHome === undefined}
            chevron={false}
            testId="settings-save-home"
          />
          <SettingsRowButton
            label="Clear"
            onClick={() => onClearHome?.()}
            disabled={!homeSaved || homeBusy || onClearHome === undefined}
            chevron={false}
            testId="settings-clear-home"
          />
          {homeFeedback === null ? null : (
            <p className="og-settings__home-feedback" role="status" data-testid="settings-home-feedback">{homeFeedback}</p>
          )}
          {onSearchHome === undefined || onPickHome === undefined ? null : (
            <HomeSearch onSearch={onSearchHome} onPick={onPickHome} />
          )}
        </SettingsGroup>

        {offlineRegions !== null ? <OfflineMapsSection regions={offlineRegions} /> : null}

        <SettingsGroup id="settings-usage-title" label="Usage data">
          {/* The whole disclosure stays one tap away rather than six lines of
              page before the row the rider came to change. */}
          <details className="og-settings__disclosure">
            <summary className="og-settings__row og-settings__row--button">
              <span className="og-settings__row-text">
                <span className="og-settings__row-label">What is collected</span>
              </span>
              <Chevron />
            </summary>
            <div className="og-settings__disclosure-body">
              <p className="og-settings__note">{TELEMETRY_ACKNOWLEDGEMENT.collectedSummary}</p>
              <p className="og-settings__note">{TELEMETRY_ACKNOWLEDGEMENT.neverCollectedSummary}</p>
              <p className="og-settings__note">{TELEMETRY_ACKNOWLEDGEMENT.mapContextDisclosure}</p>
              <p className="og-settings__note">{TELEMETRY_ACKNOWLEDGEMENT.offUntilAcknowledgedNote}</p>
            </div>
          </details>
          <label className="og-settings__row og-settings__row--check">
            <span className="og-settings__row-text">
              <span className="og-settings__row-label">I understand and acknowledge this collection</span>
              <span className="og-settings__row-meta">Off until you acknowledge. You can turn it off again any time.</span>
            </span>
            <input
              type="checkbox"
              aria-label="I understand and acknowledge this collection"
              checked={telemetryGateOpen("hosted-beta", telemetryConsent)}
              onChange={(event) => onTelemetryConsentChange?.(event.target.checked ? acknowledgedConsentState(new Date().toISOString()) : { status: "unacknowledged" })}
            />
          </label>
        </SettingsGroup>

        <InstallSection />

        <FeedbackSection />

        <SettingsGroup id="settings-data-title" label="Data" hint="Rides stay on this device.">
          <div className="og-settings__row" data-testid="settings-units">
            <span className="og-settings__row-text">
              <span className="og-settings__row-label">Distance</span>
            </span>
            <span className="og-settings__row-value">miles</span>
          </div>
          <SettingsRowButton label="Export all data" onClick={() => onExport?.()} disabled={onExport === undefined} chevron={false} />
          {statusMessage ? <p className="og-settings__card-block og-settings__note" role="status">{statusMessage}</p> : null}
          <DangerZone onDeleteAll={onDeleteAll} deleteResult={deleteResult} />
        </SettingsGroup>
      </div>
    </main>
  );
}
