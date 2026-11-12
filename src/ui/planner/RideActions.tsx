"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

/**
 * What a rider does with a planned ride beyond riding, keeping and sharing it:
 * record it, export it, or send it to the phone.
 *
 * Start, Save and Share live in the one ride summary (`RideSummary`), so this
 * block never repeats them: there is no name box, no second save and no "draft"
 * sentence to read (round 3, restructure call 4). What is left is the quieter
 * shelf under the ride: the recording entry points, Plan it again for an opened
 * saved line, the GPX export, and — on a laptop — a link to the bars.
 */

import { useMemo, useState } from "react";

import {
  waypointsFromIntent,
  type LibraryServicePort,
} from "@/application/library/library-service";
import {
  buildPlannedRouteGpx,
  buildPlannedTrackGpx,
  downloadExport,
  exportFilename,
  rideExportTitle,
  type ExportMode,
} from "@/application/export/gpx-export";
import { ExportMenu } from "@/ui/rides/ExportMenu";
import type { ShareServicePort } from "@/application/sharing/share-commands";
import type { RideDocument } from "@/domain/ride/types";
import type { SelectedOfflineRoute } from "@/application/offline/selected-offline-route";
import {
  RIDE_FOCUS_PATH,
  type PlannerRideActions,
} from "@/application/ride-session/ride-focus-handoff";
import { shareSourceFromRide } from "@/domain/sharing/from-ride";
import { useDesktopPlanner } from "@/ui/planner/usePhonePlanner";
import { useActivityMode } from "@/ui/stores/activity-mode";
import { useOneTapSave } from "@/ui/planner/useOneTapSave";

const SendToPhone = dynamic(() => import("@/ui/sharing/SendToPhone").then((mod) => mod.SendToPhone), { loading: () => <p className="og-composer__reason" role="status">Opening Send to phone…</p> });

export interface RideActionsProps {
  readonly document: RideDocument;
  readonly libraryService: LibraryServicePort | undefined;
  readonly shareService: ShareServicePort | undefined;
  /** The selected route; `null` until one exists (Share needs it). */
  readonly route: SelectedOfflineRoute | null;
  /** Typed actions for the physical RideSession handoff, supplied by the composition root. */
  readonly rideActions?: PlannerRideActions;
  /** `null` hides the Start ride block (no routes yet, or no ride session). */
  readonly start: {
    readonly refusal: string | null;
    readonly starting: boolean;
    readonly error: string | null;
    readonly onStart: () => void;
  } | null;
  /**
   * Shown only while the answer is a saved ride's own line (R3-1): plan the
   * saved request again instead of riding the line that was saved.
   */
  readonly onPlanAgain?: (() => void) | null;
}

