"use client";

import type { ReactNode } from "react";

/**
 * Settings is a list of grouped rows (small-screen design system v2 §6), not a
 * stack of bordered cards: a small uppercase group label, then one rounded
 * container whose rows are 56px tall — the label on the left, the value or
 * control on the right, a chevron when the row opens something. A row wraps
 * instead of clipping when a 320px screen cannot hold label and control side
 * by side.
 */
export function SettingsGroup({
  id,
  label,
  hint,
  aside,
  testId,
  children,
}: {
  readonly id: string;
  readonly label: string;
  /** At most one short line, and only where something is genuinely non-obvious. */
  readonly hint?: ReactNode;
  /** A quiet right-aligned count or size next to the group label. */
  readonly aside?: ReactNode;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="og-settings__group" aria-labelledby={id} data-testid={testId}>
      <div className="og-settings__group-head">
        <h2 className="og-settings__group-label" id={id}>{label}</h2>
        {aside === undefined ? null : <span className="og-settings__group-aside">{aside}</span>}
      </div>
      {hint === undefined ? null : <p className="og-settings__group-hint">{hint}</p>}
      <div className="og-settings__card">{children}</div>
    </section>
  );
}

/** This row opens something: the chevron says so, and it turns when it is open. */
export function Chevron() {
  return (
    <svg
      className="og-settings__chevron"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/**
 * A row that is one control: the whole 56px row is the tap target, so a gloved
 * thumb does not have to find a small button inside it.
 */
export function SettingsRowButton({
  label,
  meta,
  value,
  onClick,
  expanded,
  controls,
  disabled = false,
  danger = false,
  chevron = true,
  ariaLabel,
  testId,
}: {
  readonly label: ReactNode;
  readonly meta?: ReactNode;
  readonly value?: ReactNode;
  readonly onClick: () => void;
  readonly expanded?: boolean;
  readonly controls?: string;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly chevron?: boolean;
  readonly ariaLabel?: string;
  readonly testId?: string;
}) {
  return (
    <button
      type="button"
      className={`og-settings__row og-settings__row--button${danger ? " og-settings__row--danger" : ""}`}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      data-testid={testId}
    >
      <span className="og-settings__row-text">
        <span className="og-settings__row-label">{label}</span>
        {meta === undefined ? null : <span className="og-settings__row-meta">{meta}</span>}
      </span>
      {value === undefined ? null : <span className="og-settings__row-value">{value}</span>}
      {chevron ? <Chevron /> : null}
    </button>
  );
}
