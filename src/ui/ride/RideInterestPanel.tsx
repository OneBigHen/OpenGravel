"use client";

/**
 * The ride sheet's ride-along interest block (OGV#13 §3): the Scenic / Food &
 * fuel / Events / Off filter, and the one "coming up" row a rider can tap
 * open. Lives in the existing sheet, not as new map chrome — the owner's
 * rule is to hide rather than add (ride screen stays map-first).
 */

import { RIDE_INTEREST_FILTERS, type RideInterestChip, type RideInterestFilter } from "@/application/ride-interest";

export interface RideInterestPanelProps {
  readonly filter: RideInterestFilter;
  readonly onSetFilter: (filter: RideInterestFilter) => void;
  readonly chip: RideInterestChip | null;
  readonly onOpenChip: () => void;
}

const FILTER_LABELS: Readonly<Record<RideInterestFilter, string>> = {
  scenic: "Scenic",
  food: "Food & fuel",
  events: "Events",
  off: "Off",
};

export function RideInterestPanel({ filter, onSetFilter, chip, onOpenChip }: RideInterestPanelProps) {
  return (
    <section className="og-ride-interest" aria-label="Ride-along interest" data-testid="ride-interest-panel">
      <div className="og-ride-interest__filters" role="group" aria-label="Show along the route">
        {RIDE_INTEREST_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className="og-ride-interest__filter"
            data-testid={`ride-interest-filter-${value}`}
            aria-pressed={filter === value}
            onClick={() => onSetFilter(value)}
          >
            {FILTER_LABELS[value]}
          </button>
        ))}
      </div>
      {chip === null ? null : (
        <button
          type="button"
          className="og-ride-interest__chip"
          data-testid="ride-interest-chip"
          onClick={onOpenChip}
        >
          <span className="og-ride-interest__chip-glyph" aria-hidden="true">◭</span>
          <span>{chip.label}</span>
        </button>
      )}
    </section>
  );
}
