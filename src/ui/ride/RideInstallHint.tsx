"use client";

/**
 * A small, dismissible hint for iPhone Safari riders: the home-screen app runs
 * full screen. Shows for the first 10 s of the ride screen only, once ever
 * (dismissal is remembered), and never in the installed app.
 */

import { useEffect, useState } from "react";

import "./ride-music.css";
import {
  INSTALL_HINT_WINDOW_MS,
  readInstallHintDismissed,
  readStandalone,
  shouldShowInstallHint,
  writeInstallHintDismissed,
} from "./install-hint";

export function RideInstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = shouldShowInstallHint(
      {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
        standalone: readStandalone(),
        dismissed: readInstallHintDismissed(),
      },
      0,
    );
    if (!show) return;
    queueMicrotask(() => setVisible(true));
    const timer = window.setTimeout(() => setVisible(false), INSTALL_HINT_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return (
    <aside className="og-ride-install-hint" data-testid="ride-install-hint" role="note">
      <p>
        Add OpenGravel to your Home Screen for full-screen rides. Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
      </p>
      <button
        type="button"
        className="og-ride-install-hint__close"
        data-testid="ride-install-hint-dismiss"
        aria-label="Dismiss"
        onClick={() => {
          writeInstallHintDismissed();
          setVisible(false);
        }}
      >
        ×
      </button>
    </aside>
  );
}
