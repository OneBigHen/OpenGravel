"use client";

/**
 * Settings → Display: Auto, Day or Night as a three-way segmented control in
 * its own row. Day is the high-visibility bright theme for riding in sunlight;
 * Night is Trail Glass dark; Auto follows the phone. One tap applies it
 * everywhere (src/ui/appearance/appearance.ts).
 */

import { useSyncExternalStore } from "react";

import {
  APPEARANCE_CHANGE_EVENT,
  readAppearanceMode,
  setAppearanceMode,
  type AppearanceMode,
} from "@/ui/appearance/appearance";

const CHOICES: readonly { readonly mode: AppearanceMode; readonly label: string }[] = [
  { mode: "auto", label: "Auto" },
  { mode: "day", label: "Day" },
  { mode: "night", label: "Night" },
];

function subscribe(onChange: () => void): () => void {
  window.addEventListener(APPEARANCE_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(APPEARANCE_CHANGE_EVENT, onChange);
}

export function AppearanceRow() {
  const mode = useSyncExternalStore<AppearanceMode>(subscribe, readAppearanceMode, () => "auto");

  return (
    <div className="og-settings__row">
      <span className="og-settings__row-text">
        <span className="og-settings__row-label">Day / Night</span>
      </span>
      <div className="og-settings__segmented" role="radiogroup" aria-label="Day / Night">
        {CHOICES.map((choice) => (
          <button
            key={choice.mode}
            type="button"
            role="radio"
            aria-checked={mode === choice.mode}
            className="og-settings__segment"
            data-testid={`appearance-${choice.mode}`}
            onClick={() => setAppearanceMode(choice.mode)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
