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
  { screen: "native", label: "Native" },
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
          <p className="og-settings__eyebrow">RIDING</p>
          <h2 id="settings-nav-screen-title">Navigation screen</h2>
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
        {screen === "opengravel"
          ? "Our ride screen: your three stats, Places and Fuel ahead. Voice, GPS and the Lock Screen still run natively."
          : "The built-in turn-by-turn screen. Your stats, Places and Fuel ahead are not shown on it."}
        {" "}Applies from the next ride or Resume.
      </p>
    </section>
  );
}
