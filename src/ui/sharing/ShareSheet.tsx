import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

import type { ShareRecord } from "@/application/sharing/ports/share-repository";
import type {
  ShareCommandResult,
  ShareServicePort,
} from "@/application/sharing/share-commands";
import { newCommandId } from "@/domain/ride/ids";
import { formatDistance as formatMiles, METERS_PER_MILE } from "@/application/planner/measurements";
import {
  buildPlannedTrackGpx,
  downloadExport,
  exportFilename,
  type PlannedRouteExportInput,
} from "@/application/export/gpx-export";
import {
  defaultPrivacyTrim,
  type PrivacyTrimSettings,
} from "@/domain/sharing/privacy";
import { SHARE_SNAPSHOT_MAX_BYTES, snapshotBytes } from "@/domain/sharing/snapshot";
import type { ShareSnapshot, ShareSource } from "@/domain/sharing/types";
import { useDesktopPlanner } from "@/ui/planner/usePhonePlanner";
import { SendToPhone } from "@/ui/sharing/SendToPhone";
import { canShareNatively, shareNatively } from "@/ui/sharing/native-share";

/**
 * Share (R3-3): one small solid sheet. The name comes from the ride, the start
 * and finish are hidden by default, and one green button makes the link. The
 * privacy options sit behind one closed line. What the link holds is still the
 * snapshot the one shared privacy implementation produced; the sheet never
 * trims on its own. Download GPX and, on desktop, Send to phone live here too.
 */

function noSubscription(): () => void {
  return () => {};
}

const OVER_BUDGET_MESSAGE = `This ride has too many points for one link (about ${Math.round(SHARE_SNAPSHOT_MAX_BYTES / 1024)} KB). Share a shorter piece of it.`;

/** Trim is the rider's unit: miles here, never metres. */
function trimLabel(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  return `${Number(miles.toFixed(2))} mi`;
}

function trimMilesText(meters: number): string {
  return String(Number((meters / METERS_PER_MILE).toFixed(2)));
}

/** The closed Privacy line: says what is hidden right now, in plain words. */
function privacyLine(privacy: PrivacyTrimSettings): string {
  const ends =
    privacy.hideStart && privacy.hideFinish
      ? "start and finish hidden"
      : privacy.hideStart
        ? "start hidden"
        : privacy.hideFinish
          ? "finish hidden"
          : "start and finish shown";
  const trim = privacy.trimMetersFromEnds > 0 ? `, ${trimLabel(privacy.trimMetersFromEnds)} trimmed from each end` : "";
  return `Privacy: ${ends}${trim}`;
}

/** A ride with no name still gets an honest one: its miles. */
function fallbackTitle(source: ShareSource): string {
  const meters = source.summary?.distanceMeters;
  return meters === null || meters === undefined ? "My ride" : `My ride, ${formatMiles(meters)}`;
}

interface PreviewState {
  readonly snapshot: ShareSnapshot;
  /** UTF-8 size of the canonical bytes; the server refuses what does not fit. */
  readonly bytes: number;
  /** The name and privacy settings this snapshot was prepared from. */
  readonly key: string;
}

/** Which settings produced a preview: publishing only ever uses a matching one. */
function previewKey(title: string, privacy: PrivacyTrimSettings, authorName: string | null): string {
  return JSON.stringify({
    title,
    hideStart: privacy.hideStart,
    hideFinish: privacy.hideFinish,
    trimMetersFromEnds: privacy.trimMetersFromEnds,
    blurCoordinates: privacy.blurCoordinates,
    authorName,
  });
}

export interface ShareSheetProps {
  readonly service: ShareServicePort;
  /** Named derivation (never a document spread). Its `title` fills the name box. */
  readonly source: ShareSource;
  /** Stops and ends for the GPX file, when the caller has them. */
  readonly waypoints?: PlannedRouteExportInput["waypoints"];
  readonly onClose: () => void;
}

