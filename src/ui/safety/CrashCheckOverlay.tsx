"use client";

/**
 * The screen a suspected crash interrupts the ride with (issue #12 follower
 * safety). It is not a sheet and not dismissible by accident:
 *
 * - **Two huge choices, nothing else.** "I'm OK" fills at least 40 % of the
 *   viewport height, and the countdown digits are larger still. A rider with
 *   gloves on, or a bystander, can hit it without aiming. "Alert now" and
 *   "Call 911" sit underneath as secondary controls — one is an escalation the
 *   rider chooses, the other is a plain `tel:` link the phone dials.
 * - **Explicit only.** There is no close button, no backdrop click and no
 *   Escape: the state machine stays up until the rider or the countdown ends
 *   it, so a stray keypress cannot silence a crash alert. Escape is swallowed
 *   here so the ride screen's own handlers cannot act either.
 * - **After escalation the wording changes.** The alert is already out, so the
 *   screen says followers were told and offers "I'm OK now" (which the ride
 *   screen turns into retraction), never a fresh dismissal that would imply
 *   nothing was sent.
 *
 * The component owns presentation and focus only: the phase, the seconds and
 * the callbacks come from `application/safety/crash-alert`. Haptics go through
 * `navigator.vibrate` when the device has it; the pulse is a CSS animation that
 * `prefers-reduced-motion` removes.
 *
 * Focus is trapped by this component rather than `ui/hooks/use-dialog-focus`
 * on purpose: that hook closes its dialog on Escape, which is exactly the
 * behaviour this screen must not have.
 */

import { useEffect, useId, useRef } from "react";

/** Who is told by default when no follower name is available. */
const DEFAULT_AUDIENCE = "your followers";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Two pulses so the phone is felt through a jacket even if it is not seen. */
const COUNTDOWN_VIBRATION: readonly number[] = [400, 200, 400];
const ESCALATED_VIBRATION: readonly number[] = [500, 150, 500, 150, 700];

function vibrate(pattern: readonly number[]): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate([...pattern]);
  } catch {
    // Vibration is a nicety; a device that refuses it must not break the alert.
  }
}

export type CrashCheckStatus = "countdown" | "escalated";

export interface CrashCheckOverlayProps {
  /** `escalated` means the alert is already out and the copy must say so. */
  readonly status: CrashCheckStatus;
  /** Whole seconds left; only meaningful while `status` is `countdown`. */
  readonly secondsRemaining: number;
  /** A follower or group name, or `"your followers"` by default. */
  readonly audience?: string;
  /** The countdown's "I'm OK": dismiss, nothing was sent. */
  readonly onImOkay: () => void;
  /** "Alert now": escalate without waiting out the countdown. */
  readonly onAlertNow: () => void;
  /** After escalation: "I'm OK now", which the caller turns into a retraction. */
  readonly onImOkayNow: () => void;
}

export function CrashCheckOverlay({
  status,
  secondsRemaining,
  audience,
  onImOkay,
  onAlertNow,
  onImOkayNow,
}: CrashCheckOverlayProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const lineId = useId();
  const seconds = Math.max(0, Math.ceil(secondsRemaining));
  const who = audience === undefined || audience.trim().length === 0 ? DEFAULT_AUDIENCE : audience;

  useEffect(() => {
    // Focus enters the one control that ends the alarm, and Tab stays inside.
    // Escape is swallowed: silence requires an explicit tap.
    const root = rootRef.current;
    if (root === null) return;
    const doc = root.ownerDocument;
    const invoker = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    primaryRef.current?.focus();

    const focusables = (): HTMLElement[] =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute("disabled") && !element.hasAttribute("hidden"),
      );

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        root.focus();
        return;
      }
      const active = doc.activeElement;
      const inside = active instanceof Node && root.contains(active);
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    doc.addEventListener("keydown", handleKeyDown, true);
    return () => {
      doc.removeEventListener("keydown", handleKeyDown, true);
      if (invoker !== null && doc.contains(invoker)) invoker.focus();
    };
  }, []);

  // Each phase buzzes in its own pattern and lands focus on its primary
  // control, so an in-place escalation is felt and is immediately actionable.
  useEffect(() => {
    vibrate(status === "countdown" ? COUNTDOWN_VIBRATION : ESCALATED_VIBRATION);
    primaryRef.current?.focus();
  }, [status]);

  return (
    <section
      ref={rootRef}
      className="og-ride-crash"
      data-testid="crash-check-overlay"
      data-status={status}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={lineId}
      tabIndex={-1}
    >
      <div className="og-ride-crash__panel">
        <p className="og-ride-crash__eyebrow">
          {status === "countdown" ? "Possible crash" : "Alert sent"}
        </p>
        <h2 id={titleId} className="og-ride-crash__title">
          Are you OK?
        </h2>

        {status === "countdown" ? (
          <>
            <p className="og-ride-crash__countdown" data-testid="crash-check-countdown">
              <span className="og-ride-crash__digits" aria-hidden="true">
                {seconds}
              </span>
              <span className="og-ride-crash__unit" aria-hidden="true">
                s
              </span>
              <span className="og-visually-hidden">{`${seconds} seconds left`}</span>
            </p>
            <p id={lineId} className="og-ride-crash__line" data-testid="crash-check-line">
              {`Crash detected? We'll alert ${who} in ${seconds} s.`}
            </p>
            <div className="og-ride-crash__actions">
              <button
                ref={primaryRef}
                type="button"
                className="og-ride-crash__ok"
                data-testid="crash-check-im-okay"
                onClick={onImOkay}
              >
                I&rsquo;m OK
              </button>
              <div className="og-ride-crash__secondary">
                <button
                  type="button"
                  className="og-ride-crash__alert"
                  data-testid="crash-check-alert-now"
                  onClick={onAlertNow}
                >
                  Alert now
                </button>
                <a className="og-ride-crash__call" href="tel:911" data-testid="crash-check-call">
                  Call 911
                </a>
              </div>
            </div>
          </>
        ) : (
          <>
            <p id={lineId} className="og-ride-crash__line" data-testid="crash-check-line">
              Your followers were alerted with your location.
            </p>
            <div className="og-ride-crash__actions">
              <button
                ref={primaryRef}
                type="button"
                className="og-ride-crash__ok"
                data-testid="crash-check-im-okay-now"
                onClick={onImOkayNow}
              >
                I&rsquo;m OK now
              </button>
              <div className="og-ride-crash__secondary">
                <a className="og-ride-crash__call" href="tel:911" data-testid="crash-check-call">
                  Call 911
                </a>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
