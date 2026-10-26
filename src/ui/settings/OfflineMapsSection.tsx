"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type RefObject,
} from "react";

import {
  downloadFailureMessage,
  downloadPercent,
  downloadProgressLabel,
  formatBytes,
  offlineRegionRows,
  type InstalledOfflineRegion,
  type OfflineDownloadProgress,
  type OfflineRegionOffer,
  type OfflineRegionRow,
  type OfflineRegionsPort,
} from "@/application/offline/offline-regions";
import { Chevron, SettingsGroup } from "./SettingsGroup";
import "./offline-maps.css";

interface ActiveDownload {
  readonly regionId: string;
  readonly name: string;
  /** The size announced before the download started, so the bar has a total at 0 %. */
  readonly expectedBytes: number;
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

function subscribeToController(onChange: () => void): () => void {
  const worker = navigator.serviceWorker;
  worker?.addEventListener("controllerchange", onChange);
  return () => worker?.removeEventListener("controllerchange", onChange);
}

function hasController(): boolean {
  return navigator.serviceWorker?.controller != null;
}

const menuTriggerId = (regionId: string): string => `offline-more-${regionId}`;
const menuIdFor = (regionId: string): string => `offline-options-${regionId}`;

/** The overflow on a saved area: Update (only when a newer copy exists) and Delete. */
function OverflowTrigger({
  row,
  open,
  onClick,
}: {
  readonly row: OfflineRegionRow;
  readonly open: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      id={menuTriggerId(row.regionId)}
      type="button"
      className="og-offline__more"
      aria-label={`More options for ${row.name}`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuIdFor(row.regionId) : undefined}
      onClick={onClick}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <circle cx="12" cy="5" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="12" cy="19" r="2" />
      </svg>
    </button>
  );
}

/** The two rows a saved area's overflow holds, in the card rather than over it. */
function AreaOptions({
  row,
  disabled,
  menuRef,
  onUpdate,
  onDelete,
  onKeyDown,
}: {
  readonly row: OfflineRegionRow;
  readonly disabled: boolean;
  readonly menuRef: RefObject<HTMLDivElement | null>;
  readonly onUpdate: () => void;
  readonly onDelete: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="og-offline__menu"
      id={menuIdFor(row.regionId)}
      ref={menuRef}
      role="menu"
      aria-label={`${row.name} options`}
      onKeyDown={onKeyDown}
    >
      {row.state === "update" ? (
        <button className="og-offline__menu-item" type="button" role="menuitem" disabled={disabled} onClick={onUpdate}>
          Update ({formatBytes(row.downloadBytes)})
        </button>
      ) : null}
      <button
        className="og-offline__menu-item og-offline__menu-item--danger"
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}

export function OfflineMapsSection({ regions }: { readonly regions: OfflineRegionsPort }) {
  const canReopenOffline = useSyncExternalStore(subscribeToController, hasController, () => false);
  const [offers, setOffers] = useState<OfflineRegionOffer[] | null>(null);
  const [offersFailed, setOffersFailed] = useState(false);
  const [device, setDevice] = useState<DeviceState>({ status: "checking" });
  const [active, setActive] = useState<ActiveDownload | null>(null);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const activeRef = useRef<ActiveDownload | null>(null);
  const localRead = useRef({ live: false, revision: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const pickerId = useId();

  // One overflow at a time: opening it puts focus on its first row, and a tap
  // anywhere else closes it. Escape returns to the trigger that opened it.
  useEffect(() => {
    if (openMenu === null) return;
    const region = openMenu;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) === true) return;
      if (document.getElementById(menuTriggerId(region))?.contains(target) === true) return;
      setOpenMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openMenu]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>, regionId: string): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpenMenu(null);
      document.getElementById(menuTriggerId(regionId))?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(current + step + items.length) % items.length]?.focus();
    event.preventDefault();
  }

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

