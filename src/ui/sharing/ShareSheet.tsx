import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

import type { ShareRecord } from "@/application/sharing/ports/share-repository";
import type {
  ShareCommandResult,
  ShareServicePort,
} from "@/application/sharing/share-commands";
import { newCommandId } from "@/domain/ride/ids";
import { formatDistance as formatMiles } from "@/application/planner/measurements";
import type { RideProvenance, SurfaceIntent } from "@/domain/ride/types";
import {
  defaultPrivacyTrim,
  type PrivacyTrimSettings,
} from "@/domain/sharing/privacy";
import type { ShareSnapshot, ShareSource } from "@/domain/sharing/types";
import { canShareNatively, shareNatively } from "@/ui/sharing/native-share";

/**
 * The privacy preview sheet (10-SHARING-AND-OFFLINE §11–§12).
 *
 * Three contracts live in this one surface:
 *
 * - **Preview exact before publish.** "What this link exposes" is rendered from
 *   the snapshot the publish command receives, and the `<pre>` block shows the
 *   canonical serialization verbatim — the very bytes `share.publish` stores
 *   and a link holder resolves.
 * - **Privacy first.** The §11 trim controls (hide start, hide finish, trim N
 *   from the ends, coordinate rounding) all route through the one shared
 *   privacy implementation in the domain; this surface never trims on its own.
 * - **Honest states.** Publishing, copying, and revoking each report what
 *   actually happened; a revoked link says so and can only come back as a new
 *   link (re-issue), never by relabeling the dead one.
 */

const SURFACE_PREFERENCE: Readonly<Record<SurfaceIntent["preference"], string>> = {
  pavement: "Pavement",
  "mostly-pavement": "Mostly pavement",
  mixed: "Mixed surface",
  "dirt-preferred": "Dirt preferred",
};

const UNKNOWN_SURFACE: Readonly<Record<SurfaceIntent["unknownSurfacePolicy"], string>> = {
  "allow-with-warning": "Unknown surfaces allowed with a warning",
  "avoid-when-possible": "Unknown surfaces avoided when possible",
};

const PROVENANCE: Readonly<Record<RideProvenance["type"], string>> = {
  new: "Started in OpenGravel",
  import: "Imported file",
  catalog: "Catalog ride",
  shared: "Shared ride",
  recorded: "Recorded ride",
  "recreated-from-track": "Recreated from a track",
  derived: "Derived ride",
};

function noSubscription(): () => void {
  return () => {};
}

