"use client";

/**
 * A Free Ride offer (#14), read at a glance like an Uber driver's request:
 * big minutes and miles, up to three facts, where it ends, and a countdown.
 * Swipe right (or Take) to ride it, left (or Skip) to pass. Arrow keys work
 * too. Doing nothing lets it lapse, which counts as a skip.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { RideOfferSummary } from "@/application/free-ride/ride-offers";
import { formatDistance } from "@/application/planner/measurements";

/** How far a drag must travel to count as a swipe. */
const SWIPE_THRESHOLD_PX = 90;

export interface RideOfferCardProps {
  readonly summary: RideOfferSummary;
  readonly shownAt: string;
  readonly lifetimeMs: number;
  readonly onTake: () => void;
  readonly onSkip: () => void;
}

export function RideOfferCard({ summary, shownAt, lifetimeMs, onTake, onSkip }: RideOfferCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ readonly pointerId: number; readonly startX: number; dx: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(() => Math.ceil(lifetimeMs / 1_000));

  useEffect(() => {
    const deadline = Date.parse(shownAt) + lifetimeMs;
    const tick = (): void => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)));
    const handle = window.setInterval(tick, 1_000);
    return () => window.clearInterval(handle);
  }, [shownAt, lifetimeMs]);

  useEffect(() => {
    // The ring drains over the offer's lifetime; reduced motion keeps only the seconds.
    cardRef.current?.style.setProperty("--og-offer-lifetime", `${lifetimeMs}ms`);
  }, [lifetimeMs]);

  function setOffset(dx: number): void {
    const card = cardRef.current;
    if (card === null) return;
    card.style.setProperty("--og-offer-dx", `${dx}px`);
    card.dataset.leaning = dx > SWIPE_THRESHOLD_PX / 2 ? "take" : dx < -SWIPE_THRESHOLD_PX / 2 ? "skip" : "";
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    if ((event.target as HTMLElement).closest("button") !== null) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, dx: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    cardRef.current?.setAttribute("data-dragging", "true");
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    current.dx = event.clientX - current.startX;
    setOffset(current.dx);
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>): void {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    drag.current = null;
    cardRef.current?.removeAttribute("data-dragging");
    if (current.dx >= SWIPE_THRESHOLD_PX) onTake();
    else if (current.dx <= -SWIPE_THRESHOLD_PX) onSkip();
    else setOffset(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onTake();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onSkip();
    }
  }

  return (
    <div
      ref={cardRef}
      className="og-ride-offer og-ride__floating-card"
      data-testid="ride-offer"
      role="group"
      aria-roledescription="ride offer"
      aria-label={`${summary.title}: ${summary.minutes} minutes, ${formatDistance(summary.distanceMeters)}. Swipe right to take, left to skip.`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div className="og-ride-offer__top">
        <p className="og-ride-offer__kicker">{summary.kicker}</p>
        <span className="og-ride-offer__timer" aria-label={`${secondsLeft} seconds left`}>
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle className="og-ride-offer__timer-track" cx="18" cy="18" r="15.9" />
            <circle className="og-ride-offer__timer-fill" cx="18" cy="18" r="15.9" pathLength="100" />
          </svg>
          <span aria-hidden="true">{secondsLeft}</span>
        </span>
      </div>
      <p className="og-ride-offer__figures" data-testid="ride-offer-figures">
        <strong>{summary.minutes}</strong><span> min</span>
        <span className="og-ride-offer__dot" aria-hidden="true">·</span>
        <strong>{formatDistance(summary.distanceMeters)}</strong>
      </p>
      <p className="og-ride-offer__title" data-testid="ride-offer-title">{summary.title}</p>
      {summary.chips.length === 0 ? null : (
        <ul className="og-ride-offer__chips" aria-label="About this ride">
          {summary.chips.map((chip) => <li key={chip}>{chip}</li>)}
        </ul>
      )}
      <div className="og-ride-offer__actions">
        <button type="button" className="og-ride__action og-ride-offer__skip" data-testid="ride-offer-skip" onClick={onSkip}>
          Skip
        </button>
        <button
          type="button"
          className="og-ride__action og-ride__action--primary og-ride-offer__take"
          data-testid="ride-offer-take"
          onClick={onTake}
        >
          Take
        </button>
      </div>
    </div>
  );
}
