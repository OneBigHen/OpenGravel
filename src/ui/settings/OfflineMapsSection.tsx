"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  formatBytes,
  offlineRegionRows,
  type InstalledOfflineRegion,
  type OfflineDownloadProgress,
  type OfflineRegionOffer,
  type OfflineRegionsPort,
} from "@/application/offline/offline-regions";

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

export function OfflineMapsSection({ regions }: { readonly regions: OfflineRegionsPort }) {
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
    <section className="og-settings__section og-settings__section--offline" aria-labelledby="settings-offline-title" data-testid="offline-maps">
      <div className="og-settings__section-heading">
        <div>
          <p className="og-settings__eyebrow">NO SIGNAL</p>
          <h2 id="settings-offline-title">Offline areas</h2>
        </div>
        <span className="og-settings__status">{storageLabel}</span>
      </div>
      <p className="og-settings__section-copy">
        Download an area and OpenGravel can still draw its map and plan a ride inside it when you lose signal.
      </p>
      {offers === null && !offersFailed && rows.length === 0 ? <p className="og-settings__section-copy">Checking which areas are available…</p> : null}
      {offersFailed ? <p className="og-settings__section-copy">The list of areas needs signal.{device.status === "ready" ? " Areas already on this device still work." : ""}</p> : null}
      {device.status === "failed" ? (
        <>
          <p className="og-settings__section-copy" role="alert">
            Device storage could not be checked. Saved areas cannot be verified right now. Retry before downloading or removing an area.
          </p>
          <button className="og-settings__button og-settings__button--quiet" type="button" aria-label="Retry device storage" onClick={() => { setDevice({ status: "checking" }); void refreshLocal(); }}>
            Retry
          </button>
        </>
      ) : null}
      <ul className="og-offline-areas__list">
        {rows.map((row) => {
          const downloading = active?.regionId === row.regionId;
          const percent =
            downloading && active.progress !== null && active.progress.totalBytes > 0
              ? Math.floor((active.progress.completedBytes / active.progress.totalBytes) * 100)
              : 0;
          const label = STATE_LABEL[row.state];
          return (
            <li className="og-offline-areas__row" key={row.regionId} data-testid={`offline-region-${row.regionId}`}>
              <div className="og-offline-areas__main">
                <div>
                  <h3>{row.name}</h3>
                  <p>
                    {row.sizeLabel} · {row.dataLabel}
                  </p>
                </div>
                {label !== null ? <span className="og-settings__active">{label}</span> : null}
              </div>
              {downloading ? (
                <div className="og-offline-areas__progress">
                  <progress max={100} value={percent} aria-label={`${row.name} download progress`} />
                  <span role="status">{percent}%</span>
                  <button className="og-settings__text-button" type="button" onClick={() => active.controller.abort()}>
                    Pause
                  </button>
                </div>
              ) : (
                <div className="og-offline-areas__actions">
                  {row.state === "available" || row.state === "update" ? (
                    <button
                      className="og-settings__button og-settings__button--quiet"
                      type="button"
                      disabled={mutationsDisabled}
                      onClick={() => void download(row.regionId, row.name)}
                    >
                      {row.state === "update" ? "Update" : "Download"}
                    </button>
                  ) : null}
                  {row.state !== "available" ? (
                    <button
                      className="og-settings__text-button og-settings__text-button--danger"
                      type="button"
                      disabled={mutationsDisabled}
                      onClick={() => void remove(row.regionId, row.name)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {message !== null ? (
        <p className="og-settings__section-copy" role="status" data-testid="offline-maps-message">
          {message}
        </p>
      ) : null}
      <p className="og-settings__section-copy">Map and road data © OpenStreetMap contributors, ODbL 1.0; map tiles by Protomaps.</p>
    </section>
  );
}
