"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ShareRecord } from "@/application/sharing/ports/share-repository";
import { qrMatrix, qrPath } from "@/application/sharing/qr";
import type {
  ShareCommandResult,
  ShareServicePort,
} from "@/application/sharing/share-commands";
import { newCommandId } from "@/domain/ride/ids";
import {
  SHARE_SNAPSHOT_MAX_BYTES,
  snapshotBytes,
} from "@/domain/sharing/snapshot";
import type { PrivacyTrimSettings } from "@/domain/sharing/privacy";
import type { ShareSource } from "@/domain/sharing/types";
import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

/**
 * "Send to phone" (DESIGN.md, taste call 7): a solid dialog with a QR code for
 * the rider's own phone.
 *
 * Nothing here is glass: the dialog covers the map, so it is a plain
 * `--og-surface` panel. The QR is drawn in the browser as inline SVG from the
 * link text — no outside image service ever receives the link. There is no
 * privacy-trim step because the link is going to the rider's own device, but
 * the link stays revocable: "Remove link" revokes it through the same share
 * command every other share surface uses.
 */

/** The rider's own phone gets the whole line: no privacy trim, no blur. */
const NO_PRIVACY_TRIM: PrivacyTrimSettings = Object.freeze({
  hideStart: false,
  hideFinish: false,
  trimMetersFromEnds: 0,
  blurCoordinates: false,
});

const OVER_BUDGET_MESSAGE = `This route has too many points to send: a share link holds about ${Math.round(SHARE_SNAPSHOT_MAX_BYTES / 1024)} KB of coordinates.`;

type PhoneState =
  | { readonly kind: "publishing" }
  | { readonly kind: "published"; readonly record: ShareRecord; readonly link: string }
  | { readonly kind: "removed" }
  | { readonly kind: "error"; readonly message: string };

export interface SendToPhoneProps {
  readonly service: ShareServicePort;
  /** The named derivation of the selected route; the dialog owns the title fallback. */
  readonly source: ShareSource;
  readonly onClose: () => void;
}

export function SendToPhone({ service, source, onClose }: SendToPhoneProps) {
  const [state, setState] = useState<PhoneState>({ kind: "publishing" });
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocus(dialogRef, onClose);

  // An untitled draft is the normal planner state. The share command needs a
  // title, and "My ride" is the honest one for the rider's own phone.
  const effectiveSource = useMemo<ShareSource>(
    () => ({
      ...source,
      title: source.title.trim() === "" ? "My ride" : source.title,
    }),
    [source],
  );

  const publish = useCallback(async (): Promise<void> => {
    setState({ kind: "publishing" });
    try {
      const preview = await service.dispatch({
        type: "share.apply-trim",
        commandId: newCommandId(),
        source: "rider",
        label: "Prepare the phone link",
        payload: { source: effectiveSource, privacy: NO_PRIVACY_TRIM },
      });
      if (!preview.ok) {
        setState({ kind: "error", message: preview.message });
        return;
      }
      if (preview.kind !== "preview") return;
      if (snapshotBytes(preview.output) > SHARE_SNAPSHOT_MAX_BYTES) {
        setState({ kind: "error", message: OVER_BUDGET_MESSAGE });
        return;
      }
      const published: ShareCommandResult = await service.dispatch({
        type: "share.publish",
        commandId: newCommandId(),
        source: "rider",
        label: "Create the phone link",
        payload: { snapshot: preview.snapshot },
      });
      if (published.ok && published.kind === "published") {
        setState({ kind: "published", record: published.record, link: published.link });
      } else if (!published.ok) {
        setState({ kind: "error", message: published.message });
      }
    } catch (error: unknown) {
      setState({
        kind: "error",
        message:
          error instanceof Error && error.message.length > 0
            ? error.message
            : "The link could not be sent. Try again when online.",
      });
    }
  }, [effectiveSource, service]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void publish();
  }, [publish]);

  const handleRemove = useCallback(async (): Promise<void> => {
    if (state.kind !== "published") return;
    setBusy(true);
    try {
      const result = await service.dispatch({
        type: "share.revoke",
        commandId: newCommandId(),
        source: "rider",
        label: "Remove the phone link",
        payload: { shareId: state.record.shareId },
      });
      if (result.ok && result.kind === "revoked") setState({ kind: "removed" });
      else if (!result.ok) setState({ kind: "error", message: result.message });
    } catch (error: unknown) {
      setState({
        kind: "error",
        message:
          error instanceof Error && error.message.length > 0
            ? error.message
            : "The link could not be removed. Try again when online.",
      });
    } finally {
      setBusy(false);
    }
  }, [service, state]);

  const matrix = useMemo(
    () => (state.kind === "published" ? qrMatrix(state.link) : null),
    [state],
  );

  return (
    <div className="og-share__backdrop">
      <section
        ref={dialogRef}
        className="og-share-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Send to phone"
        data-testid="send-to-phone-sheet"
      >
        <header className="og-share-sheet__header">
          <h2>Send to phone</h2>
          <button type="button" className="og-secondary" onClick={onClose}>
            Close
          </button>
        </header>

        <p className="og-composer__reason">
          Scan this code with your phone’s camera, or open the link there. The ride opens ready to start.
        </p>

        {state.kind === "publishing" ? (
          <p role="status">Making the link…</p>
        ) : null}

        {state.kind === "error" ? (
          <p className="og-planner__error" role="alert" data-testid="send-to-phone-error">
            {state.message}
          </p>
        ) : null}

        {state.kind === "removed" ? (
          <p role="status" data-testid="send-to-phone-removed">
            Link removed. It no longer opens this ride.
          </p>
        ) : null}

        {state.kind === "published" && matrix !== null ? (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "var(--og-space-3)",
                background: "var(--og-surface)",
                color: "var(--og-ink)",
                border: "1px solid var(--og-line)",
                borderRadius: "var(--og-radius-control)",
              }}
            >
              <svg
                data-testid="send-to-phone-qr"
                width={240}
                height={240}
                viewBox={`0 0 ${matrix.size} ${matrix.size}`}
                role="img"
                aria-label="QR code for the share link"
                shapeRendering="crispEdges"
              >
                <path d={qrPath(matrix)} fill="currentColor" />
              </svg>
            </div>

            <p
              data-testid="send-to-phone-link"
              style={{
                padding: "var(--og-space-3)",
                background: "var(--og-surface-2)",
                borderRadius: "var(--og-radius-control)",
                color: "var(--og-ink)",
                fontFamily: "var(--og-face-mono)",
                fontSize: "var(--og-text-meta)",
                userSelect: "all",
                overflowWrap: "anywhere",
              }}
            >
              {state.link}
            </p>

            <div className="og-share-sheet__actions">
              <button
                type="button"
                className="og-secondary"
                data-testid="send-to-phone-remove"
                disabled={busy}
                onClick={() => {
                  void handleRemove();
                }}
              >
                {busy ? "Removing…" : "Remove link"}
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
