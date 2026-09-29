"use client";

/**
 * Settings → Display: Auto, Day or Night. Day is the high-visibility bright
 * theme for riding in sunlight; Night is Trail Glass dark; Auto follows the
 * phone. One tap applies it everywhere (src/ui/appearance/appearance.ts).
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

export function AppearanceSection() {
  const mode = useSyncExternalStore<AppearanceMode>(subscribe, readAppearanceMode, () => "auto");

  return (
    <section className="og-settings__section" aria-labelledby="settings-appearance-title">
      <div className="og-settings__section-heading">
        <div>
          <p className="og-settings__eyebrow">DISPLAY</p>
          <h2 id="settings-appearance-title">Day / Night</h2>
        </div>
      </div>
      <div className="og-appearance" role="radiogroup" aria-labelledby="settings-appearance-title">
        {CHOICES.map((choice) => (
          <button
            key={choice.mode}
            type="button"
            role="radio"
            aria-checked={mode === choice.mode}
            className="og-appearance__choice"
            data-testid={`appearance-${choice.mode}`}
            onClick={() => setAppearanceMode(choice.mode)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <p className="og-settings__section-copy">
        Day is bright and high-contrast for riding in sunlight. Auto follows your phone.
      </p>
    </section>
  );
}
