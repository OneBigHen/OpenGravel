import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INSTALL_HINT_KEY, shouldShowInstallHint } from "@/ui/ride/install-hint";
import { RideInstallHint } from "@/ui/ride/RideInstallHint";

const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CHROME_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const env = { userAgent: SAFARI, standalone: false, dismissed: false };

describe("install hint rules", () => {
  it("shows in iPhone Safari at ride start", () => {
    expect(shouldShowInstallHint(env, 0)).toBe(true);
  });
  it("never after the first 10 seconds", () => {
    expect(shouldShowInstallHint(env, 10_001)).toBe(false);
  });
  it("never in the installed app", () => {
    expect(shouldShowInstallHint({ ...env, standalone: true }, 0)).toBe(false);
  });
  it("never once dismissed", () => {
    expect(shouldShowInstallHint({ ...env, dismissed: true }, 0)).toBe(false);
  });
  it("not for Chrome on iOS or desktop browsers", () => {
    expect(shouldShowInstallHint({ ...env, userAgent: CHROME_IOS }, 0)).toBe(false);
    expect(shouldShowInstallHint({ ...env, userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130 Safari/537.36" }, 0)).toBe(false);
  });
});

describe("RideInstallHint", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(SAFARI);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("shows, dismisses, and remembers the dismissal", async () => {
    render(<RideInstallHint />);
    expect(await screen.findByTestId("ride-install-hint")).toHaveTextContent("Add OpenGravel to your Home Screen for full-screen rides");
    fireEvent.click(screen.getByTestId("ride-install-hint-dismiss"));
    expect(screen.queryByTestId("ride-install-hint")).toBeNull();
    expect(window.localStorage.getItem(INSTALL_HINT_KEY)).toBe("1");
    cleanup();
    render(<RideInstallHint />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("ride-install-hint")).toBeNull();
  });

  it("goes away on its own after 10 seconds", async () => {
    vi.useFakeTimers();
    render(<RideInstallHint />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("ride-install-hint")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(10_001); });
    expect(screen.queryByTestId("ride-install-hint")).toBeNull();
  });
});
