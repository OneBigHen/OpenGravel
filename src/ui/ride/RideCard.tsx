"use client";

/**
 * The ride card (R3-2): one solid card that ends a ride and lives on in My rides.
 *
 * The rider sees the line they rode, drawn in plum on the app's own picture, the
 * ride's name and day, and the four numbers they say out loud afterwards: miles,
 * moving time, dirt miles and climb. A number the ride never recorded is an em
 * dash, never a zero — the same rule as everywhere else.
 *
 * Three ways on, in the order a rider reaches for them:
 * - **Done** leaves for My rides, Ridden tab, where the ride is kept.
 * - **Share** draws the same card as a 1080×1350 PNG on a canvas in the browser
 *   and hands it to the phone's share sheet; where the browser cannot share a
 *   file the button says "Save picture" and downloads it instead.
 * - **GPX** writes the line as a track the rider can keep anywhere.
 *
 * Solid, not glass (DESIGN.md §2, 2026-11-10): this card sits on the ride sheet
 * and on a page, and a picture of the ride must not depend on what is behind it.
 */

import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";

import { downloadExport } from "@/application/export/gpx-export";
import type { RideCard as RideCardModel } from "@/application/ride-metrics/ride-card";
import { distanceStat } from "@/application/ride-metrics/ride-summary";
import { useResolvedTheme } from "@/ui/appearance/use-appearance";
import {
  projectTrackPoints,
  toPolylinePoints,
  type TrackProjectionBox,
} from "@/ui/rides/track-projection";

/** The card's picture box in its own units: wide, and tall enough for a loop. */
export const RIDE_CARD_BOX: TrackProjectionBox = { width: 320, height: 190, padding: 14 };

/** The exported picture: portrait, the phone's own shape scale (1080 × 1350). */
const PNG_WIDTH = 1080;
const PNG_HEIGHT = 1350;

export interface RideCardProps {
  readonly card: RideCardModel;
  /** "Ride finished" on the surface that just ended the ride; absent in My rides. */
  readonly headline?: string | null;
  /** Where Done goes. `/rides?tab=ridden` keeps a finished ride in one tap. */
  readonly doneHref?: string;
  /** A Done that stays on the page (the card opened from a ride's row). */
  readonly onDone?: () => void;
  readonly doneLabel?: string;
  /** "Export GPX" for the line on this card; absent hides the button. */
  readonly onGpx?: () => void;
  /** A quiet way back to the planner, on the surface that ended the ride. */
  readonly exitHref?: string;
  readonly className?: string;
}

