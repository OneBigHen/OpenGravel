import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGarage } from "@/application/garage/garage-model";
import { SettingsSurface } from "@/ui/settings/SettingsSurface";

afterEach(() => cleanup());

describe("settings surface", () => {
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
});
