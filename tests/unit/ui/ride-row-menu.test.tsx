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
      onRename={vi.fn()}
      onExport={vi.fn()}
      onShare={vi.fn()}
      onDelete={vi.fn()}
      {...overrides}
    />,
  );
}

describe("RideRowMenu", () => {
  it("keeps Rename, Export GPX, Share and Delete in one menu", () => {
    renderMenu();
    fireEvent.click(trigger());

    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Export GPX" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Share" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
  });

  it("explains a ride that has nothing to export or share", () => {
    renderMenu({ capabilities: NONE, canShare: false });
    fireEvent.click(trigger());

    expect(screen.getByRole("menuitem", { name: "Export GPX" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Share" })).toBeDisabled();
    expect(screen.getByText("This ride has nothing to export yet.")).toBeInTheDocument();
    expect(screen.getByText("This ride has no continuous track to share.")).toBeInTheDocument();
  });

  it("opens the GPX formats and exports the chosen one", async () => {
    const onExport = vi.fn().mockResolvedValue(undefined);
    renderMenu({ onExport });
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Export GPX" }));

    expect(screen.getByRole("menuitem", { name: "GPX track" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "GPX route" })).toBeEnabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "GPX route" }));

    await waitFor(() => expect(onExport).toHaveBeenCalledWith("planned-route"));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("closes on Escape and returns focus to the row's menu button", async () => {
    renderMenu();
    fireEvent.click(trigger());
    expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();

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

  it("hands rename, share and delete back to the row", () => {
    const onRename = vi.fn();
    const onShare = vi.fn();
    const onDelete = vi.fn();
    renderMenu({ onRename, onShare, onDelete });

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
});
