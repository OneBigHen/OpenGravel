"use client";

/**
 * Settings → Display → Ride screen (app only): OpenGravel's Ride Focus, or the
 * native Ferrostar screen. Takes effect on the next ride or Resume.
 */

import { useSyncExternalStore } from "react";

import {
  DEFAULT_NAV_SCREEN,
  NAV_SCREEN_CHANGE_EVENT,
  readNavScreen,
  setNavScreen,
  type NavScreen,
} from "@/ui/navigation/nav-screen";

const CHOICES: readonly { readonly screen: NavScreen; readonly label: string }[] = [
  { screen: "opengravel", label: "OpenGravel" },
  { screen: "native", label: "Turn-by-turn" },
];

function subscribe(onChange: () => void): () => void {
  window.addEventListener(NAV_SCREEN_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(NAV_SCREEN_CHANGE_EVENT, onChange);
}

export function NavScreenRow() {
  const screen = useSyncExternalStore<NavScreen>(subscribe, readNavScreen, () => DEFAULT_NAV_SCREEN);

  return (
    <div className="og-settings__row">
      <span className="og-settings__row-text">
        <span className="og-settings__row-label">Ride screen</span>
        <span className="og-settings__row-meta">Leaves out your stats and Fuel ahead. Applies from the next ride.</span>
      </span>
      <div className="og-settings__segmented" role="radiogroup" aria-label="Ride screen">
        {CHOICES.map((choice) => (
          <button
            key={choice.screen}
            type="button"
            role="radio"
            aria-checked={screen === choice.screen}
            className="og-settings__segment"
            data-testid={`nav-screen-${choice.screen}`}
            onClick={() => setNavScreen(choice.screen)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
