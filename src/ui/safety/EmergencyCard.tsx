"use client";

/**
 * "Where am I / Emergency" (HIKE-MODE-PLAN H4 §19).
 *
 * The card a rider or hiker opens when something has gone wrong, or might: it
 * prints the position three ways (decimal degrees, DMS, USNG/MGRS), the
 * altitude and GPS accuracy when the device reports them, and the nearest road
 * with its distance and direction when the map holds one. Each coordinate has
 * its own copy button, the phone's own dialler is one `tel:` link away, and
 * "Share location" sends the whole block through the system share sheet, or
 * copies it when the device has none.
 *
 * It is built for the worst moment, not the best one:
 *
 * - **Nothing it needs is online.** The coordinate maths is local, the card is
 *   a modal over the surface it was opened from, and the one optional read (the
 *   nearest road on the ride screen) fails into "unknown" without taking the
 *   card with it.
 * - **Unknown is said out loud.** No fix, no altitude, no accuracy, no road:
 *   each row says "Unknown" and why, because a blank or a zero in this card
 *   would be read as a fact by someone under stress.
 * - **Every target is a glove-sized 44 px or more**, focus is trapped and
 *   returns to the control that opened the card, and nothing pulses or slides
 *   when the rider has asked for reduced motion.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  emergencyCardModel,
  type EmergencyCardModel,
  type EmergencyFormatId,
} from "@/application/safety/emergency-card";
import type { EmergencyRoadRead } from "@/application/safety/emergency-roads";
import { nearestRoad, type NearestRoad, type RoadLine } from "@/domain/geometry/nearest-road";
import type { Coordinate } from "@/domain/ride/types";
import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

/** How long a copy/share confirmation stays under the buttons. */
const STATUS_MS = 4000;

type CardStatus = { readonly tone: "done" | "error"; readonly text: string } | null;

export interface EmergencyCardProps {
  /** The live fix, or the map point the rider pressed. `null` with no fix yet. */
  readonly coordinate: Coordinate | null;
  readonly altitudeMeters?: number | null;
  readonly accuracyMeters?: number | null;
  /** Road lines this surface already holds (the plan map's loaded features). */
  readonly roads?: readonly RoadLine[];
  /** True when `roads` came from road layers that were actually loaded. */
  readonly roadsLoaded?: boolean;
  /**
   * Asks for roads when the surface holds none (the ride map). A rejection or
   * an unavailable provider becomes "unknown"; the card stays usable offline.
   */
  readonly roadRequest?: (point: Coordinate, signal: AbortSignal) => Promise<EmergencyRoadRead>;
  /** The card's heading: "Where am I?" by default. */
  readonly title?: string;
  /** One line under the heading, e.g. "The point you pressed on the map". */
  readonly note?: string | null;
  readonly onClose: () => void;
}

/** The clipboard, or `null` where the browser has not granted it. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || navigator.clipboard === undefined) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Opens the share sheet; falls back to the clipboard. Never throws. */
async function shareText(text: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "My location", text });
      return "shared";
    } catch (error) {
      // A rider who closed the sheet has not failed to share; anything else is
      // still worth putting on the clipboard.
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  return (await writeClipboard(text)) ? "copied" : "failed";
}