export function RideActions({
  document,
  libraryService,
  shareService,
  route,
  rideActions,
  start,
  onPlanAgain = null,
}: RideActionsProps) {
  // The §12 share source: a named derivation from the document and the selected
  // route, never a document spread. The sheet owns the shared title.
  const shareSource = useMemo(
    () =>
      route === null
        ? null
        : shareSourceFromRide(document, { segments: [route.geometry] }, route.summary, null),
    [document, route],
  );
  const [sendToPhoneOpen, setSendToPhoneOpen] = useState(false);
  // Send to phone is the laptop's bridge to the bars; the sheet keeps it off phones.
  const desktop = useDesktopPlanner();
  // Free Ride is a riding mode; a hiker records instead.
  const hiking = useActivityMode() === "hike";
  const [recordingState, setRecordingState] = useState<"idle" | "starting">("idle");
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [freeRideState, setFreeRideState] = useState<"idle" | "starting">("idle");
  const [freeRideError, setFreeRideError] = useState<string | null>(null);
  // A ride that was never ended blocks a new one; the way out is to open it.
  const [unfinishedRide, setUnfinishedRide] = useState(false);
  // Start, stops and finish are the route's waypoints; unnamed points stay unnamed.
  const waypoints = useMemo(() => waypointsFromIntent(document.intent), [document.intent]);
  const exportTitle = rideExportTitle(document.title);
  const hikeMiles = route?.summary.distanceMeters ?? null;
  const hikeName = `${document.title?.trim() || "My hike"}${hikeMiles === null || hikeMiles <= 0 ? "" : `, ${Math.max(1, Math.round(hikeMiles / 1609.344))} mi`}`;
  const hikeSave = useOneTapSave({ document, libraryService, route, automaticName: hikeName });

  // Nothing to keep or send until there is a route: before that the row is
  // chrome on top of the map (map first, DV-10's judgment applied to the planner).
  const hasRide = (document.intent.start !== null || document.intent.finish !== null) && shareSource !== null;
  /**
   * The route on screen is enough to export: the rider does not have to save
   * first, and nothing is written to the library by downloading a file.
   */
  const exportRoute = async (mode: ExportMode): Promise<void> => {
    if (route === null || (mode !== "planned-route" && mode !== "planned-track")) {
      throw new Error("Only the planned route can be exported from here.");
    }
    const input = {
      title: exportTitle,
      geometry: route.geometry,
      waypoints,
      createdTime: document.createdAt,
    };
    const xml = mode === "planned-route" ? buildPlannedRouteGpx(input) : buildPlannedTrackGpx(input);
    downloadExport(new TextEncoder().encode(xml), exportFilename(exportTitle, mode));
  };

  const recordRideNow = async (): Promise<void> => {
    if (rideActions?.record === undefined || recordingState === "starting" || freeRideState === "starting") return;
    setRecordingState("starting");
    setRecordingError(null);
    try {
      const result = await rideActions.record(document);
      if (result.outcome === "rejected") {
        setRecordingError(result.message);
        setRecordingState("idle");
      }
    } catch {
      setRecordingError("The current ride could not be saved, so recording was not started.");
      setRecordingState("idle");
    }
  };

  const justRideNow = async (): Promise<void> => {
    if (rideActions?.freeRide === undefined || recordingState === "starting" || freeRideState === "starting") return;
    setFreeRideState("starting");
    setFreeRideError(null);
    setUnfinishedRide(false);
    try {
      const result = await rideActions.freeRide(document);
      if (result.outcome === "rejected") {
        if (result.sessionId !== null) {
          // Only a ride that is still recording blocks Free Ride now.
          setUnfinishedRide(true);
        }
        else setFreeRideError(result.message);
        setFreeRideState("idle");
      }
    } catch {
      setFreeRideError("Free Ride could not be started. Try again in a moment.");
      setFreeRideState("idle");
    }
  };

  return (
    <section className="og-plan-actions" aria-label="Ride actions">
      {start === null ? null : (
        <div className="og-ride-start">
          {start.refusal !== null ? (
            <p className="og-composer__reason" data-testid="start-ride-reason">
              {start.refusal}
            </p>
          ) : (
            <button
              type="button"
              className="og-primary og-ride-start__cta"
              data-testid="start-ride"
              disabled={start.starting}
              onClick={start.onStart}
            >
              {start.starting ? "Starting…" : "Start ride"}
            </button>
          )}
          {start.error === null ? null : (
            <p className="og-planner__error" data-testid="start-ride-error" role="alert">
              {start.error}
            </p>
          )}
        </div>
      )}

      {onPlanAgain === null ? null : (
        <div className="og-plan-actions__row">
          <button
            type="button"
            className="og-secondary"
            data-testid="plan-it-again"
            title="This is the line you saved. Plan the same ride again with today's roads."
            onClick={onPlanAgain}
          >
            Plan it again
          </button>
        </div>
      )}

      {rideActions === undefined ? null : (
        <div className="og-plan-actions__record-row" aria-label="Start without a planned route">
          {rideActions.record === undefined ? null : (
        <button
          type="button"
          className="og-secondary og-plan-actions__record"
          data-testid="record-a-ride"
          disabled={recordingState === "starting" || freeRideState === "starting"}
          onClick={() => void recordRideNow()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="og-plan-actions__glyph">
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle className="og-plan-actions__record-dot" cx="12" cy="12" r="3.5" />
          </svg>
          {recordingState === "starting" ? "Preparing…" : "Record"}
        </button>
          )}
          {rideActions.freeRide === undefined || hiking ? null : (
            <button
              type="button"
              className="og-secondary og-plan-actions__free-ride"
              data-testid="just-ride"
              disabled={recordingState === "starting" || freeRideState === "starting"}
              onClick={() => void justRideNow()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="og-plan-actions__glyph">
                <path d="M3 11l18-8-8 18-2-8z" />
              </svg>
              {freeRideState === "starting" ? "Starting…" : "Free Ride"}
            </button>
          )}
        </div>
      )}
      {recordingError === null ? null : (
        <p className="og-planner__error" data-testid="record-a-ride-error" role="alert">
          {recordingError}
        </p>
      )}
      {!unfinishedRide ? null : (
        <div className="og-plan-actions__unfinished" data-testid="just-ride-unfinished" role="alert">
          <p>You have a ride that was never ended. Finish or discard it, then start Free Ride.</p>
          <Link className="og-primary" href={RIDE_FOCUS_PATH} data-testid="just-ride-open-unfinished">
            Open that ride
          </Link>
        </div>
      )}
      {freeRideError === null ? null : (
        <p className="og-planner__error" data-testid="just-ride-error" role="alert">
          {freeRideError}
        </p>
      )}

      {/* A hike has no ride summary; it keeps its one-tap Save here. */}
      {hiking && hasRide ? (
        <div className="og-plan-actions__row">
          <button type="button" className="og-secondary" data-testid="summary-save" data-state={hikeSave.state} disabled={!hikeSave.canSave} onClick={() => void hikeSave.save()}>
            {hikeSave.state === "saving" ? "Saving…" : hikeSave.state === "saved" ? `Saved as ${hikeSave.savedTitle ?? hikeName}` : "Save"}
          </button>
          {hikeSave.error === null ? null : <p className="og-planner__error" role="alert">{hikeSave.error}</p>}
        </div>
      ) : null}
      {route === null ? null : (
        <div className="og-plan-actions__row">
          <ExportMenu
            title={exportTitle}
            capabilities={{ plannedRoute: true, track: false, original: false }}
            onExport={exportRoute}
          />
          {desktop && hasRide && shareService !== undefined ? (
            <button
              type="button"
              className="og-secondary"
              data-testid="send-to-phone"
              title="Send this route to your phone with a QR code."
              onClick={() => setSendToPhoneOpen(true)}
            >
              <svg className="og-plan-actions__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>
              <span className="og-plan-actions__label">Send to phone</span>
            </button>
          ) : null}
        </div>
      )}

      {sendToPhoneOpen && shareSource !== null && shareService !== undefined ? (
        <SendToPhone
          service={shareService}
          source={shareSource.title.trim() === "" ? { ...shareSource, title: document.title?.trim() || "My ride" } : shareSource}
          onClose={() => setSendToPhoneOpen(false)}
        />
      ) : null}
    </section>
  );
}
