"use client";

/**
 * A point's actions as a bottom sheet (04-PLANNER-AND-WORKSPACE-UX §15, §31).
 *
 * This is the list's twin of the map's long-press menu: the same operations a
 * rider can reach by holding the map, offered on the row itself, so the list
 * alone is a complete way to build and edit a ride. Every action is a 48 px
 * button, the sheet traps focus and closes on Escape or a press outside, and
 * Remove is the one row painted in the danger colour.
 */

import { useEffect, useId, useRef } from "react";

import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

export interface PointSheetAction {
  /** The test hook the list's tests and the browser gate press. */
  readonly testId: string;
  readonly label: string;
  /** The 24 px stroke path for the action's glyph. */
  readonly path: string;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  /** True when an armed placement will satisfy this action on the next tap. */
  readonly armed?: boolean;
  readonly onSelect: () => void;
}

export interface PointActionSheetProps {
  /** The row's role, e.g. `Stop 2` — the sheet's eyebrow. */
  readonly title: string;
  /** The point's own name, e.g. the rider's label for it. */
  readonly subtitle: string;
  readonly actions: readonly PointSheetAction[];
  readonly onClose: () => void;
}

export function PointActionSheet({
  title,
  subtitle,
  actions,
  onClose,
}: PointActionSheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(ref, onClose);

  // A press anywhere outside the sheet dismisses it, like the map's own menu.
  useEffect(() => {
    const outside = (event: PointerEvent): void => {
      if (ref.current?.contains(event.target as Node) === true) return;
      onClose();
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [onClose]);

  return (
    <div className="og-stop-sheet" data-testid="point-menu-layer">
      <div className="og-stop-sheet__scrim" aria-hidden="true" />
      <div
        ref={ref}
        className="og-stop-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="point-menu"
        tabIndex={-1}
      >
        <header className="og-stop-sheet__head">
          <p className="og-stop-sheet__eyebrow">{title}</p>
          <h3 className="og-stop-sheet__title" id={titleId}>
            {subtitle}
          </h3>
        </header>
        <div className="og-stop-sheet__actions">
          {actions.map((action) => (
            <button
              key={action.testId}
              type="button"
              className="og-stop-sheet__action"
              data-testid={action.testId}
              data-danger={action.danger === true ? "true" : "false"}
              data-armed={action.armed === true ? "true" : "false"}
              disabled={action.disabled === true}
              onClick={(): void => {
                action.onSelect();
                onClose();
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={action.path} />
              </svg>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
