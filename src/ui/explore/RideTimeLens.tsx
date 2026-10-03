"use client";
import type { RideTimeLens as Lens } from "@/application/explore/time-lens";
import { localDateValue } from "@/application/explore/time-lens";

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
      className="og-explore__row"
      role="group"
      aria-label="Ride time"
    >
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
