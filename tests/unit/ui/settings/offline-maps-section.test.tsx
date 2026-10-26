import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InstalledOfflineRegion, OfflineRegionOffer, OfflineRegionsPort } from "@/application/offline/offline-regions";
import { OfflineMapsSection } from "@/ui/settings/OfflineMapsSection";

const offer: OfflineRegionOffer = {
  regionId: "test-region", regionName: "Test area", version: "1",
  bounds: { minLon: -76, minLat: 40, maxLon: -75, maxLat: 41 },
  tileCount: 1, tileByteTotal: 2_000_000, sourceDataDate: "2026-09-01",
};
const installed: InstalledOfflineRegion = {
  ...offer, byteSize: 2_000_000, downloadedAt: "2026-10-01T00:00:00Z",
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

/** The list of areas to add is one tap behind the single download row. */
async function openPicker(): Promise<void> {
  fireEvent.click(await screen.findByTestId("offline-download-open"));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("offline areas: what works without signal", () => {
  it("says what works offline and warns that reopening needs signal until a worker controls the page", async () => {
    const worker = Object.assign(new EventTarget(), { controller: null as object | null });
    vi.stubGlobal("navigator", { serviceWorker: worker });
    render(<OfflineMapsSection regions={port()} />);

    expect(screen.getByText("Map and riding work without signal in the areas you save here.")).toBeInTheDocument();
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

describe("offline areas: choosing one", () => {
  it("keeps the areas behind one button and shows each size before it starts", async () => {
    const regions = port();
    render(<OfflineMapsSection regions={regions} />);

    const open = await screen.findByTestId("offline-download-open");
    expect(open).toHaveTextContent("Download a region");
    expect(screen.queryByTestId("offline-region-offer-test-region")).not.toBeInTheDocument();

    await openPicker();
    const choice = await screen.findByTestId("offline-region-offer-test-region");
    expect(choice).toHaveTextContent("Test area");
    expect(choice).toHaveTextContent("2 MB");
    expect(regions.download).not.toHaveBeenCalled();
  });

  it("shows a bar with the size done out of the size announced, and a pause", async () => {
    const regions = port();
    // Nothing saved yet, then the finished download is on the device.
    vi.mocked(regions.installed).mockResolvedValueOnce([]).mockResolvedValue([installed]);
    let finish: (region: InstalledOfflineRegion) => void = () => undefined;
    vi.mocked(regions.download).mockImplementation(((_regionId, onProgress) =>
      new Promise<InstalledOfflineRegion>((resolve) => {
        finish = resolve;
        onProgress({ completedBytes: 1_000_000, totalBytes: 2_000_000 });
      })) as OfflineRegionsPort["download"]);
    render(<OfflineMapsSection regions={regions} />);
    await openPicker();

    await act(async () => {
      fireEvent.click(await screen.findByTestId("offline-region-offer-test-region"));
    });

    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-label", "Test area download progress");
    expect(bar.getAttribute("value")).toBe("50");
    const running = screen.getByTestId("offline-download-test-region");
    expect(running).toHaveTextContent("1 MB of 2 MB · 50%");
    // The list of areas to add is gone while one is coming in.
    expect(screen.queryByTestId("offline-download-open")).not.toBeInTheDocument();
    expect(within(running).getByRole("button", { name: "Pause" })).toBeEnabled();

    await act(async () => {
      finish(installed);
    });
    expect(await screen.findByTestId("offline-maps-message")).toHaveTextContent("Test area is saved");
    // One card per saved area: name, size, when it was last updated.
    const card = await screen.findByTestId("offline-region-test-region");
    expect(card).toHaveTextContent("Test area");
    expect(card).toHaveTextContent("2 MB · Updated Oct 1, 2026");
    // Nothing is left to add: the one area the server offers is saved now.
    expect(screen.queryByTestId("offline-download-open")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("starts one download when the button is tapped twice before anything reports back", async () => {
    const regions = port();
    let finish: (region: InstalledOfflineRegion) => void = () => undefined;
    vi.mocked(regions.download).mockImplementation(((_regionId, onProgress) =>
      new Promise<InstalledOfflineRegion>((resolve) => {
        finish = resolve;
        onProgress({ completedBytes: 100, totalBytes: 1_000 });
      })) as OfflineRegionsPort["download"]);
    render(<OfflineMapsSection regions={regions} />);
    await openPicker();
    const choice = await screen.findByTestId("offline-region-offer-test-region");

    // Two taps before React has re-rendered: both handlers see the same state,
    // so only a synchronous guard can keep the second one out.
    await act(async () => {
      fireEvent.click(choice);
      fireEvent.click(choice);
    });

    expect(regions.download).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();

    await act(async () => {
      finish(installed);
    });
    expect(await screen.findByTestId("offline-maps-message")).toHaveTextContent("Test area is saved");
  });

  it("tells the rider in plain words that an area did not fit", async () => {
    const regions = port();
    vi.mocked(regions.download).mockRejectedValue(new Error("There is not enough storage on this device for this area."));
    render(<OfflineMapsSection regions={regions} />);
    await openPicker();

    await act(async () => {
      fireEvent.click(await screen.findByTestId("offline-region-offer-test-region"));
    });

    expect(await screen.findByTestId("offline-maps-message"))
      .toHaveTextContent("Test area does not fit on this device. Free up space, then try again.");
    // Trying again is still one tap: the list it came from is open.
    expect(screen.getByTestId("offline-region-offer-test-region")).toBeInTheDocument();
  });
});

describe("offline areas: an area already saved", () => {
  it("offers an update inside the overflow when a newer copy exists", async () => {
    const regions = port();
    vi.mocked(regions.installed).mockResolvedValue([{ ...installed, version: "0.9" }]);
    vi.mocked(regions.storedBytes).mockResolvedValue(2_000_000);
    render(<OfflineMapsSection regions={regions} />);

    const card = await screen.findByTestId("offline-region-test-region");
    fireEvent.click(within(card).getByRole("button", { name: "More options for Test area" }));
    const item = await screen.findByRole("menuitem", { name: "Update (2 MB)" });
    await act(async () => {
      fireEvent.click(item);
    });

    expect(regions.download).toHaveBeenCalledWith("test-region", expect.any(Function), expect.any(AbortSignal));
  });

  it("closes the overflow on Escape and returns focus to the button that opened it", async () => {
    const regions = port();
    vi.mocked(regions.installed).mockResolvedValue([installed]);
    vi.mocked(regions.storedBytes).mockResolvedValue(2_000_000);
    render(<OfflineMapsSection regions={regions} />);

    const card = await screen.findByTestId("offline-region-test-region");
    const more = within(card).getByRole("button", { name: "More options for Test area" });
    fireEvent.click(more);
    const menu = await screen.findByRole("menu", { name: "Test area options" });
    // The overflow opens on its first row, so a keyboard never has to hunt for it.
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toHaveFocus();

    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Test area options" })).not.toBeInTheDocument());
    expect(more).toHaveFocus();
    expect(regions.remove).not.toHaveBeenCalled();
  });

  it("asks in the card before deleting, and keeps the area when the rider changes their mind", async () => {
    const regions = port();
    vi.mocked(regions.installed).mockResolvedValue([installed]);
    vi.mocked(regions.storedBytes).mockResolvedValue(2_000_000);
    const browserDialog = vi.fn(() => true);
    vi.stubGlobal("confirm", browserDialog);
    render(<OfflineMapsSection regions={regions} />);

    const card = await screen.findByTestId("offline-region-test-region");
    fireEvent.click(within(card).getByRole("button", { name: "More options for Test area" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    const confirm = await screen.findByRole("group", { name: "Delete Test area" });
    expect(confirm).toHaveTextContent("Delete Test area?");
    expect(regions.remove).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Delete Test area" })).not.toBeInTheDocument());
    expect(regions.remove).not.toHaveBeenCalled();
    // The question is the card's own, never a browser dialog.
    expect(browserDialog).not.toHaveBeenCalled();
    expect(screen.getByTestId("offline-region-test-region")).toBeInTheDocument();
  });

  it("reports a deletion failure and keeps the saved area", async () => {
    const regions = port();
    vi.mocked(regions.installed).mockResolvedValue([installed]);
    vi.mocked(regions.storedBytes).mockResolvedValue(2_000_000);
    vi.mocked(regions.remove).mockRejectedValue(new Error("Device is busy"));
    render(<OfflineMapsSection regions={regions} />);

    const card = await screen.findByTestId("offline-region-test-region");
    fireEvent.click(within(card).getByRole("button", { name: "More options for Test area" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    const confirm = await screen.findByRole("group", { name: "Delete Test area" });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    });

    expect(await screen.findByTestId("offline-maps-message")).toHaveTextContent("Test area could not be deleted");
    await waitFor(() => expect(screen.getByTestId("offline-region-test-region")).toBeInTheDocument());
    expect(screen.queryByText("Test area was deleted from this device.")).not.toBeInTheDocument();
  });
});

describe("offline areas: device storage unknown", () => {
  it("shows an unknown device state after a failed read and retries without permitting a download", async () => {
    const regions = port();
    vi.mocked(regions.installed)
      .mockRejectedValueOnce(new DOMException("Transient device failure", "UnknownError"))
      .mockResolvedValueOnce([installed]);
    vi.mocked(regions.storedBytes).mockResolvedValue(2_000_000);
    render(<OfflineMapsSection regions={regions} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("storage could not be checked");
    expect(screen.getByText("Device unavailable")).toBeInTheDocument();
    expect(screen.queryByText("None yet")).not.toBeInTheDocument();
    // Nothing may be added or removed until the device answers.
    expect(screen.queryByTestId("offline-download-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("offline-region-test-region")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry device storage" }));
    expect(await screen.findByTestId("offline-region-test-region")).toBeInTheDocument();
    expect(screen.getByText("2 MB used")).toBeInTheDocument();
    // The only area the server offers is the one already on the device.
    expect(screen.queryByTestId("offline-download-open")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(regions.installed).toHaveBeenCalledTimes(2);
  });

  it("does not claim a saved area when only half of the device read succeeds", async () => {
    const regions = port();
    vi.mocked(regions.installed).mockResolvedValue([installed]);
    vi.mocked(regions.storedBytes).mockRejectedValue(new Error("Size read failed"));
    render(<OfflineMapsSection regions={regions} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("storage could not be checked");
    expect(screen.queryByTestId("offline-region-test-region")).not.toBeInTheDocument();
    expect(screen.queryByText("None yet")).not.toBeInTheDocument();
    expect(screen.queryByTestId("offline-download-open")).not.toBeInTheDocument();
  });

  it("handles a device read failure after a successful download", async () => {
    const regions = port();
    vi.mocked(regions.installed).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Device is busy"));
    render(<OfflineMapsSection regions={regions} />);
    await openPicker();
    const choice = await screen.findByTestId("offline-region-offer-test-region");
    await waitFor(() => expect(choice).toBeEnabled());
    await act(async () => {
      fireEvent.click(choice);
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("storage could not be checked");
    expect(screen.queryByTestId("offline-download-open")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry device storage" })).toBeEnabled();
  });
});
