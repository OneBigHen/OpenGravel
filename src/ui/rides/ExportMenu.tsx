"use client";

import { useState } from "react";

import type { ExportMode } from "@/application/export/gpx-export";

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
}

const RECORDED_REASON = "This ride has no recorded track.";

export function ExportMenu({ title, capabilities, onExport }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportMode(mode: ExportMode): Promise<void> {
    if (mode === "recorded-ride" && capabilities.recordedRide !== true) return;
    setBusy(mode);
    setError(null);
    try {
      await onExport(mode);
      setOpen(false);
    } catch {
      setError("Could not create this export. The original ride remains unchanged.");
    } finally {
      setBusy(null);
    }
  }

  const modes: readonly {
    readonly mode: ExportMode;
    readonly label: string;
    readonly enabled: boolean;
    readonly reason?: string;
  }[] = [
    {
      mode: "planned-route",
      label: "Planned route GPX",
      enabled: capabilities.plannedRoute,
      reason: "This ride has no connected planned route geometry yet.",
    },
    {
      mode: "track",
      label: "Track GPX",
      enabled: capabilities.track,
      reason: "This ride has no preserved track geometry.",
    },
    {
      mode: "original",
      label: "Original file",
      enabled: capabilities.original,
      reason: "Only imported rides have an unchanged original file.",
    },
    {
      mode: "recorded-ride",
      label: "Recorded ride GPX",
      enabled: capabilities.recordedRide === true,
      ...(capabilities.recordedRide === true ? {} : { reason: RECORDED_REASON }),
    },
  ];

  return (
    <div className="og-export-menu">
      <button
        type="button"
        className="og-secondary"
        aria-expanded={open}
        aria-label={`Export ${title}`}
        onClick={() => setOpen((value) => !value)}
      >
        Export
      </button>
      {open ? (
        <div className="og-export-menu__popover" role="menu" aria-label={`Export ${title}`}>
          <p className="og-export-menu__explainer">
            Routes carry instructions and named points; tracks carry geometry and preserve gaps. The original file is never changed.
          </p>
          <div className="og-export-menu__options">
            {modes.map((item) => (
              <div key={item.mode} className="og-export-menu__option">
                <button
                  type="button"
                  role="menuitem"
                  className="og-secondary"
                  disabled={!item.enabled || busy !== null}
                  title={item.enabled ? undefined : item.reason}
                  onClick={() => void exportMode(item.mode)}
                >
                  {busy === item.mode ? "Preparing…" : item.label}
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
