"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import { MAX_ROUTE_POINTS, type ExportMode } from "@/application/export/gpx-export";

export interface ExportCapabilities {
  readonly plannedRoute: boolean;
  readonly track: boolean;
  readonly original: boolean;
  readonly recordedRide?: boolean;
}

export interface ExportMenuProps {
  readonly title: string;
  readonly capabilities: ExportCapabilities;
  readonly onExport: (mode: ExportMode) => Promise<void> | void;
  /** Opens the existing share-link flow; omitted when this ride cannot be shared. */
  readonly onShare?: (() => void) | undefined;
}

export interface ExportMenuEntry {
  readonly id: ExportMode;
  readonly label: string;
  readonly enabled: boolean;
  readonly reason?: string;
}

interface MenuEntry {
  readonly id: ExportMode | "share";
  readonly label: string;
  readonly enabled: boolean;
  readonly reason?: string;
}

const NO_LINE_REASON = "This ride has no saved route line yet.";

/** The GPX formats this ride can produce, in menu order. */
export function exportModes(capabilities: ExportCapabilities): readonly ExportMenuEntry[] {
  return [
    {
      id: "planned-track",
      label: "GPX track",
      enabled: capabilities.plannedRoute,
      reason: NO_LINE_REASON,
    },
    {
      id: "planned-route",
      label: "GPX route",
      enabled: capabilities.plannedRoute,
      reason: NO_LINE_REASON,
    },
    {
      id: "track",
      label: "Source track GPX",
      enabled: capabilities.track,
      reason: "This ride has no preserved source track.",
    },
    {
      id: "original",
      label: "Original file",
      enabled: capabilities.original,
      reason: "Only imported rides have an unchanged original file.",
    },
    {
      id: "recorded-ride",
      label: "Recorded ride GPX",
      enabled: capabilities.recordedRide === true,
      reason: "This ride has no recorded track.",
    },
  ];
}

/**
 * The export popover. It declares menu semantics, so it also behaves like a
 * menu: Escape closes and returns focus to the trigger, a pointer outside
 * closes it, and the arrow keys move between the entries.
 */
export function ExportMenu({ title, capabilities, onExport, onShare }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A ref, not the disabled attribute, is what stops a second click: disabling
  // the focused entry would blur it out of an open menu in a real browser.
  const busyRef = useRef<ExportMode | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function enabledItems(): HTMLButtonElement[] {
    const popover = popoverRef.current;
    if (popover === null) return [];
    return Array.from(popover.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'));
  }

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    enabledItems()[0]?.focus();
    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target) === true) return;
      if (triggerRef.current?.contains(target) === true) return;
      const focusWasInside = popoverRef.current?.contains(document.activeElement) === true;
      setOpen(false);
      if (focusWasInside) triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const modes: readonly MenuEntry[] = [
    ...exportModes(capabilities),
    ...(onShare === undefined
      ? []
      : [{ id: "share" as const, label: "Copy share link", enabled: true }]),
  ];

  async function exportMode(mode: ExportMode): Promise<void> {
    if (mode === "recorded-ride" && capabilities.recordedRide !== true) return;
    if (busyRef.current !== null) return;
    busyRef.current = mode;
    setBusy(mode);
    setError(null);
    try {
      await onExport(mode);
      close(true);
    } catch {
      setError("Could not create this export. The original ride remains unchanged.");
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  function runEntry(entry: MenuEntry): void {
    if (!entry.enabled || busyRef.current !== null) return;
    if (entry.id === "share") {
      if (onShare === undefined) return;
      close(true);
      onShare();
      return;
    }
    void exportMode(entry.id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    const items = enabledItems();
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  }

  function onBlur(event: FocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget;
    if (next instanceof Node) {
      if (popoverRef.current?.contains(next) === true) return;
      if (triggerRef.current === next) return;
    }
    setOpen(false);
  }

  return (
    <div className="og-export-menu" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="og-secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Export ${title}`}
        onClick={() => setOpen((value) => !value)}
      >
        Export
      </button>
      {open ? (
        <div
          ref={popoverRef}
          id={menuId}
          className="og-export-menu__popover"
          role="menu"
          aria-label={`Export ${title}`}
          aria-busy={busy !== null}
        >
          <p className="og-export-menu__explainer">
            A track keeps the whole line for Garmin, Calimoto, Kurviger and REVER. A route leaves the line to the
            device: start, stops, finish and up to {MAX_ROUTE_POINTS} route points.
          </p>
          <div className="og-export-menu__options">
            {modes.map((item) => (
              <div key={item.id} className="og-export-menu__option">
                <button
                  type="button"
                  role="menuitem"
                  className="og-secondary"
                  disabled={!item.enabled}
                  title={item.enabled ? undefined : item.reason}
                  onClick={() => runEntry(item)}
                >
                  {busy === item.id ? "Preparing…" : item.label}
                </button>
                {!item.enabled ? <span className="og-export-menu__reason">{item.reason}</span> : null}
              </div>
            ))}
          </div>
          {error !== null ? <p className="og-export-menu__error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
