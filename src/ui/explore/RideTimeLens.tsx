"use client";
import type { RideTimeLens as Lens } from "@/application/explore/time-lens";
import { localDateValue } from "@/application/explore/time-lens";

/**
 * When the rider wants to ride.
 *
 * Four date choices under a visible "When" caption, laid out as one wrapping
 * row of 48px chips: stacked full-width buttons pushed the sheet's "Show N
 * routes" below the fold of a 640px tall phone.
 */
export function RideTimeLens({
  value,
  date,
  onChange,
  onDateChange,
}: {
  readonly value: Lens;
  readonly date: string;
  readonly onChange: (value: Lens) => void;
  readonly onDateChange: (value: string) => void;
}) {
  const today = new Date();
  const last = new Date(today);
  last.setDate(last.getDate() + 179);
  return (
    <div
      className="og-explore__row og-explore__row--when"
      role="group"
      aria-labelledby="og-explore-when-label"
    >
      <span className="og-explore__row-label" id="og-explore-when-label">When</span>
      {(
        [
          ["now", "Now"],
          ["weekend", "This weekend"],
          ["next-weekend", "Next weekend"],
          ["date", "Pick date"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          className="og-explore__quick-chip"
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
      {value === "date" ? (
        <label className="og-explore__inline">
          Ride date
          <input
            className="og-explore__date"
            type="date"
            value={date}
            min={localDateValue(today)}
            max={localDateValue(last)}
            onChange={(event) => {
              if (event.target.validity.valid && event.target.value)
                onDateChange(event.target.value);
            }}
          />
        </label>
      ) : null}
    </div>
  );
}
