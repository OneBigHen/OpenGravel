import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExportMenu } from "@/ui/rides/ExportMenu";

afterEach(() => cleanup());

const ALL = { plannedRoute: true, track: true, original: true, recordedRide: true } as const;
const NONE = { plannedRoute: false, track: false, original: false, recordedRide: false } as const;

function trigger(): HTMLElement {
  return screen.getByRole("button", { name: /export/i });
}

describe("ExportMenu", () => {
  it("offers track and route GPX for a planned ride, plus track, original, and recorded exports", async () => {
    const onExport = vi.fn();
    render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={onExport} />);
    fireEvent.click(trigger());

    expect(screen.getByRole("menuitem", { name: /gpx track/i })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /gpx route/i })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /source track gpx/i })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /original file/i })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /recorded ride gpx/i })).toBeEnabled();
    expect(screen.getByText(/250 route points/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /gpx track/i }));
    await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded", "false"));
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: /gpx route/i }));
    await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded", "false"));
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: /original file/i }));

    expect(onExport).toHaveBeenNthCalledWith(1, "planned-track");
    expect(onExport).toHaveBeenNthCalledWith(2, "planned-route");
    expect(onExport).toHaveBeenNthCalledWith(3, "original");
  });

  it("explains why a missing capability cannot be exported", () => {
    render(<ExportMenu title="Recorded ride" capabilities={{ ...NONE, recordedRide: true }} onExport={vi.fn()} />);
    fireEvent.click(trigger());

    expect(screen.getByRole("menuitem", { name: /gpx track/i })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /gpx route/i })).toBeDisabled();
    expect(screen.getAllByText(/no saved route line/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("menuitem", { name: /recorded ride gpx/i })).toBeEnabled();
  });

  it("declares menu semantics with a controlled popover", () => {
    render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={vi.fn()} />);
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).not.toHaveAttribute("aria-controls");
    fireEvent.click(trigger());
    const controls = trigger().getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toHaveAttribute("role", "menu");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={vi.fn()} />);
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /gpx track/i })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger()).toHaveFocus();
  });

  it("closes when a pointer goes down outside the popover", async () => {
    render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={vi.fn()} />);
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("moves focus with the arrow keys and Home/End, skipping disabled items", async () => {
    render(<ExportMenu title="Pine Loop" capabilities={{ ...NONE, plannedRoute: true }} onExport={vi.fn()} />);
    fireEvent.click(trigger());
    const menu = screen.getByRole("menu");
    const track = screen.getByRole("menuitem", { name: /gpx track/i });
    const route = screen.getByRole("menuitem", { name: /gpx route/i });
    expect(track).toHaveFocus();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(route).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(track).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(route).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(track).toHaveFocus();
  });

  it("offers a share entry only when sharing is wired up", () => {
    const first = render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={vi.fn()} />);
    fireEvent.click(trigger());
    expect(screen.queryByRole("menuitem", { name: /share/i })).not.toBeInTheDocument();
    first.unmount();

    const onShare = vi.fn();
    render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={vi.fn()} onShare={onShare} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: /copy share link/i }));
    expect(onShare).toHaveBeenCalledOnce();
  });

  it("keeps the entry focused instead of disabling it while an export runs", async () => {
    let finish: (() => void) | undefined;
    const onExport = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={onExport} />);
    fireEvent.click(trigger());
    const track = screen.getByRole("menuitem", { name: /gpx track/i });
    fireEvent.click(track);

    expect(track).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /preparing/i })).toBe(track);
    expect(screen.getByRole("menu")).toHaveAttribute("aria-busy", "true");
    finish?.();
    await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded", "false"));
  });

  it("reports a failed export without leaving the menu stuck open", async () => {
    const onExport = vi.fn(async () => {
      throw new Error("nope");
    });
    render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={onExport} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: /gpx track/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not create this export/i);
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });
});
