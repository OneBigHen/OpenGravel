"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import type { ExportMode } from "@/application/export/gpx-export";

import "./export-menu.css";

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
}

const NO_LINE_REASON = "This ride has no saved route line yet.";

/**
 * The most portable file first: a track keeps the whole line for Garmin,
 * Calimoto, Kurviger and REVER. A recording is its own track, and an imported
 * source track keeps the timestamps and elevation that came with it.
 */
const PRIMARY_ORDER: readonly ExportMode[] = [
  "recorded-ride",
  "planned-track",
  "track",
  "original",
];

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

/** The one file a rider gets without opening "Other formats". */
export function primaryExportMode(capabilities: ExportCapabilities): ExportMode | null {
  const modes = exportModes(capabilities);
  for (const id of PRIMARY_ORDER) {
    if (modes.some((mode) => mode.id === id && mode.enabled)) return id;
  }
  return null;
}

/** "Download GPX" is only untrue when the unchanged import is all there is. */
export function exportPrimaryLabel(capabilities: ExportCapabilities): string {
  return primaryExportMode(capabilities) === "original" ? "Download original file" : "Download GPX";
}

/** Available alternatives, quiet and never a copy of the primary action. */
export function otherExportModes(capabilities: ExportCapabilities): readonly ExportMenuEntry[] {
  const primary = primaryExportMode(capabilities);
  return exportModes(capabilities).filter((mode) => mode.enabled && mode.id !== primary);
}

function primaryTitle(capabilities: ExportCapabilities): string {
  switch (primaryExportMode(capabilities)) {
    case "recorded-ride":
      return "Your recorded ride as a GPX track.";
    case "track":
      return "The GPX track as it was imported.";
    case "original":
      return "The file exactly as it was imported.";
    case "planned-track":
    case "planned-route":
      return "The whole line as a GPX track. Works with Garmin, Calimoto, Kurviger and REVER.";
    default:
      return "This ride has nothing to download yet.";
  }
}

/**
 * One download, then a small disclosure for the other formats. The disclosure
 * declares menu semantics, so Escape closes it, a pointer outside closes it,
 * and the arrow keys move between the entries.
 */
export function ExportMenu({ title, capabilities, onExport, onShare }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A ref, not the disabled attribute, is what stops a second click: disabling
  // the focused entry would blur it out of an open menu in a real browser.
  const busyRef = useRef<ExportMode | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const primary = primaryExportMode(capabilities);
  const others = otherExportModes(capabilities);
  const entries: readonly MenuEntry[] = [
    ...others,
    ...(onShare === undefined
      ? []
      : [{ id: "share" as const, label: "Share this ride", enabled: true }]),
  ];

  function enabledItems(): HTMLButtonElement[] {
    const popover = popoverRef.current;
    if (popover === null) return [];
    return Array.from(popover.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'));
  }

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) moreRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    enabledItems()[0]?.focus();
    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target) === true) return;
      if (moreRef.current?.contains(target) === true) return;
      if (primaryRef.current?.contains(target) === true) return;
      const focusWasInside = popoverRef.current?.contains(document.activeElement) === true;
      setOpen(false);
      if (focusWasInside) moreRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  async function exportMode(mode: ExportMode): Promise<void> {
    if (busyRef.current !== null) return;
    busyRef.current = mode;
    setBusy(mode);
    setError(null);
    try {
      await onExport(mode);
      if (open) close(true);
    } catch {
      setError("Could not create this file. The ride is unchanged.");
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
      if (event.key === "ArrowDown" && entries.length > 0) {
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
      if (moreRef.current === next) return;
      if (primaryRef.current === next) return;
    }
    setOpen(false);
  }

  return (
    <div className="og-export-menu" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={primaryRef}
        type="button"
        className="og-secondary og-export-menu__primary"
        disabled={primary === null || busy !== null}
        title={primaryTitle(capabilities)}
        onClick={() => {
          if (primary !== null) void exportMode(primary);
        }}
      >
        {busy === primary && primary !== null ? "Preparing…" : exportPrimaryLabel(capabilities)}
      </button>
      {entries.length === 0 ? null : (
        <button
          ref={moreRef}
          type="button"
          className="og-export-menu__more"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          Other formats
        </button>
      )}
      {open ? (
        <div
          ref={popoverRef}
          id={menuId}
          className="og-export-menu__popover"
          role="menu"
          aria-label={`Other formats for ${title}`}
          aria-busy={busy !== null}
        >
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className="og-export-menu__item"
              disabled={!entry.enabled}
              onClick={() => runEntry(entry)}
            >
              {busy === entry.id ? "Preparing…" : entry.label}
            </button>
          ))}
        </div>
      ) : null}
      {error !== null ? <p className="og-export-menu__error" role="alert">{error}</p> : null}
    </div>
  );
}
