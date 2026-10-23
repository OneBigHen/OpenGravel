import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InstalledOfflineRegion, OfflineRegionOffer, OfflineRegionsPort } from "@/application/offline/offline-regions";
import { OfflineMapsSection } from "@/ui/settings/OfflineMapsSection";

const offer: OfflineRegionOffer = {
  regionId: "test-region", regionName: "Test area", version: "1",
  bounds: { minLon: -76, minLat: 40, maxLon: -75, maxLat: 41 },
  tileCount: 1, tileByteTotal: 2_000_000, sourceDataDate: "2026-09-01",
};
const installed: InstalledOfflineRegion = {
  ...offer, byteSize: 2_000_000, downloadedAt: "2026-10-01",
};

function port(): OfflineRegionsPort {
  return {
    offers: vi.fn(async () => [offer]),
    installed: vi.fn(async () => []),
    storedBytes: vi.fn(async () => 0),
    download: vi.fn(async () => installed),
    remove: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("offline areas app restart disclosure", () => {
  it("warns that reopening needs signal until a worker controls this page", async () => {
    const worker = Object.assign(new EventTarget(), { controller: null as object | null });
    vi.stubGlobal("navigator", { serviceWorker: worker });
    render(<OfflineMapsSection regions={port()} />);

    expect(await screen.findByTestId("offline-shell-disclosure")).toHaveTextContent("Keep OpenGravel open");
    expect(screen.getByTestId("offline-shell-disclosure")).toHaveTextContent("Reopening the app still needs signal");
    act(() => {
      worker.controller = {};
      worker.dispatchEvent(new Event("controllerchange"));
    });
    expect(screen.getByTestId("offline-shell-disclosure")).toHaveTextContent("reopen OpenGravel without signal");
    act(() => {
      worker.controller = null;
      worker.dispatchEvent(new Event("controllerchange"));
    });
    expect(screen.getByTestId("offline-shell-disclosure")).toHaveTextContent("Keep OpenGravel open");
  });

  it("does not promise an offline restart in a browser without service workers", async () => {
    vi.stubGlobal("navigator", {});
    render(<OfflineMapsSection regions={port()} />);
    expect(await screen.findByTestId("offline-shell-disclosure")).toHaveTextContent("Reopening the app still needs signal");
  });
});

describe("offline areas device storage recovery", () => {
  it("shows an unknown device state after a failed read and retries without permitting mutations", async () => {
    const regions = port();
    vi.mocked(regions.installed)
      .mockRejectedValueOnce(new DOMException("Transient device failure", "UnknownError"))
      .mockResolvedValueOnce([installed]);
    vi.mocked(regions.storedBytes).mockResolvedValue(2_000_000);
    render(<OfflineMapsSection regions={regions} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Device storage could not be checked");
    expect(screen.getByText("Device unavailable")).toBeInTheDocument();
    expect(screen.queryByText("None yet")).not.toBeInTheDocument();
    expect(screen.queryByText("On this device")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Retry device storage" }));
    expect(await screen.findByText("On this device")).toBeInTheDocument();
    expect(screen.getByText("2 MB used")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(regions.installed).toHaveBeenCalledTimes(2);
  });

  it("does not claim a verified download when only half of the device read succeeds", async () => {
    const regions = port();
    vi.mocked(regions.installed).mockResolvedValue([installed]);
    vi.mocked(regions.storedBytes).mockRejectedValue(new Error("Size read failed"));
    render(<OfflineMapsSection regions={regions} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Device storage could not be checked");
    expect(screen.queryByText("On this device")).not.toBeInTheDocument();
    expect(screen.queryByText("None yet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
  });

  it("reports a removal failure and keeps the verified area available", async () => {
    const regions = port();
    vi.mocked(regions.installed).mockResolvedValue([installed]);
    vi.mocked(regions.storedBytes).mockResolvedValue(2_000_000);
    vi.mocked(regions.remove).mockRejectedValue(new Error("Device is busy"));
    render(<OfflineMapsSection regions={regions} />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByTestId("offline-maps-message")).toHaveTextContent("Test area could not be removed");
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled());
    expect(screen.getByText("On this device")).toBeInTheDocument();
    expect(screen.queryByText("Test area was removed from this device.")).not.toBeInTheDocument();
  });

  it("handles a device read failure after a successful download", async () => {
    const regions = port();
    vi.mocked(regions.installed).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Device is busy"));
    render(<OfflineMapsSection regions={regions} />);
    const download = await screen.findByRole("button", { name: "Download" });
    await waitFor(() => expect(download).toBeEnabled());
    fireEvent.click(download);

    expect(await screen.findByRole("alert")).toHaveTextContent("Device storage could not be checked");
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry device storage" })).toBeEnabled();
  });
});

describe("offline areas download re-entry", () => {
  it("starts one download when the button is tapped twice before anything reports back", async () => {
    const regions = port();
    let finish: (region: InstalledOfflineRegion) => void = () => undefined;
    vi.mocked(regions.download).mockImplementation(((_regionId, onProgress) =>
      new Promise<InstalledOfflineRegion>((resolve) => {
        finish = resolve;
        onProgress({ completedBytes: 100, totalBytes: 1_000 });
      })) as OfflineRegionsPort["download"]);
    render(<OfflineMapsSection regions={regions} />);
    const download = await screen.findByRole("button", { name: "Download" });
    await waitFor(() => expect(download).toBeEnabled());

    // Two taps before React has re-rendered: both handlers see the same state,
    // so only a synchronous guard can keep the second one out.
    await act(async () => {
      fireEvent.click(download);
      fireEvent.click(download);
    });

    expect(regions.download).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();

    await act(async () => {
      finish(installed);
    });
    expect(await screen.findByTestId("offline-maps-message")).toHaveTextContent("Test area is ready");
  });
});
