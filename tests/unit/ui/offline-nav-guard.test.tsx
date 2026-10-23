import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfflineNavGuard } from "@/ui/nav/OfflineNavGuard";

function setOnline(value: boolean): void {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OfflineNavGuard", () => {
  it("keeps the page and says why when an in-app link is tapped offline", () => {
    setOnline(false);
    const reached = vi.fn();
    render(
      <div onClick={reached}>
        <OfflineNavGuard />
        <a href="/rides">My rides</a>
      </div>,
    );
    const link = screen.getByRole("link", { name: "My rides" });
    const allowed = fireEvent.click(link);
    expect(allowed).toBe(false);
    expect(reached).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("You're offline. My rides opens when you're back online.");
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByRole("status", { hidden: true })).not.toBeVisible();
  });

  it("leaves links alone while online", () => {
    setOnline(true);
    const reached = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(
      <div onClick={reached}>
        <OfflineNavGuard />
        <a href="/rides">My rides</a>
      </div>,
    );
    fireEvent.click(screen.getByRole("link", { name: "My rides" }));
    expect(reached).toHaveBeenCalled();
  });

  it("allows a cached shell route offline when a worker controls the page", () => {
    vi.stubGlobal("navigator", { onLine: false, serviceWorker: { controller: {} } });
    const reached = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(<div onClick={reached}><OfflineNavGuard /><a href="/rides">My rides</a><a href="/community">Community</a></div>);
    fireEvent.click(screen.getByRole("link", { name: "My rides" }));
    expect(reached).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("link", { name: "Community" }));
    expect(reached).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Community opens when you're back online");
  });

  it("allows shell links under the runtime deployment prefix passed by the server", () => {
    vi.stubGlobal("navigator", { onLine: false, serviceWorker: { controller: {} } });
    const reached = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(<div onClick={reached}><OfflineNavGuard assetBasePath="/ogv" /><a href="/ogv/rides">My rides</a></div>);
    fireEvent.click(screen.getByRole("link", { name: "My rides" }));
    expect(reached).toHaveBeenCalledOnce();
  });
});