export function ShareSheet({ service, source, waypoints, onClose }: ShareSheetProps) {
  const [privacy, setPrivacy] = useState<PrivacyTrimSettings>(defaultPrivacyTrim);
  const [trimText, setTrimText] = useState(() => trimMilesText(defaultPrivacyTrim().trimMetersFromEnds));
  const [title, setTitle] = useState(() => (source.title.trim() === "" ? fallbackTitle(source) : source.title));
  const [needsTitle, setNeedsTitle] = useState(false);
  const [authorEnabled, setAuthorEnabled] = useState(false);
  const [authorName, setAuthorName] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ record: ShareRecord; link: string } | null>(null);
  const [revoked, setRevoked] = useState<ShareRecord | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed" | "shared" | "share-failed">("idle");
  const [gpxError, setGpxError] = useState(false);
  const [view, setView] = useState<"share" | "phone">("share");
  const [busy, setBusy] = useState(false);
  const previewSequence = useRef(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  useDialogFocus(dialogRef, onClose);

  // The server render has no navigator, so it offers Copy only.
  const nativeShare = useSyncExternalStore(noSubscription, canShareNatively, () => false);
  const desktop = useDesktopPlanner();

  const titled = title.trim() !== "";
  const effectiveAuthor = authorEnabled && authorName.trim().length > 0 ? authorName.trim() : null;
  const currentKey = previewKey(title, privacy, effectiveAuthor);
  /**
   * A preview from earlier settings is not this link: the rider changed the
   * privacy, so sharing the old bytes would share more or less than the line
   * says. An empty name has no preview at all.
   */
  const activePreview = titled && preview !== null && preview.key === currentKey ? preview : null;

  useEffect(() => {
    const sequence = previewSequence.current + 1;
    previewSequence.current = sequence;
    // No name yet is not an error to show: the button explains it when pressed.
    // Nothing is prepared; a preview from an earlier name is ignored above.
    if (!titled) return;
    const key = previewKey(title, privacy, effectiveAuthor);
    const effective: ShareSource = {
      ...source,
      title,
      authorPseudonym: effectiveAuthor,
    };
    void service
      .dispatch({
        type: "share.apply-trim",
        commandId: newCommandId(),
        source: "rider",
        label: "Prepare the shared ride",
        payload: { source: effective, privacy },
      })
      .then((result: ShareCommandResult) => {
        if (previewSequence.current !== sequence) return;
        if (result.ok && result.kind === "preview") {
          setPreview({ snapshot: result.snapshot, bytes: snapshotBytes(result.output), key });
          setPreviewError(null);
        } else if (!result.ok) {
          setPreview(null);
          setPreviewError(
            result.code === "no-route-left" ? "That much trimming leaves nothing to share. Trim less." : result.message,
          );
        }
      });
  }, [service, source, title, titled, privacy, effectiveAuthor]);

  const handlePublish = useCallback(async (): Promise<void> => {
    if (!titled) {
      setNeedsTitle(true);
      titleRef.current?.focus();
      return;
    }
    if (activePreview === null) return;
    setBusy(true);
    setCommandError(null);
    try {
      const result = await service.dispatch({
        type: "share.publish",
        commandId: newCommandId(),
        source: "rider",
        label: "Create the share link",
        payload: { snapshot: activePreview.snapshot },
      });
      if (result.ok && result.kind === "published") {
        setPublished({ record: result.record, link: result.link });
        setRevoked(null);
        setCopied("idle");
      } else if (!result.ok) {
        setCommandError(result.message);
      }
    } catch (error: unknown) {
      setCommandError(error instanceof Error ? error.message : "The link could not be made. Try again when online.");
    } finally {
      setBusy(false);
    }
  }, [activePreview, service, titled]);

  const handleCopy = useCallback(async (): Promise<void> => {
    if (published === null) return;
    try {
      await navigator.clipboard.writeText(published.link);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }, [published]);

  const handleNativeShare = useCallback(async (): Promise<void> => {
    if (published === null) return;
    const outcome = await shareNatively({ title: published.record.snapshot.title, url: published.link });
    if (outcome === "shared") setCopied("shared");
    else if (outcome === "failed") setCopied("share-failed");
  }, [published]);

  const handleRevoke = useCallback(async (): Promise<void> => {
    if (published === null) return;
    setBusy(true);
    setCommandError(null);
    try {
      const result = await service.dispatch({
        type: "share.revoke",
        commandId: newCommandId(),
        source: "rider",
        label: "Remove the share link",
        payload: { shareId: published.record.shareId },
      });
      if (result.ok && result.kind === "revoked") {
        setRevoked(result.record);
        setPublished(null);
      } else if (!result.ok) {
        setCommandError(result.message);
      }
    } catch (error: unknown) {
      setCommandError(error instanceof Error ? error.message : "The link could not be removed. Try again when online.");
    } finally {
      setBusy(false);
    }
  }, [published, service]);

  const downloadGpx = useCallback((): void => {
    setGpxError(false);
    try {
      const name = title.trim() === "" ? fallbackTitle(source) : title.trim();
      const xml = buildPlannedTrackGpx({
        title: name,
        geometry: source.route.segments.flatMap((segment) => segment),
        ...(waypoints === undefined ? {} : { waypoints }),
        createdTime: new Date().toISOString(),
      });
      downloadExport(new TextEncoder().encode(xml), exportFilename(name, "planned-track"));
    } catch {
      setGpxError(true);
    }
  }, [source, title, waypoints]);

  if (view === "phone") {
    return (
      <SendToPhone
        service={service}
        source={{ ...source, title }}
        onClose={() => {
          setView("share");
        }}
      />
    );
  }

  const overBudget = activePreview !== null && activePreview.bytes > SHARE_SNAPSHOT_MAX_BYTES;
  const publishable = activePreview !== null && !overBudget;
  const createDisabled = busy || (titled && !publishable);

  return (
    <div className="og-share__backdrop">
      <section
        ref={dialogRef}
        className="og-share-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Share this ride"
        data-testid="share-sheet"
      >
        <header className="og-share-sheet__header">
          <h2>Share this ride</h2>
          <button type="button" className="og-secondary" onClick={onClose}>
            Close
          </button>
        </header>

        {published === null ? (
          <>
            <label className="og-share-sheet__field">
              Name
              <input
                ref={titleRef}
                type="text"
                data-testid="share-title"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setNeedsTitle(false);
                }}
              />
            </label>
            {needsTitle && !titled ? (
              <p className="og-planner__error" role="alert">
                Give the ride a name to share it.
              </p>
            ) : null}

            <details className="og-share-sheet__privacy" data-testid="share-privacy">
              <summary>{privacyLine(privacy)}</summary>
              <div className="og-share-sheet__controls">
                <label>
                  <input
                    type="checkbox"
                    checked={privacy.hideStart}
                    onChange={(event) => {
                      setPrivacy({ ...privacy, hideStart: event.target.checked });
                    }}
                  />
                  Hide the start
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={privacy.hideFinish}
                    onChange={(event) => {
                      setPrivacy({ ...privacy, hideFinish: event.target.checked });
                    }}
                  />
                  Hide the finish
                </label>
                <label>
                  Trim from both ends (miles)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    data-testid="share-trim-miles"
                    value={trimText}
                    onChange={(event) => {
                      setTrimText(event.target.value);
                      const miles = Number(event.target.value);
                      setPrivacy({
                        ...privacy,
                        trimMetersFromEnds: Number.isFinite(miles) && miles > 0 ? miles * METERS_PER_MILE : 0,
                      });
                    }}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={privacy.blurCoordinates}
                    onChange={(event) => {
                      setPrivacy({ ...privacy, blurCoordinates: event.target.checked });
                    }}
                  />
                  Blur exact points (about 300 feet)
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={authorEnabled}
                    onChange={(event) => {
                      setAuthorEnabled(event.target.checked);
                    }}
                  />
                  Put my name on the link
                </label>
                {authorEnabled ? (
                  <label>
                    Name shown
                    <input
                      type="text"
                      data-testid="share-author-name"
                      value={authorName}
                      onChange={(event) => {
                        setAuthorName(event.target.value);
                      }}
                    />
                  </label>
                ) : null}
              </div>
            </details>
          </>
        ) : (
          <p className="og-share-sheet__summary" data-testid="share-summary">
            {published.record.snapshot.title} · {privacyLine(privacy)}
          </p>
        )}

        {titled && previewError !== null ? (
          <p className="og-planner__error" role="alert">
            {previewError}
          </p>
        ) : null}
        {overBudget ? (
          <p className="og-planner__error" role="alert" data-testid="share-preview-too-large">
            {OVER_BUDGET_MESSAGE}
          </p>
        ) : null}
        {commandError !== null ? (
          <p className="og-planner__error" role="alert">
            {commandError}
          </p>
        ) : null}

        {revoked !== null ? (
          <section className="og-share-sheet__link" aria-label="Share link removed">
            <p role="status" data-testid="share-revoked">
              Link removed. It no longer opens this ride.
            </p>
            <button
              type="button"
              className="og-primary"
              data-testid="share-reissue"
              disabled={createDisabled}
              onClick={() => {
                void handlePublish();
              }}
            >
              Create a new link
            </button>
          </section>
        ) : published !== null ? (
          <section className="og-share-sheet__link" aria-label="Share link">
            <label htmlFor="share-link">Share link</label>
            <input id="share-link" data-testid="share-link" type="text" readOnly value={published.link} />
            <div className="og-share-sheet__actions">
              {nativeShare ? (
                <button
                  type="button"
                  className="og-primary"
                  data-testid="share-native"
                  onClick={() => {
                    void handleNativeShare();
                  }}
                >
                  Share…
                </button>
              ) : null}
              <button
                type="button"
                className={nativeShare ? "og-secondary" : "og-primary"}
                data-testid="share-copy"
                onClick={() => {
                  void handleCopy();
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className="og-secondary"
                data-testid="share-revoke"
                disabled={busy}
                onClick={() => {
                  void handleRevoke();
                }}
              >
                Remove link
              </button>
            </div>
            <p role="status" data-testid="share-copy-status">
              {copied === "copied"
                ? "Link copied."
                : copied === "failed"
                  ? "The link could not be copied. Select it and copy it by hand."
                  : copied === "shared"
                    ? "Link shared."
                    : copied === "share-failed"
                      ? "The share sheet did not open. Copy the link instead."
                      : ""}
            </p>
            <p className="og-share-sheet__note">Anyone with the link can open this ride. It stops working after about six months.</p>
          </section>
        ) : (
          <>
            <button
              type="button"
              className="og-primary"
              data-testid="share-publish"
              disabled={createDisabled}
              onClick={() => {
                void handlePublish();
              }}
            >
              Create link
            </button>
            <p className="og-share-sheet__note">Anyone with the link can open this ride.</p>
          </>
        )}

        <div className="og-share-sheet__actions og-share-sheet__more">
          <button type="button" className="og-secondary" data-testid="share-download-gpx" onClick={downloadGpx}>
            Download GPX
          </button>
          {desktop ? (
            <button
              type="button"
              className="og-secondary"
              data-testid="share-send-to-phone"
              onClick={() => {
                setView("phone");
              }}
            >
              Send to phone
            </button>
          ) : null}
        </div>
        {gpxError ? (
          <p className="og-planner__error" role="alert">
            Could not make the GPX file.
          </p>
        ) : null}
      </section>
    </div>
  );
}
