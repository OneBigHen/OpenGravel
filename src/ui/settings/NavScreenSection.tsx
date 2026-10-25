"use client";

/**
 * Settings → Navigation screen (app only): OpenGravel's Ride Focus, or the
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

export function NavScreenSection() {
  const screen = useSyncExternalStore<NavScreen>(subscribe, readNavScreen, () => DEFAULT_NAV_SCREEN);

  return (
    <section className="og-settings__section" aria-labelledby="settings-nav-screen-title">
      <div className="og-settings__section-heading">
        <div>
          <h2 id="settings-nav-screen-title">Ride screen</h2>
        </div>
      </div>
      <div className="og-appearance" role="radiogroup" aria-labelledby="settings-nav-screen-title">
        {CHOICES.map((choice) => (
          <button
            key={choice.screen}
            type="button"
            role="radio"
            aria-checked={screen === choice.screen}
            className="og-appearance__choice"
            data-testid={`nav-screen-${choice.screen}`}
            onClick={() => setNavScreen(choice.screen)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <p className="og-settings__section-copy">
        Turn-by-turn leaves out your stats and Fuel ahead. Applies from the next ride.
      </p>
    </section>
  );
}
