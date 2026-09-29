"use client";

/**
 * The stopped-state metric picker (RIDE-INSTRUMENT-STRIP §2.2, §2.3, §15).
 *
 * A compact labelled dialog over the map, in the sheet's place: presets first,
 * then this mode's live metrics grouped by category. Choosing a metric changes
 * only the slot it was opened from (a metric already in another slot swaps
 * with it) and closes the picker; choosing a preset fills all three. Escape and
 * Done close it without a change. The surface closes it if the rider starts
 * moving, so it can never be open at speed.
 */

import { useEffect, useRef } from "react";

import {
  RIDE_METRIC_REGISTRY,
  metricChoices,
  presetsFor,
  type RideMetricId,
  type RideMetricPresetId,
} from "@/application/ride-metrics/registry";
import type { RideMetricStripModel } from "@/application/ride-metrics/strip";
import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

export interface RideMetricPickerProps {
  readonly model: RideMetricStripModel;
  readonly slotIndex: number;
  readonly onChoose: (id: RideMetricId) => void;
  readonly onPreset: (id: RideMetricPresetId) => void;
  readonly onClose: () => void;
  /** Re-zeroes the lean-angle beta from the freshest sample. Shown only while the slot holds it. */
  readonly onCalibrateLean?: () => void;
}

export function RideMetricPicker({ model, slotIndex, onChoose, onPreset, onClose, onCalibrateLean }: RideMetricPickerProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const current = model.shownIds[slotIndex]!;
  const presets = presetsFor(model.mode, model.sources);
  const groups = metricChoices(model.mode, model.sources);
  const titleId = `og-ride-metric-picker-${slotIndex}`;

  // Shared modal focus (12 §20): Escape closes, Tab stays inside, and focus
  // returns to the slot that opened it. Then land on the current choice.
  useDialogFocus(rootRef, onClose);
  useEffect(() => {
    const selected = rootRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    selected?.focus();
  }, []);

  return (
    <section
      ref={rootRef}
      className="og-ride-metric-picker"
      data-testid="ride-metric-picker"
      role="dialog"
      aria-labelledby={titleId}
      aria-modal="true"
    >
      <header className="og-ride-metric-picker__header">
        <h2 id={titleId} className="og-ride-metric-picker__title">
          Readout {slotIndex + 1}
          <span className="og-ride-metric-picker__now"> · {RIDE_METRIC_REGISTRY[current].label}</span>
        </h2>
        {current !== "motion.lean" || onCalibrateLean === undefined ? null : (
          <button
            type="button"
            className="og-ride__action"
            data-testid="ride-metric-picker-calibrate-lean"
            onClick={onCalibrateLean}
          >
            Calibrate
          </button>
        )}
        <button
          type="button"
          className="og-ride__action"
          data-testid="ride-metric-picker-done"
          onClick={onClose}
        >
          Done
        </button>
      </header>
      {current !== "motion.lean" ? null : (
        <p className="og-ride-metric-picker__detail" data-testid="ride-metric-picker-lean-hint">
          Beta: hold the bike upright and level, then tap Calibrate.
        </p>
      )}

      {presets.length === 0 ? null : (
        <div className="og-ride-metric-picker__group" role="group" aria-label="Presets">
          <p className="og-ride-metric-picker__label" aria-hidden="true">Presets</p>
          <div className="og-ride-metric-picker__options">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="og-ride-metric-picker__option"
                data-testid={`ride-metric-preset-${preset.id}`}
                aria-pressed={model.preset?.id === preset.id}
                onClick={(): void => onPreset(preset.id)}
              >
                <span>{preset.label}</span>
                <span className="og-ride-metric-picker__detail">
                  {preset.slots.map((id) => RIDE_METRIC_REGISTRY[id].shortLabel).join(" · ")}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.category} className="og-ride-metric-picker__group" role="group" aria-label={group.category}>
          <p className="og-ride-metric-picker__label" aria-hidden="true">{group.category}</p>
          <div className="og-ride-metric-picker__options">
            {group.metrics.map((metric) => {
              const elsewhere = model.shownIds.indexOf(metric.id);
              const swaps = elsewhere !== -1 && elsewhere !== slotIndex;
              const beta = metric.availability === "experimental";
              return (
                <button
                  key={metric.id}
                  type="button"
                  className="og-ride-metric-picker__option"
                  data-testid={`ride-metric-option-${metric.id}`}
                  data-beta={beta ? "true" : undefined}
                  aria-pressed={metric.id === current}
                  onClick={(): void => onChoose(metric.id)}
                >
                  <span>{metric.label}</span>
                  {swaps ? (
                    <span className="og-ride-metric-picker__detail">Swaps with readout {elsewhere + 1}</span>
                  ) : beta ? (
                    <span className="og-ride-metric-picker__detail">Beta</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
