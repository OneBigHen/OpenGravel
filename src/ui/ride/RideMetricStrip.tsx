"use client";

/**
 * The ride instrument strip (RIDE-INSTRUMENT-STRIP §2, §12, §15): exactly three
 * slots, the same renderer for a guided ride, Record and Free Ride.
 *
 * It renders the strip model and nothing else; every value, unit, state and
 * spoken form was decided in `application/ride-metrics`. Each slot is a real
 * button. While the rider may customize (paused, or a fresh speed at or under
 * 5 mph) a tap opens the picker for that slot; while moving it does what the
 * slim strip always did — shows the ride controls — and never cycles metrics.
 */

import type { Ref } from "react";

import type { RideMetricStripModel } from "@/application/ride-metrics/strip";

export interface RideMetricStripProps {
  readonly model: RideMetricStripModel;
  /** Moving (or not customizable) tap: the strip's usual "show the sheet". */
  readonly onShowControls: () => void;
  /** Stopped tap: open the picker for this slot. */
  readonly onChooseSlot: (index: number) => void;
  /** The slot buttons, so focus can return to the one the picker came from. */
  readonly slotRef?: (index: number) => Ref<HTMLButtonElement>;
}

export function RideMetricStrip({ model, onShowControls, onChooseSlot, slotRef }: RideMetricStripProps) {
  return (
    <div
      className="og-ride-metrics"
      data-testid="ride-metric-strip"
      data-mode={model.mode}
      data-customizable={model.customizable ? "true" : "false"}
      data-preset={model.preset?.id ?? "custom"}
      role="group"
      aria-label="Ride readouts"
    >
      {model.slots.map((slot) => {
        const { reading } = slot;
        const over = model.overLimit && reading.id === "speed.current";
        const action = model.customizable ? "Change metric." : "Show ride controls.";
        return (
          <button
            key={slot.index}
            ref={slotRef?.(slot.index)}
            type="button"
            className="og-ride-metrics__slot"
            data-testid={`ride-metric-slot-${slot.index}`}
            data-metric={reading.id}
            data-state={reading.state}
            data-freshness={reading.freshness ?? undefined}
            data-over={over ? "true" : undefined}
            aria-label={`${slot.spokenValue}${over ? " Over the speed limit." : ""} ${action}`}
            onClick={(): void => {
              if (model.customizable) onChooseSlot(slot.index);
              else onShowControls();
            }}
          >
            <span
              className="og-ride-metrics__reading"
              aria-hidden="true"
              data-long={reading.displayValue.length > 5 ? "true" : undefined}
            >
              <span className="og-ride-metrics__value" data-testid={`ride-metric-value-${slot.index}`}>
                {reading.displayValue}
              </span>
              {reading.unit === null ? null : (
                <span className="og-ride-metrics__unit">{reading.unit}</span>
              )}
            </span>
            <span className="og-ride-metrics__caption" aria-hidden="true">{slot.caption}</span>
          </button>
        );
      })}
    </div>
  );
}
