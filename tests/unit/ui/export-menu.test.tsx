import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExportMenu, primaryExportMode } from "@/ui/rides/ExportMenu";

afterEach(() => cleanup());

const ALL = { plannedRoute: true, track: true, original: true, recordedRide: true } as const;
const NONE = { plannedRoute: false, track: false, original: false, recordedRide: false } as const;

function download(): HTMLElement {
  return screen.getByRole("button", { name: "Download GPX" });
}

function otherFormats(): HTMLElement {
  return screen.getByRole("button", { name: "Other formats" });
}

describe("ExportMenu", () => {
  it("offers one Download GPX up front and exports the best-compatibility variant", async () => {
    const onExport = vi.fn();
    render(<ExportMenu title="Pine Loop" capabilities={{ ...NONE, plannedRoute: true }} onExport={onExport} />);

    expect(primaryExportMode({ ...NONE, plannedRoute: true })).toBe("planned-track");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();

    fireEvent.click(download());

    expect(onExport).toHaveBeenCalledWith("planned-track");
  });

  it("downloads a recorded ride as the recording, not a planned line", () => {
    const onExport = vi.fn();
    render(<ExportMenu title="Recorded ride" capabilities={ALL} onExport={onExport} />);

    expect(primaryExportMode(ALL)).toBe("recorded-ride");
    fireEvent.click(download());

    expect(onExport).toHaveBeenCalledWith("recorded-ride");
  });

  it("keeps the other formats behind a small disclosure and exports one of them", async () => {
    const onExport = vi.fn();
    render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={onExport} />);

    fireEvent.click(otherFormats());

    expect(screen.getByRole("menuitem", { name: /^gpx track$/i })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /gpx route/i })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /source track gpx/i })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /original file/i })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: /recorded ride gpx/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /gpx route/i }));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith("planned-route"));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("offers no other formats when the best file is the only one", () => {
    render(<ExportMenu title="Recorded ride" capabilities={{ ...NONE, recordedRide: true }} onExport={vi.fn()} />);

    expect(download()).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Other formats" })).not.toBeInTheDocument();
  });

  it("never lists a format the ride cannot produce", () => {
    render(<ExportMenu title="Pine Loop" capabilities={{ ...NONE, plannedRoute: true }} onExport={vi.fn()} />);
    fireEvent.click(otherFormats());

    expect(screen.getByRole("menuitem", { name: /gpx route/i })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: /source track gpx/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /original file/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /recorded ride gpx/i })).not.toBeInTheDocument();
  });

  it("names an unchanged import honestly instead of calling it a GPX download", () => {
    render(<ExportMenu title="Imported file" capabilities={{ ...NONE, original: true }} onExport={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Download original file" })).toBeEnabled();
  });

  it("declares menu semantics only on the Other formats disclosure", () => {
    render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={vi.fn()} />);
    expect(otherFormats()).toHaveAttribute("aria-haspopup", "menu");
    expect(otherFormats()).not.toHaveAttribute("aria-controls");
    expect(download()).not.toHaveAttribute("aria-haspopup");
    fireEvent.click(otherFormats());
    const controls = otherFormats().getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toHaveAttribute("role", "menu");
  });

  it("closes on Escape and returns focus to the Other formats button", async () => {
    render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={vi.fn()} />);
    fireEvent.click(otherFormats());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^gpx track$/i })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(otherFormats()).toHaveFocus();
  });

  it("closes when a pointer goes down outside the disclosure", async () => {
    render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={vi.fn()} />);
    fireEvent.click(otherFormats());
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("moves focus with the arrow keys and Home/End through the available formats", () => {
    render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={vi.fn()} />);
    fireEvent.click(otherFormats());
    const menu = screen.getByRole("menu");
    const track = screen.getByRole("menuitem", { name: /^gpx track$/i });
    const route = screen.getByRole("menuitem", { name: /gpx route/i });
    const source = screen.getByRole("menuitem", { name: /source track gpx/i });
    const original = screen.getByRole("menuitem", { name: /original file/i });
    expect(track).toHaveFocus();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(route).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(original).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(track).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(original).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(track).toHaveFocus();
    expect(source).toBeEnabled();
  });

  it("offers share only inside the disclosure when sharing is wired up", () => {
    const first = render(<ExportMenu title="Pine Loop" capabilities={{ ...NONE, plannedRoute: true }} onExport={vi.fn()} />);
    fireEvent.click(otherFormats());
    expect(screen.queryByRole("menuitem", { name: /share/i })).not.toBeInTheDocument();
    first.unmount();

    const onShare = vi.fn();
    render(<ExportMenu title="Pine Loop" capabilities={{ ...NONE, plannedRoute: true }} onExport={vi.fn()} onShare={onShare} />);
    fireEvent.click(otherFormats());
    fireEvent.click(screen.getByRole("menuitem", { name: /share this ride/i }));
    expect(onShare).toHaveBeenCalledOnce();
  });

  it("keeps a running export focused instead of disabling it", async () => {
    let finish: (() => void) | undefined;
    const onExport = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    render(<ExportMenu title="Pine Loop" capabilities={{ ...NONE, plannedRoute: true }} onExport={onExport} />);
    fireEvent.click(otherFormats());
    const route = screen.getByRole("menuitem", { name: /gpx route/i });
    fireEvent.click(route);

    expect(route).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /preparing/i })).toBe(route);
    expect(screen.getByRole("menu")).toHaveAttribute("aria-busy", "true");
    finish?.();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("reports a failed primary download without pretending it worked", async () => {
    const onExport = vi.fn(async () => {
      throw new Error("nope");
    });
    render(<ExportMenu title="Pine Loop" capabilities={ALL} onExport={onExport} />);
    fireEvent.click(download());

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not create this file/i);
  });

  it("reports a failed other-format download without leaving the menu stuck", async () => {
    const onExport = vi.fn(async () => {
      throw new Error("nope");
    });
    render(<ExportMenu title="Pine Loop" capabilities={{ ...NONE, plannedRoute: true }} onExport={onExport} />);
    fireEvent.click(otherFormats());
    fireEvent.click(screen.getByRole("menuitem", { name: /gpx route/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not create this file/i);
    expect(otherFormats()).toHaveAttribute("aria-expanded", "true");
  });
});
