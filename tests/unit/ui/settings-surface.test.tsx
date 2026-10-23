import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGarage } from "@/application/garage/garage-model";
import type { InstalledOfflineRegion, OfflineRegionOffer, OfflineRegionsPort } from "@/application/offline/offline-regions";
import { SettingsSurface } from "@/ui/settings/SettingsSurface";

afterEach(() => cleanup());

describe("settings surface", () => {
  it("leaves an obsolete telemetry acknowledgement unchecked", () => {
    render(<SettingsSurface garage={createGarage()} onGarageChange={vi.fn()} telemetryConsent={{ status: "acknowledged", policyVersion: 0, acknowledgedAt: "2026-10-01T00:00:00Z" }} />);
    expect(screen.getByLabelText("I understand and acknowledge this collection")).not.toBeChecked();
  });
  it("keeps location-denial recovery beside the Home action", () => {
    render(<SettingsSurface
      garage={createGarage()}
      onGarageChange={vi.fn()}
      homeFeedback="Location access was denied. Allow it in your browser settings, then try again."
    />);
    const feedback = screen.getByTestId("settings-home-feedback");
    expect(feedback).toHaveTextContent("browser settings");
    expect(feedback.closest("section")).toHaveAttribute("aria-labelledby", "settings-home-title");
  });

  it("adds a bike with rider-facing gravel and fuel fields", () => {
    const onGarageChange = vi.fn();
    render(<SettingsSurface garage={createGarage()} onGarageChange={onGarageChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add bike" }));
    fireEvent.change(screen.getByLabelText("Bike name"), { target: { value: "Trail bike" } });
    fireEvent.change(screen.getByLabelText("Fuel range (miles)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Save bike" }));
    expect(onGarageChange).toHaveBeenCalledWith(expect.objectContaining({
      bikes: expect.arrayContaining([expect.objectContaining({ name: "Trail bike", fuelRangeMiles: 60 })]),
    }));
  });

  it("exposes local data actions and an honest miles-only units setting", () => {
    const onExport = vi.fn();
    const onDelete = vi.fn();
    render(<SettingsSurface garage={createGarage()} onGarageChange={vi.fn()} onExport={onExport} onDeleteAll={onDelete} />);
    expect(screen.getByLabelText("Distance units")).toHaveValue("miles");
    expect(screen.getByLabelText("Distance units")).toBeDisabled();
    expect(screen.getByText(/Rides are stored on this device\. Export to keep a copy\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export all data" }));
    expect(onExport).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Delete all data" }));
    expect(screen.getByLabelText("Type DELETE to confirm")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("lets the rider save current location as Home and clear it", () => {
    const onUseCurrentLocationAsHome = vi.fn();
    const onClearHome = vi.fn();
    render(
      <SettingsSurface
        garage={createGarage()}
        onGarageChange={vi.fn()}
        homeSaved
        onUseCurrentLocationAsHome={onUseCurrentLocationAsHome}
        onClearHome={onClearHome}
      />,
    );

    expect(screen.getByText("Saved on this device")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use my current location as Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onUseCurrentLocationAsHome).toHaveBeenCalledOnce();
    expect(onClearHome).toHaveBeenCalledOnce();
  });

  it("re-arms the danger zone instead of leaving Confirm armed after a wipe", () => {
    const onDeleteAll = vi.fn();
    const base = { garage: createGarage(), onGarageChange: vi.fn(), onDeleteAll };
    const { rerender } = render(<SettingsSurface {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete all data" }));
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(onDeleteAll).toHaveBeenCalledOnce();

    rerender(<SettingsSurface
      {...base}
      localDataEpoch={1}
      deleteResult={{ ok: true, message: "Deleted this device's OpenGravel data: saved places too." }}
    />);

    expect(screen.queryByLabelText("Type DELETE to confirm")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete all data" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Deleted this device's OpenGravel data");
  });

  it("re-reads offline device storage after a wipe", async () => {
    const offer: OfflineRegionOffer = {
      regionId: "test-region", regionName: "Test area", version: "1",
      bounds: { minLon: -76, minLat: 40, maxLon: -75, maxLat: 41 },
      tileCount: 1, tileByteTotal: 2_000_000, sourceDataDate: "2026-09-01",
    };
    const installed: InstalledOfflineRegion = { ...offer, byteSize: 2_000_000, downloadedAt: "2026-10-01" };
    let onDevice: InstalledOfflineRegion[] = [installed];
    let bytes = 2_000_000;
    const regions: OfflineRegionsPort = {
      offers: vi.fn(async () => [offer]),
      installed: vi.fn(async () => onDevice),
      storedBytes: vi.fn(async () => bytes),
      download: vi.fn(async () => installed),
      remove: vi.fn(async () => undefined),
    };
    const base = { garage: createGarage(), onGarageChange: vi.fn(), offlineRegions: regions };
    const { rerender } = render(<SettingsSurface {...base} />);
    expect(await screen.findByText("2 MB used")).toBeInTheDocument();
    expect(await screen.findByText("On this device")).toBeInTheDocument();

    // The wipe deleted the offline databases on the device.
    onDevice = [];
    bytes = 0;
    rerender(<SettingsSurface
      {...base}
      localDataEpoch={1}
      deleteResult={{ ok: true, message: "Deleted this device's OpenGravel data." }}
    />);

    expect(await screen.findByText("None yet")).toBeInTheDocument();
    expect(screen.queryByText("2 MB used")).not.toBeInTheDocument();
    expect(screen.queryByText("On this device")).not.toBeInTheDocument();
    expect(regions.installed).toHaveBeenCalledTimes(2);
    expect(regions.storedBytes).toHaveBeenCalledTimes(2);
  });
});
