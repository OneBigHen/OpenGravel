"use client";

/**
 * What the ride screen says with no signal (R3-7). The chip is neutral ink:
 * no signal is a fact, not an alarm. The sheet rows are the things that need a
 * server, disabled and saying why, so nothing pretends to work.
 */

import "./ride-no-signal.css";

export function RideNoSignalChip({ kept }: { readonly kept: boolean }) {
  return (
    <p className="og-ride__no-signal" data-testid="ride-no-signal" data-kept={kept ? "true" : "false"} role="status">
      {kept ? "No signal, kept ride" : "No signal"}
    </p>
  );
}

const ROWS = ["Weather along the route", "Find gas or food", "New route from here"] as const;

export function RideNoSignalRows() {
  return (
    <ul className="og-ride__no-signal-rows" data-testid="ride-no-signal-rows" aria-label="Needs signal">
      {ROWS.map((row) => (
        <li key={row}>
          <button type="button" className="og-ride__no-signal-row" disabled aria-disabled="true">
            <span>{row}</span>
            <span className="og-ride__no-signal-why">No signal</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
