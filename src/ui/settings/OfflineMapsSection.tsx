"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  formatBytes,
  offlineRegionRows,
  type InstalledOfflineRegion,
  type OfflineDownloadProgress,
  type OfflineRegionOffer,
  type OfflineRegionsPort,
} from "@/application/offline/offline-regions";
import { SettingsGroup } from "./SettingsGroup";

interface ActiveDownload {
  readonly regionId: string;
  readonly progress: OfflineDownloadProgress | null;
  readonly controller: AbortController;
}

type DeviceState =
  | { readonly status: "checking" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly installed: InstalledOfflineRegion[]; readonly storedBytes: number };

async function readDevice(regions: OfflineRegionsPort): Promise<DeviceState> {
  try {
    const [installed, storedBytes] = await Promise.all([regions.installed(), regions.storedBytes()]);
    return { status: "ready", installed, storedBytes };
  } catch {
    return { status: "failed" };
  }
}

const STATE_LABEL = {
  available: null,
  ready: "On this device",
  update: "Update available",
  "offline-only": "On this device",
} as const;

function subscribeToController(onChange: () => void): () => void {
  const worker = navigator.serviceWorker;
  worker?.addEventListener("controllerchange", onChange);
  return () => worker?.removeEventListener("controllerchange", onChange);
}

function hasController(): boolean {
  return navigator.serviceWorker?.controller != null;
}

