"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { ExportMode } from "@/application/export/gpx-export";
import { exportModes, type ExportCapabilities, type ExportMenuEntry } from "./ExportMenu";

export interface RideRowMenuProps {
  readonly title: string;
  readonly capabilities: ExportCapabilities;
  /** False when this ride has no continuous track to publish. */
  readonly canShare: boolean;
  readonly onRename: () => void;
  readonly onExport: (mode: ExportMode) => Promise<void> | void;
  readonly onShare: () => void;
  readonly onDelete: () => void;
}

type RootId = "rename" | "export" | "share" | "delete";

interface RootEntry {
  readonly id: RootId;
  readonly label: string;
  readonly enabled: boolean;
  readonly danger?: boolean;
  readonly reason?: string;
}

function hasExportable(capabilities: ExportCapabilities): boolean {
  return (
    capabilities.plannedRoute ||
    capabilities.track ||
    capabilities.original ||
    capabilities.recordedRide === true
  );
}

/**
 * The one overflow menu on a saved ride: rename it, export its GPX, share it,
 * or delete it. The menu keeps the row quiet, so the row itself stays a single
 * "open this ride" target.
 */
export function RideRowMenu({
  title,
  capabilities,
  canShare,
  onRename,
  onExport,
  onShare,
  onDelete,
}: RideRowMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "export">("root");
  const [busy, setBusy] = useState<ExportMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef<ExportMode | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function enabledItems(): HTMLButtonElement[] {
    if (menuRef.current === null) return [];
    return Array.from(
      menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'),
    );
  }

  useEffect(() => {
    if (!open) return;
    enabledItems()[0]?.focus();
  }, [open, view]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) === true) return;
      if (triggerRef.current?.contains(target) === true) return;
      const focusWasInside = menuRef.current?.contains(document.activeElement) === true;
      setOpen(false);
      if (focusWasInside) triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const rootEntries: readonly RootEntry[] = [
    { id: "rename", label: "Rename", enabled: true },
    {
      id: "export",
      label: "Export GPX",
      enabled: hasExportable(capabilities),
      reason: "This ride has nothing to export yet.",
    },
    {
      id: "share",
      label: "Share",
      enabled: canShare,
      reason: "This ride has no continuous track to share.",
    },
    { id: "delete", label: "Delete", enabled: true, danger: true },
  ];

  const modes: readonly ExportMenuEntry[] = exportModes(capabilities);

  function runRoot(id: RootId): void {
    if (id === "rename") {
      setOpen(false);
      onRename();
      return;
    }
    if (id === "export") {
      setError(null);
      setView("export");
      return;
    }
    if (id === "share") {
      setOpen(false);
      onShare();
      return;
    }
    setOpen(false);
    onDelete();
  }

  async function runExport(mode: ExportMode): Promise<void> {
    if (busyRef.current !== null) return;
    busyRef.current = mode;
    setBusy(mode);
    setError(null);
    try {
      await onExport(mode);
      close(true);
    } catch {
      setError("Could not create this GPX file. The ride is unchanged.");
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
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

  return (
    <div className="og-rides__menu">
      <button
        ref={triggerRef}
        type="button"
        className="og-rides__more"
        aria-label={`More actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setView("root");
          setError(null);
          setOpen(true);
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className="og-rides__menu-popover"
          role="menu"
          aria-label={`Actions for ${title}`}
          aria-busy={busy !== null}
          onKeyDown={onKeyDown}
        >
          {view === "root" ? (
            rootEntries.map((entry) => (
              <div key={entry.id} className="og-rides__menu-entry">
                <button
                  type="button"
                  role="menuitem"
                  className={entry.danger === true ? "og-rides__menu-item og-rides__menu-item--danger" : "og-rides__menu-item"}
                  disabled={!entry.enabled}
                  title={entry.enabled ? undefined : entry.reason}
                  onClick={() => runRoot(entry.id)}
                >
                  {entry.label}
                </button>
                {entry.enabled ? null : <span className="og-rides__menu-reason">{entry.reason}</span>}
              </div>
            ))
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                className="og-rides__menu-back"
                onClick={() => setView("root")}
              >
                Back
              </button>
              <p className="og-rides__menu-heading">Export GPX</p>
              {modes.map((entry) => (
                <div key={entry.id} className="og-rides__menu-entry">
                  <button
                    type="button"
                    role="menuitem"
                    className="og-rides__menu-item"
                    disabled={!entry.enabled}
                    title={entry.enabled ? undefined : entry.reason}
                    onClick={() => void runExport(entry.id)}
                  >
                    {busy === entry.id ? "Preparing…" : entry.label}
                  </button>
                  {entry.enabled ? null : <span className="og-rides__menu-reason">{entry.reason}</span>}
                </div>
              ))}
            </>
          )}
          {error === null ? null : <p className="og-rides__menu-error" role="alert">{error}</p>}
        </div>
      ) : null}
    </div>
  );
}
