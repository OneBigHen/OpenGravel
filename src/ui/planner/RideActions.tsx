"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

/**
 * What a rider does with a planned ride: ride it, keep it, share it.
 *
 * These sit directly under the route choices so the answer and the next step
 * read as one block. Save and Share used to live in the page header, where on
 * compact screens they floated over the map; here they are part of the sheet.
 * The named-save and share-sheet state is owned locally because nothing else
 * in the planner reads it.
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

const ShareSheet = dynamic(() => import("@/ui/sharing/ShareSheet").then((mod) => mod.ShareSheet), { loading: () => <p className="og-composer__reason" role="status">Opening sharing…</p> });

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
}

type SaveState = "idle" | "saving" | "saved" | "failed";

/** The route's distance and time for the library card; unknown values stay out. */
function bundleSummaryOf(route: SelectedOfflineRoute): { distanceMeters?: number; durationSeconds?: number } {
  const { distanceMeters, durationSeconds } = route.summary;
  return {
    ...(distanceMeters === null ? {} : { distanceMeters }),
    ...(durationSeconds === null ? {} : { durationSeconds }),
  };
}

export function RideActions({
  document,
  libraryService,
  shareService,
  route,
  rideActions,
  start,
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
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [shareOpen, setShareOpen] = useState(false);
  // The name the rider just saved under, so Share does not ask for it again (PQ-05).
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<"idle" | "starting">("idle");
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [freeRideState, setFreeRideState] = useState<"idle" | "starting">("idle");
  const [freeRideError, setFreeRideError] = useState<string | null>(null);
  // A ride that was never ended blocks a new one; the way out is to open it.
  const [unfinishedRide, setUnfinishedRide] = useState(false);
  // Start, stops and finish are the route's waypoints; unnamed points stay unnamed.
  const waypoints = useMemo(() => waypointsFromIntent(document.intent), [document.intent]);
  const exportTitle = rideExportTitle(document.title);

  const trimmed = title.trim();
  const canSave = libraryService !== undefined && trimmed.length > 0 && saveState !== "saving";
  const canShare = shareService !== undefined && shareSource !== null;
  // Nothing to keep or send until there is a route: before that the row is
  // chrome on top of the map (map first, DV-10's judgment applied to the planner).
  const hasRide = (document.intent.start !== null || document.intent.finish !== null) && shareSource !== null;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaveState("saving");
    try {
      await libraryService.saveNamed(document, {
        title: trimmed,
        // The selected line is what My rides needs to export this ride later.
        ...(route === null
          ? {}
          : {
              offlinePack: route.pack,
              bundleSummary: bundleSummaryOf(route),
              plannedRoute: { geometry: route.geometry },
            }),
      });
      setSaveState("saved");
      setSavedTitle(trimmed);
      setTitle("");
    } catch {
      setSaveState("failed");
    }
  };

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
            <circle cx="12" cy="12" r="3.5" fill="#e5534b" />
          </svg>
          {recordingState === "starting" ? "Preparing…" : "Record"}
        </button>
          )}
          {rideActions.freeRide === undefined ? null : (
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

      {hasRide && document.title !== null ? (
        <p className="og-plan-actions__ride-name" data-testid="planner-ride-name">
          {document.title}
        </p>
      ) : null}
      {hasRide ? (
        <form
          className="og-plan-actions__row"
          aria-label="Save named ride"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="og-visually-hidden" htmlFor="named-ride-title">
            Ride name
          </label>
          <input
            id="named-ride-title"
            data-testid="named-ride-title"
            type="text"
            value={title}
            placeholder="Name this ride to save it"
            onChange={(event) => {
              setTitle(event.target.value);
              setSaveState("idle");
            }}
          />
          <button
            type="submit"
            className="og-secondary"
            data-testid="save-named-ride"
            disabled={!canSave}
            title={
              libraryService === undefined
                ? "The rides library is unavailable."
                : "Save a named copy to your rides library."
            }
          >
            <svg className="og-plan-actions__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h10l4 4v14H6z" /><path d="M9 3v6h6M9 21v-7h8v7" /></svg>
            <span className="og-plan-actions__label">{saveState === "saving" ? "Saving…" : "Save"}</span>
          </button>
          <button
            type="button"
            className="og-secondary"
            data-testid="open-share"
            disabled={!canShare}
            title={canShare ? "Preview what a share link exposes." : "Plan a route to share it."}
            onClick={() => setShareOpen(true)}
          >
            <svg className="og-plan-actions__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4" /><path d="M5 12v8h14v-8" /></svg>
            <span className="og-plan-actions__label">Share</span>
          </button>
        </form>
      ) : null}
      {route === null ? null : (
        <div className="og-plan-actions__row">
          <ExportMenu
            title={exportTitle}
            capabilities={{ plannedRoute: true, track: false, original: false }}
            onExport={exportRoute}
            {...(shareService === undefined || shareSource === null
              ? {}
              : { onShare: () => setShareOpen(true) })}
          />
        </div>
      )}
      {saveState === "saved" ? (
        <p className="og-named-save__status" role="status">
          Named ride saved. Your active draft remains available.
        </p>
      ) : null}
      {saveState === "failed" ? (
        <p className="og-planner__error" role="alert">
          Could not save the named ride.
        </p>
      ) : null}

      {shareOpen && shareSource !== null && shareService !== undefined ? (
        <ShareSheet
          service={shareService}
          source={
            shareSource.title.trim() === "" && (savedTitle ?? trimmed) !== ""
              ? { ...shareSource, title: savedTitle ?? trimmed }
              : shareSource
          }
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </section>
  );
}