function formatDistance(meters: number | null): string {
  return meters === null ? "Not shared" : formatMiles(meters);
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Not shared";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

interface PreviewState {
  readonly snapshot: ShareSnapshot;
  readonly output: string;
}

export interface ShareSheetProps {
  readonly service: ShareServicePort;
  /**
   * Named derivation (never a document spread). Its `title` seeds the sheet's
   * title field: the active draft is often untitled (named saves are copies),
   * while §12 requires the shared ride to carry a title.
   */
  readonly source: ShareSource;
  readonly onClose: () => void;
}

export function ShareSheet({ service, source, onClose }: ShareSheetProps) {
  const [privacy, setPrivacy] = useState<PrivacyTrimSettings>(defaultPrivacyTrim);
  const [title, setTitle] = useState(source.title);
  const [authorEnabled, setAuthorEnabled] = useState(false);
  const [authorName, setAuthorName] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ record: ShareRecord; link: string } | null>(null);
  const [revoked, setRevoked] = useState<ShareRecord | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed" | "shared" | "share-failed">(
    "idle",
  );
  const [busy, setBusy] = useState(false);
  const previewSequence = useRef(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocus(dialogRef, onClose);

  // The server render has no navigator, so it offers Copy link only.
  const nativeShare = useSyncExternalStore(noSubscription, canShareNatively, () => false);

  useEffect(() => {
    const sequence = previewSequence.current + 1;
    previewSequence.current = sequence;
    const effective: ShareSource = {
      ...source,
      title,
      authorPseudonym: authorEnabled && authorName.trim().length > 0 ? authorName.trim() : null,
    };
    void service
      .dispatch({
        type: "share.apply-trim",
        commandId: newCommandId(),
        source: "rider",
        label: "Preview the shared ride",
        payload: { source: effective, privacy },
      })
      .then((result: ShareCommandResult) => {
        if (previewSequence.current !== sequence) return;
        if (result.ok && result.kind === "preview") {
          setPreview({ snapshot: result.snapshot, output: result.output });
          setPreviewError(null);
        } else if (!result.ok) {
          setPreview(null);
          setPreviewError(result.message);
        }
      });
  }, [service, source, title, privacy, authorEnabled, authorName]);

  const handlePublish = useCallback(async (): Promise<void> => {
    if (preview === null) return;
    setBusy(true);
    setCommandError(null);
    try {
      const result = await service.dispatch({
        type: "share.publish",
        commandId: newCommandId(),
        source: "rider",
        label: "Create the share link",
        payload: { snapshot: preview.snapshot },
      });
      if (result.ok && result.kind === "published") {
        setPublished({ record: result.record, link: result.link });
        setRevoked(null);
        setCopied("idle");
      } else if (!result.ok) {
        setCommandError(result.message);
      }
    } catch (error: unknown) {
      setCommandError(error instanceof Error ? error.message : "The link could not be published. Try again when online.");
    } finally {
      setBusy(false);
    }
  }, [preview, service]);

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
        label: "Revoke the share link",
        payload: { shareId: published.record.shareId },
      });
      if (result.ok && result.kind === "revoked") {
        setRevoked(result.record);
        setPublished(null);
      } else if (!result.ok) {
        setCommandError(result.message);
      }
    } catch (error: unknown) {
      setCommandError(error instanceof Error ? error.message : "The link could not be revoked. Try again when online.");
    } finally {
      setBusy(false);
    }
  }, [published, service]);

  const snapshot = preview?.snapshot ?? null;

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

        <fieldset className="og-share-sheet__controls">
          <legend>Privacy on the shared route</legend>
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
            Trim from both ends (meters)
            <input
              type="number"
              min={0}
              step={50}
              data-testid="share-trim-meters"
              value={privacy.trimMetersFromEnds}
              onChange={(event) => {
                setPrivacy({ ...privacy, trimMetersFromEnds: Number(event.target.value) });
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
            Round coordinates (about 100 m)
          </label>
        </fieldset>

        <fieldset className="og-share-sheet__controls">
          <legend>What the shared ride is called</legend>
          <label>
            Title shown with the shared ride
            <input
              type="text"
              data-testid="share-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </label>
        </fieldset>

        <fieldset className="og-share-sheet__controls">
          <legend>Who the shared ride names</legend>
          <label>
            <input
              type="checkbox"
              checked={authorEnabled}
              onChange={(event) => {
                setAuthorEnabled(event.target.checked);
              }}
            />
            Add a name to the shared ride
          </label>
          {authorEnabled ? (
            <label>
              Name shown on the shared ride
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
        </fieldset>

        <section className="og-share-sheet__preview" aria-label="What this link exposes">
          <h3>What this link exposes</h3>
          {previewError !== null ? (
            <p className="og-planner__error" role="alert">
              {previewError}
            </p>
          ) : null}
          {snapshot !== null ? (
            <>
              <dl className="og-share-sheet__facts">
                <div>
                  <dt>Title</dt>
                  <dd data-testid="share-fact-title">{snapshot.title}</dd>
                </div>
                <div>
                  <dt>Route</dt>
                  <dd data-testid="share-fact-route">
                    {formatDistance(snapshot.distanceMeters)} shared
                  </dd>
                </div>
                <div>
                  <dt>Ride time</dt>
                  <dd data-testid="share-fact-time">
                    {formatDuration(snapshot.rideDurationSeconds)}
                  </dd>
                </div>
                <div>
                  <dt>Surface</dt>
                  <dd data-testid="share-fact-surface">
                    {SURFACE_PREFERENCE[snapshot.surface.preference]} ·{" "}
                    {UNKNOWN_SURFACE[snapshot.surface.unknownSurfacePolicy]}
                  </dd>
                </div>
                <div>
                  <dt>Name</dt>
                  <dd data-testid="share-fact-author">
                    {snapshot.author === null ? "Not included" : snapshot.author.pseudonym}
                  </dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd data-testid="share-fact-source">
                    {PROVENANCE[snapshot.source.attribution]}
                  </dd>
                </div>
              </dl>
              <pre className="og-share-sheet__payload" data-testid="share-preview-payload">
                {preview === null ? "" : preview.output}
              </pre>
            </>
          ) : null}
        </section>

        {commandError !== null ? (
          <p className="og-planner__error" role="alert">
            {commandError}
          </p>
        ) : null}

        {revoked !== null ? (
          <section className="og-share-sheet__link" aria-label="Share link revoked">
            <p role="status" data-testid="share-revoked">
              This link no longer opens the ride. Create a new link to share again.
            </p>
            <button
              type="button"
              className="og-primary"
              data-testid="share-reissue"
              disabled={busy || preview === null}
              onClick={() => {
                void handlePublish();
              }}
            >
              Create a new link
            </button>
          </section>
        ) : published !== null ? (
          <section className="og-share-sheet__link" aria-label="Share link">
            <p>Keep this link and this browser’s data to revoke it later from the shared page.</p>
            <label htmlFor="share-link">Share link</label>
            <input
              id="share-link"
              data-testid="share-link"
              type="text"
              readOnly
              value={published.link}
            />
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
                Copy link
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
                Revoke link
              </button>
            </div>
            <p role="status" data-testid="share-copy-status">
              {copied === "copied"
                ? "Link copied."
                : copied === "failed"
                  ? "The link could not be copied — select it and copy it manually."
                  : copied === "shared"
                    ? "Link shared."
                    : copied === "share-failed"
                      ? "The share sheet did not open — copy the link instead."
                      : ""}
            </p>
          </section>
        ) : (
          <button
            type="button"
            className="og-primary"
            data-testid="share-publish"
            disabled={busy || preview === null}
            title={preview === null ? "A shareable route is required." : "Create the share link."}
            onClick={() => {
              void handlePublish();
            }}
          >
            Create share link
          </button>
        )}
      </section>
    </div>
  );
}
