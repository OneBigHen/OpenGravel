"use client";

/**
 * Settings → More on the map: the side features that stay off the first screen
 * (milestone 3, "one clean front door"). The map opens with search, Loop and
 * Ride; each of these is one switch away, and turning it on puts it back
 * exactly where it was. Hiking and music have their own groups on this page.
 */

import { SettingsGroup } from "@/ui/settings/SettingsGroup";
import { setFrontDoorOption, useFrontDoorOption, type FrontDoorOption } from "@/ui/stores/front-door-options";

const ROWS: readonly {
  readonly option: FrontDoorOption;
  readonly label: string;
  readonly meta: string;
  readonly testId: string;
}[] = [
  {
    option: "ask",
    label: "Ask",
    meta: "Describe a ride in your own words. Adds an Ask button to the map and under a planned ride.",
    testId: "settings-ask-toggle",
  },
  {
    option: "cameras",
    label: "Traffic cameras",
    meta: "Adds road cameras to the Layers panel.",
    testId: "settings-cameras-toggle",
  },
];

function FrontDoorRow({ option, label, meta, testId }: (typeof ROWS)[number]) {
  const on = useFrontDoorOption(option);
  return (
    <label className="og-settings__row og-settings__row--switch">
      <span className="og-settings__row-text">
        <span className="og-settings__row-label">{label}</span>
        <span className="og-settings__row-meta">{meta}</span>
      </span>
      {/* The same track-and-knob switch as Avoid highways / Avoid tolls in the planner. */}
      <span className="og-style__switch">
        <input
          type="checkbox"
          role="switch"
          aria-label={label}
          data-testid={testId}
          checked={on}
          onChange={(event) => setFrontDoorOption(option, event.target.checked)}
        />
      </span>
    </label>
  );
}

export function FrontDoorSection() {
  return (
    <SettingsGroup
      id="settings-front-door-title"
      label="More on the map"
      hint="The map opens with search, Loop and Ride. Turn these on to bring them back."
      testId="settings-front-door"
    >
      {ROWS.map((row) => <FrontDoorRow key={row.option} {...row} />)}
    </SettingsGroup>
  );
}
