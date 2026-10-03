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
      className="flex flex-wrap items-center gap-2 py-4"
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
          className="og-explore__quick-chip focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
      {value === "date" ? (
        <label className="flex items-center gap-2">
          Ride date
          <input
            className="rounded-lg border border-[var(--og-slate)] bg-[var(--og-canvas)] p-2 focus-visible:outline focus-visible:outline-2"
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