function timeText(iso: string | null): string | null {
  if (iso === null) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function cardFilename(card: RideCardModel): string {
  const slug = card.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `opengravel-${slug.length === 0 ? "ride" : slug}.png`;
}

function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

/**
 * The same card, drawn on a canvas: 1080 × 1350, in the theme the rider is
 * reading. Returns `null` when this browser cannot make a picture at all.
 */
async function renderCardPng(card: RideCardModel, night: boolean): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = PNG_WIDTH;
  canvas.height = PNG_HEIGHT;
  const context = canvas.getContext("2d");
  if (context === null) return null;

  const surface = token("--og-surface", night ? "#131a17" : "#fdfcf9");
  const ink = token("--og-ink", night ? "#ecf1ee" : "#0f1a15");
  const ink2 = token("--og-ink-2", night ? "#a2aea8" : "#46524c");
  const route = token("--og-route", night ? "#b48ae0" : "#7b4fa0");
  const line = token("--og-line", night ? "rgb(255 255 255 / 9%)" : "rgb(15 26 21 / 12%)");

  context.fillStyle = surface;
  context.fillRect(0, 0, PNG_WIDTH, PNG_HEIGHT);

  const margin = 80;
  const display = '"Outfit", "Plus Jakarta Sans", system-ui, sans-serif';
  const body = '"Plus Jakarta Sans", system-ui, sans-serif';

  context.fillStyle = ink2;
  context.font = `700 28px ${body}`;
  context.textAlign = "left";
  context.fillText("OpenGravel", margin, 96);

  if (card.line.length >= 2) {
    const box = { width: PNG_WIDTH - margin * 2, height: 460, padding: 20 };
    const projected = projectTrackPoints(card.line, card.line, box);
    context.strokeStyle = line;
    context.lineWidth = 2;
    context.strokeRect(margin, 140, box.width, box.height);
    context.strokeStyle = route;
    context.lineWidth = 10;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    projected.forEach((point, index) => {
      const x = margin + point.x;
      const y = 140 + point.y;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    const first = projected[0];
    const last = projected[projected.length - 1];
    context.fillStyle = route;
    for (const point of [first, last]) {
      if (point === undefined) continue;
      context.beginPath();
      context.arc(margin + point.x, 140 + point.y, 12, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.fillStyle = ink;
  context.font = `700 64px ${display}`;
  context.fillText(card.title, margin, 700);
  context.fillStyle = ink2;
  context.font = `500 30px ${body}`;
  const start = timeText(card.startedAt);
  const end = timeText(card.endedAt);
  context.fillText(
    start === null || end === null ? card.date : `${card.date} · ${start}–${end}`,
    margin,
    750,
  );

  const stats = [
    { label: card.units === "metric" ? "Km" : "Miles", value: card.numbers.distance },
    { label: "Moving", value: card.numbers.moving },
    { label: "Dirt", value: card.numbers.dirt },
    { label: "Climb", value: card.numbers.climb },
  ];
  const column = (PNG_WIDTH - margin * 2) / stats.length;
  stats.forEach((stat, index) => {
    const x = margin + index * column;
    context.fillStyle = ink2;
    context.font = `700 26px ${body}`;
    context.fillText(stat.label.toUpperCase(), x, 900);
    context.fillStyle = ink;
    context.font = `700 72px ${display}`;
    context.fillText(stat.value?.value ?? "—", x, 980);
    if (stat.value !== null) {
      context.fillStyle = ink2;
      context.font = `600 26px ${body}`;
      context.fillText(stat.value.unit, x, 1016);
    }
  });

  if (card.surface.unknownMeters > 1) {
    const unknown = distanceStat(card.surface.unknownMeters, card.units);
    context.fillStyle = ink2;
    context.font = `500 26px ${body}`;
    context.fillText(`${unknown.value} ${unknown.unit} of surface unknown`, margin, 1090);
  }

  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

function Stat({ id, label, value }: { readonly id: string; readonly label: string; readonly value: { readonly value: string; readonly unit: string } | null }) {
  return (
    <div className="og-ride-card__stat" data-testid={`ride-card-${id}`} data-unknown={value === null ? "true" : undefined}>
      <dt>{label}</dt>
      <dd>
        <span className="og-ride-card__number">{value?.value ?? "—"}</span>
        {value === null ? null : <span className="og-ride-card__unit">{value.unit}</span>}
        {value === null ? <span className="og-visually-hidden">not measured</span> : null}
      </dd>
    </div>
  );
}

export function RideCard({
  card,
  headline = null,
  doneHref,
  onDone,
  doneLabel = "Done",
  onGpx,
  exitHref,
  className,
}: RideCardProps) {
  const night = useResolvedTheme() === "night";
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A server render cannot know whether this browser shares a file, so the
  // button's label comes from the browser's own answer, read once on the client
  // (the capability never changes while the card is open).
  const canShareFile = useSyncExternalStore(
    () => () => undefined,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function",
    () => false,
  );

  const share = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setShareMessage(null);
    try {
      const blob = await renderCardPng(card, night);
      if (blob === null) {
        setShareMessage("This browser cannot make the picture.");
        return;
      }
      const file = typeof File === "function" ? new File([blob], cardFilename(card), { type: "image/png" }) : null;
      const data = file === null ? null : { files: [file], title: card.title };
      if (data !== null && typeof navigator.canShare === "function" && navigator.canShare(data) && typeof navigator.share === "function") {
        try {
          await navigator.share(data);
          return;
        } catch (error) {
          // The rider changed their mind: nothing to say, nothing to save.
          if (error instanceof Error && error.name === "AbortError") return;
        }
      }
      downloadExport(new Uint8Array(await blob.arrayBuffer()), cardFilename(card), undefined, "image/png");
    } catch {
      setShareMessage("The picture could not be made.");
    } finally {
      setBusy(false);
    }
  }, [busy, card, night]);

  const start = timeText(card.startedAt);
  const end = timeText(card.endedAt);
  const when = start === null || end === null ? card.date : `${card.date} · ${start}–${end}`;
  const unknown = card.surface.unknownMeters > 1 ? distanceStat(card.surface.unknownMeters, card.units) : null;

  let done: ReactNode;
  if (onDone === undefined && doneHref !== undefined) {
    done = (
      <Link className="og-ride__action og-ride__action--primary" data-testid="ride-summary-rides" href={doneHref}>
        {doneLabel}
      </Link>
    );
  } else if (onDone === undefined) {
    done = null;
  } else {
    done = (
      <button type="button" className="og-ride__action og-ride__action--primary" data-testid="ride-summary-rides" onClick={onDone}>
        {doneLabel}
      </button>
    );
  }

  return (
    <section
      className={className === undefined ? "og-ride-card" : `og-ride-card ${className}`}
      data-testid="ride-card"
      aria-label="Ride card"
    >
      <div className="og-ride-card__plate">
        {headline === null ? null : (
          <h2 className="og-ride-card__headline" data-testid="ride-card-headline" role="status">
            {headline}
          </h2>
        )}
        {card.line.length < 2 ? (
          <p className="og-ride-card__no-line" data-testid="ride-card-no-line">No line was recorded for this ride.</p>
        ) : (
          <svg
            className="og-ride-card__picture"
            viewBox={`0 0 ${RIDE_CARD_BOX.width} ${RIDE_CARD_BOX.height}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`The line of ${card.title}, ${card.date}.`}
            data-testid="ride-card-line"
          >
            <polyline
              className="og-ride-card__line"
              points={toPolylinePoints(projectTrackPoints(card.line, card.line, RIDE_CARD_BOX))}
            />
          </svg>
        )}
        <div className="og-ride-card__identity">
          <h3 className="og-ride-card__title" data-testid="ride-card-title">{card.title}</h3>
          <p className="og-ride-card__date" data-testid="ride-card-date">{when}</p>
        </div>
        <dl className="og-ride-card__numbers">
          <Stat id="miles" label={card.units === "metric" ? "Km" : "Miles"} value={card.numbers.distance} />
          <Stat id="moving" label="Moving" value={card.numbers.moving} />
          <Stat id="dirt" label="Dirt" value={card.numbers.dirt} />
          <Stat id="climb" label="Climb" value={card.numbers.climb} />
        </dl>
        {unknown === null ? null : (
          <p className="og-ride-card__surface" data-testid="ride-card-surface-note">
            {unknown.value} {unknown.unit} of surface unknown
            {card.surface.dirtShare === null ? "" : ` · ${Math.round(card.surface.dirtShare * 100)}% of the measured ride is dirt`}
          </p>
        )}
      </div>
      <div className="og-ride-card__actions">
        {done}
        <button type="button" className="og-ride__action" data-testid="ride-card-share" disabled={busy} onClick={() => void share()}>
          {busy ? "Making picture…" : canShareFile ? "Share" : "Save picture"}
        </button>
        {onGpx === undefined ? null : (
          <button type="button" className="og-ride__action" data-testid="ride-summary-export" onClick={onGpx}>
            GPX
          </button>
        )}
      </div>
      {shareMessage === null ? null : (
        <p className="og-ride-card__message" role="alert" data-testid="ride-card-message">{shareMessage}</p>
      )}
      {exitHref === undefined ? null : (
        <a className="og-ride__action og-ride__action--link" data-testid="ride-exit" href={exitHref}>
          Back to the planner
        </a>
      )}
    </section>
  );
}