  async function download(row: OfflineRegionRow): Promise<void> {
    // The lock is the ref, not the rendered state: two taps in the same frame
    // both read `active === null` from the previous render, and would start two
    // downloads of the same tiles whose counters and completion fight.
    if (activeRef.current !== null) return;
    const controller = new AbortController();
    const started: ActiveDownload = {
      regionId: row.regionId,
      name: row.name,
      expectedBytes: row.downloadBytes > 0 ? row.downloadBytes : row.sizeBytes,
      progress: null,
      controller,
    };
    activeRef.current = started;
    setActive(started);
    setMessage(null);
    setPickerOpen(false);
    setConfirming(null);
    setOpenMenu(null);
    try {
      await regions.download(row.regionId, (progress) => setActive({ ...started, progress }), controller.signal);
      setMessage(`${row.name} is saved. Map and riding work there without signal.`);
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? `${row.name} is paused. Download it again to carry on from where it stopped.`
          : downloadFailureMessage(row.name, error),
      );
      // A new download that stopped short reopens the list it came from, so
      // trying again is the same one tap it took the first time.
      if (!row.onDevice) setPickerOpen(true);
    } finally {
      activeRef.current = null;
      setActive(null);
      setDevice({ status: "checking" });
      await refreshLocal();
    }
  }

  async function remove(row: OfflineRegionRow): Promise<void> {
    // Removing under a live download leaves a half-written area behind.
    if (activeRef.current !== null || removing) return;
    setRemoving(true);
    setMessage(null);
    try {
      await regions.remove(row.regionId);
      setMessage(`${row.name} was deleted from this device.`);
    } catch {
      setMessage(`${row.name} could not be deleted. Check your device storage and try again.`);
    } finally {
      setConfirming(null);
      setDevice({ status: "checking" });
      await refreshLocal();
      setRemoving(false);
    }
  }

  const rows = offlineRegionRows(offers, device.status === "ready" ? device.installed : []);
  // A device whose storage cannot be read is not invited to write to it: the
  // list of what is offered would read as "not downloaded" for areas that may
  // well be on the device, so nothing here offers a download until it is known.
  const deviceKnown = device.status === "ready";
  const saved = deviceKnown ? rows.filter((row) => row.onDevice) : [];
  const offered = deviceKnown ? rows.filter((row) => !row.onDevice) : [];
  const mutationsDisabled = active !== null || removing || !deviceKnown;
  const storageLabel = device.status === "checking"
    ? "Checking device…"
    : device.status === "failed"
      ? "Device unavailable"
      : device.storedBytes > 0 ? `${formatBytes(device.storedBytes)} used` : "None yet";
  const percent = active === null ? 0 : downloadPercent(active.progress ?? { completedBytes: 0, totalBytes: 0 }, active.expectedBytes);
  const progressLabel = active === null
    ? ""
    : downloadProgressLabel(active.progress ?? { completedBytes: 0, totalBytes: 0 }, active.expectedBytes);

  return (
    <SettingsGroup
      id="settings-offline-title"
      label="Offline areas"
      aside={storageLabel}
      testId="offline-maps"
      hint="Map and riding work without signal in the areas you save here."
    >
      {device.status === "failed" ? (
        <div className="og-settings__card-block og-settings__stack">
          <p className="og-settings__note" role="alert">
            This device&apos;s storage could not be checked. Areas already saved still work; this list cannot show them
            right now.
          </p>
          <button
            className="og-settings__button og-settings__button--quiet"
            type="button"
            aria-label="Retry device storage"
            onClick={() => { setDevice({ status: "checking" }); void refreshLocal(); }}
          >
            Retry
          </button>
        </div>
      ) : null}
      {saved.map((row) => (
        <div className="og-offline__area" key={row.regionId} data-testid={`offline-region-${row.regionId}`}>
          <div className="og-offline__area-head">
            <span className="og-offline__area-text">
              <span className="og-offline__area-name">{row.name}</span>
              <span className="og-offline__area-meta">
                {row.updatedLabel === null ? row.sizeLabel : `${row.sizeLabel} · ${row.updatedLabel}`}
              </span>
            </span>
            <OverflowTrigger
              row={row}
              open={openMenu === row.regionId}
              onClick={() => {
                setConfirming(null);
                setOpenMenu((value) => (value === row.regionId ? null : row.regionId));
              }}
            />
          </div>
          {openMenu === row.regionId ? (
            <AreaOptions
              row={row}
              disabled={mutationsDisabled}
              menuRef={menuRef}
              onUpdate={() => {
                setOpenMenu(null);
                void download(row);
              }}
              onDelete={() => {
                setOpenMenu(null);
                setMessage(null);
                setConfirming(row.regionId);
              }}
              onKeyDown={(event) => onMenuKeyDown(event, row.regionId)}
            />
          ) : null}
          {confirming === row.regionId ? (
            <div className="og-offline__confirm" role="group" aria-label={`Delete ${row.name}`}>
              <p className="og-offline__note">
                Delete {row.name}? Its map and roads stop working without signal.
              </p>
              <div className="og-offline__confirm-actions">
                <button
                  className="og-settings__button og-settings__button--danger"
                  type="button"
                  disabled={removing}
                  onClick={() => void remove(row)}
                >
                  {removing ? "Deleting…" : "Delete"}
                </button>
                <button
                  className="og-settings__button og-settings__button--quiet"
                  type="button"
                  onClick={() => setConfirming(null)}
                >
                  Keep
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
      {active !== null ? (
        <div className="og-offline__area" data-testid={`offline-download-${active.regionId}`}>
          <div className="og-offline__area-head">
            <span className="og-offline__area-text">
              <span className="og-offline__area-name">{active.name}</span>
              <span className="og-offline__area-meta">{progressLabel} · {percent}%</span>
            </span>
            <button className="og-offline__action" type="button" onClick={() => active.controller.abort()}>
              Pause
            </button>
          </div>
          <progress
            className="og-offline__bar"
            max={100}
            value={percent}
            aria-label={`${active.name} download progress`}
          />
        </div>
      ) : null}
      {deviceKnown && active === null && offered.length > 0 ? (
        <>
          <button
            className="og-settings__row og-settings__row--button"
            type="button"
            aria-expanded={pickerOpen}
            aria-controls={pickerId}
            onClick={() => setPickerOpen((value) => !value)}
            data-testid="offline-download-open"
          >
            <span className="og-settings__row-text">
              <span className="og-settings__row-label">Download a region</span>
            </span>
            <Chevron />
          </button>
          {pickerOpen ? (
            <div className="og-offline__offers" id={pickerId} role="group" aria-label="Areas you can download">
              {offered.map((row) => (
                <button
                  className="og-offline__offer"
                  key={row.regionId}
                  type="button"
                  disabled={mutationsDisabled}
                  data-testid={`offline-region-offer-${row.regionId}`}
                  onClick={() => void download(row)}
                >
                  <span className="og-offline__offer-name">{row.name}</span>
                  <span className="og-offline__offer-size">{row.sizeLabel}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {deviceKnown && active === null && offered.length === 0 && saved.length === 0 && offers !== null && !offersFailed ? (
        <p className="og-offline__note">There are no areas to download right now.</p>
      ) : null}
      {offers === null && !offersFailed && deviceKnown && saved.length === 0 ? (
        <p className="og-offline__note">Checking which areas you can download…</p>
      ) : null}
      {offersFailed ? (
        <p className="og-offline__note">
          The list of areas needs signal.{saved.length > 0 ? " Areas already saved still work." : ""}
        </p>
      ) : null}
      {message !== null ? (
        <p className="og-offline__note" role="status" data-testid="offline-maps-message">{message}</p>
      ) : null}
      <p className="og-offline__note" data-testid="offline-shell-disclosure">
        {canReopenOffline
          ? "This device can reopen OpenGravel without signal."
          : "Keep OpenGravel open when you lose signal. Reopening the app still needs signal until it has been saved on this device."}
      </p>
      <p className="og-offline__note">Map and road data © OpenStreetMap contributors, ODbL 1.0; map tiles by Protomaps.</p>
    </SettingsGroup>
  );
}
