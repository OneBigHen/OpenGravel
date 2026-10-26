import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RideRowMenu } from "@/ui/rides/RideRowMenu";

afterEach(() => cleanup());

const ALL = { plannedRoute: true, track: true, original: true, recordedRide: true } as const;
const NONE = { plannedRoute: false, track: false, original: false, recordedRide: false } as const;

function trigger(): HTMLElement {
  return screen.getByRole("button", { name: "More actions for Pine Loop" });
}

function renderMenu(overrides: Partial<React.ComponentProps<typeof RideRowMenu>> = {}) {
  return render(
    <RideRowMenu
      title="Pine Loop"
      capabilities={ALL}
      canShare
      detailsExpanded={false}
      onToggleDetails={vi.fn()}
      onRename={vi.fn()}
      onExport={vi.fn()}
      onShare={vi.fn()}
      onDelete={vi.fn()}
      {...overrides}
    />,
  );
}

describe("RideRowMenu", () => {
  it("keeps one download, details and the row actions in one menu", () => {
    renderMenu();
    fireEvent.click(trigger());

    expect(screen.getByRole("menuitem", { name: "Download GPX" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Other formats" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Details" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Share" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: "GPX track" })).not.toBeInTheDocument();
  });

  it("downloads the best-compatibility file in one tap", async () => {
    const onExport = vi.fn().mockResolvedValue(undefined);
    renderMenu({ onExport, capabilities: { ...NONE, plannedRoute: true } });
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Download GPX" }));

    await waitFor(() => expect(onExport).toHaveBeenCalledWith("planned-track"));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("downloads a recorded ride as the recording in one tap", async () => {
    const onExport = vi.fn().mockResolvedValue(undefined);
    renderMenu({ onExport, capabilities: { ...NONE, recordedRide: true } });
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Download GPX" }));

    await waitFor(() => expect(onExport).toHaveBeenCalledWith("recorded-ride"));
  });

  it("keeps the other formats behind a disclosure and exports the chosen one", async () => {
    const onExport = vi.fn().mockResolvedValue(undefined);
    renderMenu({ onExport });
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Other formats" }));

    expect(screen.getByRole("menuitem", { name: "GPX track" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "GPX route" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Source track GPX" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Original file" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: "Recorded ride GPX" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "GPX route" }));

    await waitFor(() => expect(onExport).toHaveBeenCalledWith("planned-route"));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("explains a ride that has nothing to download or share", () => {
    renderMenu({ capabilities: NONE, canShare: false });
    fireEvent.click(trigger());

    expect(screen.getByRole("menuitem", { name: "Download GPX" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Share" })).toBeDisabled();
    expect(screen.queryByRole("menuitem", { name: "Other formats" })).not.toBeInTheDocument();
    expect(screen.getByText("This ride has nothing to download yet.")).toBeInTheDocument();
    expect(screen.getByText("This ride has no continuous track to share.")).toBeInTheDocument();
  });

  it("offers no Other formats when the best file is the only one", () => {
    renderMenu({ capabilities: { ...NONE, recordedRide: true } });
    fireEvent.click(trigger());

    expect(screen.getByRole("menuitem", { name: "Download GPX" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: "Other formats" })).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the row's menu button", async () => {
    renderMenu();
    fireEvent.click(trigger());
    expect(screen.getByRole("menuitem", { name: "Download GPX" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger()).toHaveFocus();
  });

  it("closes when a pointer goes down outside the menu", async () => {
    renderMenu();
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("hands details, rename, share and delete back to the row", () => {
    const onToggleDetails = vi.fn();
    const onRename = vi.fn();
    const onShare = vi.fn();
    const onDelete = vi.fn();
    renderMenu({ onToggleDetails, onRename, onShare, onDelete });

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Details" }));
    expect(onToggleDetails).toHaveBeenCalledOnce();

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(onRename).toHaveBeenCalledOnce();

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));
    expect(onShare).toHaveBeenCalledOnce();

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("names the details action for the state it will change", () => {
    renderMenu({ detailsExpanded: true });
    fireEvent.click(trigger());
    expect(screen.getByRole("menuitem", { name: "Hide details" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: "Details" })).not.toBeInTheDocument();
  });

  it("reports a failed download without pretending it worked", async () => {
    const onExport = vi.fn(async () => {
      throw new Error("nope");
    });
    renderMenu({ onExport });
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Download GPX" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not create this file/i);
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });
});