export function OfflineMapsSection({ regions }: { readonly regions: OfflineRegionsPort }) {
  const canReopenOffline = useSyncExternalStore(subscribeToController, hasController, () => false);
  const [offers, setOffers] = useState<OfflineRegionOffer[] | null>(null);
  const [offersFailed, setOffersFailed] = useState(false);
  const [device, setDevice] = useState<DeviceState>({ status: "checking" });
  const [active, setActive] = useState<ActiveDownload | null>(null);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const activeRef = useRef<ActiveDownload | null>(null);
  const localRead = useRef({ live: false, revision: 0 });

  const refreshLocal = useCallback(async () => {
    const reads = localRead.current;
    if (!reads.live) return;
    const read = ++reads.revision;
    const result = await readDevice(regions);
    if (reads.live && read === reads.revision) setDevice(result);
  }, [regions]);

  useEffect(() => {
    let live = true;
    const reads = localRead.current;
    reads.live = true;
    void regions
      .offers()
      .then((list) => live && setOffers(list))
      .catch(() => live && setOffersFailed(true));
    const read = ++reads.revision;
    void readDevice(regions).then((result) => {
      if (live && read === reads.revision) setDevice(result);
    });
    return () => {
      live = false;
      reads.live = false;
      ++reads.revision;
      activeRef.current?.controller.abort();
    };
  }, [regions]);

  async function download(regionId: string, name: string): Promise<void> {
    // The lock is the ref, not the rendered state: two taps in the same frame
    // both read `active === null` from the previous render, and would start two
    // downloads of the same tiles whose counters and completion fight.
    if (activeRef.current !== null) return;
    const controller = new AbortController();
    const started: ActiveDownload = { regionId, progress: null, controller };
    activeRef.current = started;
    setActive(started);
    setMessage(null);
    try {
      await regions.download(regionId, (progress) => setActive({ ...started, progress }), controller.signal);
      setMessage(`${name} is ready. Its map and rides inside it work with no signal.`);
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? `${name} is paused. Download again to pick up where it stopped.`
          : error instanceof Error
            ? error.message
            : `${name} could not be downloaded.`,
      );
    } finally {
      activeRef.current = null;
      setActive(null);
      setDevice({ status: "checking" });
      await refreshLocal();
    }
  }

  async function remove(regionId: string, name: string): Promise<void> {
    // Removing under a live download leaves a half-written area behind.
    if (activeRef.current !== null || removing) return;
    setRemoving(true);
    setMessage(null);
    try {
      await regions.remove(regionId);
      setMessage(`${name} was removed from this device.`);
    } catch {
      setMessage(`${name} could not be removed. Check device storage and try again.`);
    } finally {
      setDevice({ status: "checking" });
      await refreshLocal();
      setRemoving(false);
    }
  }

  const rows = offlineRegionRows(offers, device.status === "ready" ? device.installed : []);
  const mutationsDisabled = active !== null || removing || device.status !== "ready";
  const storageLabel = device.status === "checking"
    ? "Checking device…"
    : device.status === "failed"
      ? "Device unavailable"
      : device.storedBytes > 0 ? `${formatBytes(device.storedBytes)} used` : "None yet";

  return (
    <SettingsGroup
      id="settings-offline-title"
      label="Offline areas"
      aside={storageLabel}
      testId="offline-maps"
      hint={<span data-testid="offline-shell-disclosure">{canReopenOffline
        ? "This device can reopen OpenGravel without signal."
        : "Keep OpenGravel open when you lose signal. Reopening the app still needs signal until it has been saved on this device."}</span>}
    >
      {offers === null && !offersFailed && rows.length === 0 ? <p className="og-settings__card-block og-settings__note">Checking which areas are available…</p> : null}
      {offersFailed ? <p className="og-settings__card-block og-settings__note">The list of areas needs signal.{device.status === "ready" ? " Areas already on this device still work." : ""}</p> : null}
      {device.status === "failed" ? (
        <div className="og-settings__card-block og-settings__stack">
          <p className="og-settings__note" role="alert">
            Device storage could not be checked. Saved areas cannot be verified right now. Retry before downloading or removing an area.
          </p>
          <button className="og-settings__button og-settings__button--quiet" type="button" aria-label="Retry device storage" onClick={() => { setDevice({ status: "checking" }); void refreshLocal(); }}>
            Retry
          </button>
        </div>
      ) : null}
      {rows.map((row) => {
        const downloading = active?.regionId === row.regionId;
        const percent =
          downloading && active.progress !== null && active.progress.totalBytes > 0
            ? Math.floor((active.progress.completedBytes / active.progress.totalBytes) * 100)
            : 0;
        const label = STATE_LABEL[row.state];
        return (
          <div className="og-settings__row" key={row.regionId} data-testid={`offline-region-${row.regionId}`}>
            <span className="og-settings__row-text">
              <span className="og-settings__row-label">{row.name}</span>
              <span className="og-settings__row-meta">
                {row.sizeLabel} · {row.dataLabel}
              </span>
              {label !== null ? <span className="og-settings__row-note">{label}</span> : null}
            </span>
            {downloading ? (
              <div className="og-settings__progress">
                <progress max={100} value={percent} aria-label={`${row.name} download progress`} />
                <span className="og-settings__progress-value" role="status">{percent}%</span>
                <button className="og-settings__row-action" type="button" onClick={() => active.controller.abort()}>
                  Pause
                </button>
              </div>
            ) : (
              <div className="og-settings__row-actions">
                {row.state === "available" || row.state === "update" ? (
                  <button
                    className="og-settings__row-action"
                    type="button"
                    disabled={mutationsDisabled}
                    onClick={() => void download(row.regionId, row.name)}
                  >
                    {row.state === "update" ? "Update" : "Download"}
                  </button>
                ) : null}
                {row.state !== "available" ? (
                  <button
                    className="og-settings__row-action og-settings__row-action--danger"
                    type="button"
                    disabled={mutationsDisabled}
                    onClick={() => void remove(row.regionId, row.name)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
      {message !== null ? (
        <p className="og-settings__card-block og-settings__note" role="status" data-testid="offline-maps-message">
          {message}
        </p>
      ) : null}
      <p className="og-settings__card-block og-settings__note">Map and road data © OpenStreetMap contributors, ODbL 1.0; map tiles by Protomaps.</p>
    </SettingsGroup>
  );
}