export function EmergencyCard({
  coordinate,
  altitudeMeters = null,
  accuracyMeters = null,
  roads,
  roadsLoaded = true,
  roadRequest,
  title = "Where am I?",
  note = null,
  onClose,
}: EmergencyCardProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const [openedAt] = useState(() => new Date());
  const [status, setStatus] = useState<CardStatus>(null);
  const [copied, setCopied] = useState<EmergencyFormatId | null>(null);
  /**
   * The answer `roadRequest` gave, tagged with the point it answered for. A
   * read that arrives after the rider reopened the card for a different point
   * is therefore never shown for the wrong position, and "in flight" needs no
   * extra state (and no setState in an effect).
   */
  const [remoteAnswer, setRemoteAnswer] = useState<{
    readonly key: string;
    readonly read: EmergencyRoadRead;
  } | null>(null);
  /**
   * The position the card first had, kept for two reasons: a card opened before
   * the first fix must not stay empty once the fix arrives, and the optional
   * road read must not fire again on every fresh fix while the rider is looking
   * at it. The nearest road is still measured from the live coordinate.
   */
  const [captured, setCaptured] = useState<Coordinate | null>(coordinate);
  // Adjusted during render (React's own pattern for "remember the first value
  // that arrived"), not in an effect: an effect would paint one empty frame and
  // the new lint rules rightly refuse a synchronous setState there.
  if (captured === null && coordinate !== null) setCaptured(coordinate);
  const shown = coordinate ?? captured;

  useDialogFocus(panelRef, onClose);

  // A surface that holds no road features of its own asks once per card open,
  // around the point in question. The abort on close keeps a slow provider from
  // setting state into an unmounted card.
  useEffect(() => {
    if (roads !== undefined || roadRequest === undefined || captured === null) return;
    const controller = new AbortController();
    const key = `${captured.lat},${captured.lon}`;
    void roadRequest(captured, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setRemoteAnswer({ key, read: result });
      })
      .catch(() => {
        if (!controller.signal.aborted) setRemoteAnswer({ key, read: { roads: [], loaded: false } });
      });
    return () => controller.abort();
    // Keyed on the captured open position only: a rider walking on while the
    // card is open must not trigger one provider read per GPS fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roadRequest, roads, captured?.lat, captured?.lon]);

  useEffect(() => {
    if (status === null) return;
    const timer = window.setTimeout(() => setStatus(null), STATUS_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  const remoteKey = captured === null ? null : `${captured.lat},${captured.lon}`;
  const read = useMemo<EmergencyRoadRead | null>(
    () =>
      roads === undefined
        ? remoteAnswer !== null && remoteAnswer.key === remoteKey
          ? remoteAnswer.read
          : null
        : { roads, loaded: roadsLoaded },
    [roads, roadsLoaded, remoteAnswer, remoteKey],
  );

  const nearest: NearestRoad | null = useMemo(
    () => (read === null || shown === null ? null : nearestRoad(shown, read.roads)),
    [read, shown],
  );

  const modelFor = useCallback(
    (at: Date): EmergencyCardModel =>
      emergencyCardModel({
        coordinate: shown,
        altitudeMeters,
        accuracyMeters,
        nearestRoad: nearest,
        roadsLoaded: read?.loaded === true,
        at,
      }),
    [accuracyMeters, altitudeMeters, shown, nearest, read],
  );
  const model = useMemo(() => modelFor(openedAt), [modelFor, openedAt]);

  const copy = useCallback(
    async (row: { readonly id: EmergencyFormatId; readonly label: string; readonly copyValue: string | null }) => {
      if (row.copyValue === null) return;
      if (await writeClipboard(row.copyValue)) {
        setCopied(row.id);
        setStatus({ tone: "done", text: `${row.label} copied.` });
        return;
      }
      setStatus({ tone: "error", text: "Couldn't copy. Read the value out or write it down." });
    },
    [],
  );

  const share = useCallback(async () => {
    const outcome = await shareText(modelFor(new Date()).shareText);
    setStatus(
      outcome === "shared"
        ? { tone: "done", text: "Location shared." }
        : outcome === "copied"
          ? { tone: "done", text: "Location copied. Paste it into a message." }
          : outcome === "failed"
            ? { tone: "error", text: "Couldn't share this location. Read the coordinates to your contact." }
            : null,
    );
  }, [modelFor]);

  const roadDetail = model.road.detail;
  return (
    <div className="og-emergency" data-testid="emergency-card-layer">
      <div className="og-emergency__scrim" aria-hidden="true" />
      <div
        ref={panelRef}
        className="og-emergency__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="emergency-card"
        tabIndex={-1}
      >
        <header className="og-emergency__head">
          <div className="og-emergency__heading">
            <p className="og-emergency__eyebrow">Emergency</p>
            <h2 className="og-emergency__title" id={headingId}>
              {title}
            </h2>
          </div>
          <button
            type="button"
            className="og-emergency__close"
            data-testid="emergency-close"
            aria-label="Close"
            onClick={onClose}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        {note === null ? null : <p className="og-emergency__note">{note}</p>}

        {model.formats.length === 0 ? (
          <p className="og-emergency__nofix" data-testid="emergency-no-fix" role="status">
            No GPS fix yet. The coordinates appear here as soon as this device has a position.
          </p>
        ) : (
          <ul className="og-emergency__formats" aria-label="Your position">
            {model.formats.map((row) => (
              <li key={row.id} className="og-emergency__row" data-testid={`emergency-${row.id}`}>
                <div className="og-emergency__row-text">
                  <p className="og-emergency__row-label">{row.label}</p>
                  <p className="og-emergency__row-value">{row.value}</p>
                </div>
                <button
                  type="button"
                  className="og-emergency__copy"
                  data-testid={`emergency-copy-${row.id}`}
                  aria-label={
                    row.copyValue === null
                      ? `${row.label} is not available`
                      : copied === row.id
                        ? `${row.label} copied`
                        : `Copy ${row.label}`
                  }
                  disabled={row.copyValue === null}
                  onClick={(): void => void copy(row)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="9" width="11" height="12" rx="2" />
                    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
                  </svg>
                  <span>{copied === row.id ? "Copied" : "Copy"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <dl className="og-emergency__facts">
          <div className="og-emergency__fact">
            <dt>Altitude</dt>
            <dd data-testid="emergency-altitude" data-known={model.altitudeKnown ? "true" : "false"}>
              {model.altitude}
            </dd>
          </div>
          <div className="og-emergency__fact">
            <dt>GPS accuracy</dt>
            <dd data-testid="emergency-accuracy">{model.accuracy ?? "Unknown"}</dd>
          </div>
          <div className="og-emergency__fact og-emergency__fact--wide">
            <dt>Nearest road</dt>
            <dd data-testid="emergency-road" data-known={model.road.known ? "true" : "false"}>
              <span className="og-emergency__road-name">{model.road.text}</span>
              {roadDetail === null ? null : (
                <span className="og-emergency__road-detail">{roadDetail}</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="og-emergency__actions">
          <a className="og-emergency__call" href="tel:911" data-testid="emergency-call">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z" />
            </svg>
            Call 911
          </a>
          <button
            type="button"
            className="og-emergency__share"
            data-testid="emergency-share"
            disabled={model.formats.length === 0}
            onClick={(): void => void share()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 15V4M8 8l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
            </svg>
            Share location
          </button>
        </div>

        <p className="og-emergency__status" role="status" data-tone={status?.tone ?? "none"} data-testid="emergency-status">
          {status?.text ?? ""}
        </p>
        <p className="og-emergency__offline">
          Works offline. Coordinates come from this device&apos;s GPS.
        </p>
      </div>
    </div>
  );
}
