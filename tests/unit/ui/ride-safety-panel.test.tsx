/**
 * The ride sheet's live-sharing panel and the crash-check overlay.
 *
 * What a rider (or a bystander) can see and press: the name field and one
 * "Share live location" button before sharing, the live status and "Send link" /
 * "Stop sharing" after, and — when the detector is suspicious — the huge
 * "Are you OK?" screen over everything else. `navigator.share` and
 * `navigator.clipboard` are stubbed, so the tests assert the link genuinely
 * leaves the device through one of them.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RideSafety, RideSafetySnapshot } from "@/application/safety/ride-safety";
import { RideSafetyOverlay, RideSafetyPanel } from "@/ui/ride/RideSafetyPanel";
import { LIVE_RIDER_NAME_STORAGE_KEY } from "@/application/live/storage-keys";

const FOLLOW_URL = "https://opengravel.example/follow/tok_1";

const OFF_LIVE: RideSafetySnapshot["live"] = {
  status: "off",
  followUrl: null,
  alert: null,
  lastSentAt: null,
  pending: 0,
  error: null,
};

const IDLE_CRASH: RideSafetySnapshot["crash"] = {
  phase: "idle",
  suspected: null,
  secondsRemaining: null,
};

function fakeSafety(overrides: Partial<RideSafetySnapshot> = {}) {
  const state: RideSafetySnapshot = { live: OFF_LIVE, crash: IDLE_CRASH, ...overrides };
  const listeners = new Set<(snapshot: RideSafetySnapshot) => void>();
  const startSharing = vi.fn<NonNullable<RideSafety["startSharing"]>>(async () => FOLLOW_URL);
  const stopSharing = vi.fn(async () => undefined);
  const imOkay = vi.fn();
  const alertNow = vi.fn();
  const imOkayNow = vi.fn();
  const safety: RideSafety = {
    snapshot: () => state,
    crashNow: () => state.crash,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    startSharing,
    stopSharing,
    acceptFix: vi.fn(),
    acceptMotion: vi.fn(),
    imOkay,
    alertNow,
    imOkayNow,
    restore: vi.fn(),
    suspend: vi.fn(),
    dispose: vi.fn(),
  };
  return { safety, startSharing, stopSharing, imOkay, alertNow, imOkayNow };
}

function sharingSafety(overrides: Partial<RideSafetySnapshot["live"]> = {}) {
  return fakeSafety({
    live: { ...OFF_LIVE, status: "sharing", followUrl: FOLLOW_URL, lastSentAt: Date.now() - 12_000, ...overrides },
  });
}

/** Stub the phone's share sheet and record what it was handed. */
function stubShare(impl?: () => Promise<void>) {
  const share = vi.fn(impl ?? (async () => undefined));
  Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
  return share;
}

function stubClipboard() {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

beforeEach(() => {
  window.localStorage.clear();
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { clipboard?: unknown }).clipboard;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("RideSafetyPanel — before sharing", () => {
  it("offers a name field and one button to start sharing", () => {
    const { safety } = fakeSafety();
    render(<RideSafetyPanel safety={safety} />);

    expect(screen.getByLabelText("Your name for the link")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share live location" })).toBeEnabled();
    expect(screen.queryByText("Sharing live location")).not.toBeInTheDocument();
  });

  it("prefills the name the rider used last time", () => {
    window.localStorage.setItem(LIVE_RIDER_NAME_STORAGE_KEY, "Sam");
    const { safety } = fakeSafety();
    render(<RideSafetyPanel safety={safety} />);

    expect(screen.getByLabelText("Your name for the link")).toHaveValue("Sam");
  });

  it("starts sharing with the typed name, then opens the share sheet with the link", async () => {
    const share = stubShare();
    const { safety, startSharing } = fakeSafety();
    render(<RideSafetyPanel safety={safety} />);

    fireEvent.change(screen.getByLabelText("Your name for the link"), { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Share live location" }));

    await waitFor(() => {
      expect(share).toHaveBeenCalledWith({
        title: "Follow my ride",
        text: "Sam is riding — follow live on OpenGravel",
        url: FOLLOW_URL,
      });
    });
    expect(startSharing).toHaveBeenCalledWith({ riderName: "Sam", route: null, plan: null });
    // The link only exists once the server made it, so the share comes second.
    const sharingOrder = startSharing.mock.invocationCallOrder[0] as number;
    const shareOrder = share.mock.invocationCallOrder[0] as number;
    expect(sharingOrder).toBeLessThan(shareOrder);
    expect(window.localStorage.getItem(LIVE_RIDER_NAME_STORAGE_KEY)).toBe("Sam");
  });

  it("offers an expected finish defaulting to the route's estimate plus the margin", async () => {
    stubShare();
    const { safety, startSharing } = fakeSafety();
    const routeLine = [
      { lon: -75.4, lat: 40.1 },
      { lon: -75.41, lat: 40.11 },
      { lon: -75.42, lat: 40.12 },
    ];
    render(<RideSafetyPanel safety={safety} routeLine={routeLine} remainingDurationSeconds={90 * 60} />);

    const field = screen.getByLabelText("Expected finish (optional)");
    // The route has an hour and a half left, so the default lands there plus half
    // an hour — never a number the panel invented on its own.
    const chosen = (field as HTMLInputElement).value;
    expect(chosen).toMatch(/^\d{2}:\d{2}$/);
    expect(screen.getByTestId("ride-live-finish-note")).toHaveTextContent("plus 30 min");

    fireEvent.change(screen.getByLabelText("Your name for the link"), { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Share live location" }));

    await waitFor(() => {
      expect(startSharing).toHaveBeenCalledTimes(1);
    });
    const shared = startSharing.mock.calls[0]?.[0];
    expect(shared?.riderName).toBe("Sam");
    expect(shared?.route?.segments).toEqual([routeLine]);
    const minutesFromNow = ((shared?.plan?.expectedFinishAt ?? 0) - Date.now()) / 60_000;
    expect(minutesFromNow).toBeGreaterThan(118);
    expect(minutesFromNow).toBeLessThan(122);
    // A whole minute, the shape the time field carries.
    expect((shared?.plan?.expectedFinishAt ?? 1) % 60_000).toBe(0);
  });

  it("sends no expected finish when the rider shares none", async () => {
    stubShare();
    const { safety, startSharing } = fakeSafety();
    render(<RideSafetyPanel safety={safety} />);

    // With no route there is no estimate to start from, so the field is empty
    // and the panel says what that means.
    expect(screen.getByLabelText("Expected finish (optional)")).toHaveValue("");
    expect(screen.getByTestId("ride-live-finish-note")).toHaveTextContent("only your live location");

    fireEvent.click(screen.getByRole("button", { name: "Share live location" }));

    await waitFor(() => {
      expect(startSharing).toHaveBeenCalledWith(expect.objectContaining({ plan: null, route: null }));
    });
  });

  it("shares the finish time the rider picked, and warns when it is already behind the clock", async () => {
    // A fixed afternoon, so "16:40" means one exact instant.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 9, 3, 15, 0, 0));
    try {
      stubShare();
      const { safety, startSharing } = fakeSafety();
      render(<RideSafetyPanel safety={safety} />);

      const field = screen.getByLabelText("Expected finish (optional)");
      fireEvent.change(field, { target: { value: "16:40" } });
      expect(screen.getByTestId("ride-live-finish-note")).not.toHaveTextContent("already passed");

      fireEvent.click(screen.getByRole("button", { name: "Share live location" }));
      await waitFor(() => {
        expect(startSharing).toHaveBeenCalledTimes(1);
      });
      const plan = startSharing.mock.calls[0]?.[0].plan;
      expect(plan?.expectedFinishAt).toBe(new Date(2026, 9, 3, 16, 40, 0).getTime());

      // A time behind the clock is not silently moved: it is shared as the
      // rider's own claim, and the follower page reads it as overdue.
      fireEvent.change(field, { target: { value: "14:00" } });
      expect(screen.getByTestId("ride-live-finish-note")).toHaveTextContent("already passed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the rider clear the finish time again", async () => {
    stubShare();
    const { safety, startSharing } = fakeSafety();
    render(<RideSafetyPanel safety={safety} routeLine={[{ lon: -75.4, lat: 40.1 }, { lon: -75.41, lat: 40.11 }]} remainingDurationSeconds={600} />);

    const field = screen.getByLabelText("Expected finish (optional)");
    expect((field as HTMLInputElement).value).not.toBe("");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Share live location" }));

    await waitFor(() => {
      expect(startSharing).toHaveBeenCalledWith(expect.objectContaining({ plan: null }));
    });
  });

  it("falls back to the clipboard when the device has no share sheet", async () => {
    const writeText = stubClipboard();
    const { safety } = fakeSafety();
    render(<RideSafetyPanel safety={safety} />);

    fireEvent.change(screen.getByLabelText("Your name for the link"), { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Share live location" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(FOLLOW_URL);
    });
    expect(await screen.findByText("Link copied — paste it into a message.")).toBeInTheDocument();
  });

  it("falls back to the clipboard when the share sheet refuses", async () => {
    stubShare(async () => {
      throw new Error("NotAllowedError");
    });
    const writeText = stubClipboard();
    const { safety } = fakeSafety();
    render(<RideSafetyPanel safety={safety} />);

    fireEvent.change(screen.getByLabelText("Your name for the link"), { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Share live location" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(FOLLOW_URL);
    });
  });

  it("shows the server's error when the link could not be made", async () => {
    const share = stubShare();
    const { safety, startSharing } = fakeSafety({
      live: { ...OFF_LIVE, status: "error", error: "Could not start live sharing." },
    });
    startSharing.mockResolvedValueOnce(null);
    render(<RideSafetyPanel safety={safety} />);

    fireEvent.click(screen.getByRole("button", { name: "Share live location" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Could not start live sharing.");
    await waitFor(() => {
      expect(startSharing).toHaveBeenCalledTimes(1);
    });
    // No link was made, so there is nothing to send and no name was learned.
    expect(startSharing).toHaveBeenCalledWith({ riderName: "Your rider", route: null, plan: null });
    expect(share).not.toHaveBeenCalled();
  });

  it("disables the button while the link is being created", () => {
    const { safety } = fakeSafety({ live: { ...OFF_LIVE, status: "starting" } });
    render(<RideSafetyPanel safety={safety} />);

    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
  });
});

describe("RideSafetyPanel — while sharing", () => {
  it("says it is sharing, when it last updated, and offers send and stop", () => {
    const { safety } = sharingSafety();
    render(<RideSafetyPanel safety={safety} />);

    expect(screen.getByText("Sharing live location")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/^Updated \d+ s ago$/);
    expect(screen.queryByLabelText("Your name for the link")).not.toBeInTheDocument();
  });

  it("says when no position has reached the link yet, and how many are waiting", () => {
    const waiting = sharingSafety({ lastSentAt: null, pending: 12 });
    const { unmount } = render(<RideSafetyPanel safety={waiting.safety} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for your first position…");
    unmount();

    const queued = sharingSafety({ lastSentAt: Date.now() - 30_000, pending: 12 });
    render(<RideSafetyPanel safety={queued.safety} />);
    expect(screen.getByRole("status")).toHaveTextContent("12 positions waiting");
  });

  it("re-sends the existing link without creating another one", async () => {
    const share = stubShare();
    const { safety, startSharing } = sharingSafety();
    render(<RideSafetyPanel safety={safety} />);

    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    await waitFor(() => {
      expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: FOLLOW_URL }));
    });
    expect(startSharing).not.toHaveBeenCalled();
  });

  it("stops sharing when the rider says so", () => {
    const { safety, stopSharing } = sharingSafety();
    render(<RideSafetyPanel safety={safety} />);

    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));

    expect(stopSharing).toHaveBeenCalledTimes(1);
  });

  it("shows a lost-signal notice from the session", () => {
    const offline = sharingSafety({ error: "No signal — positions will send when it returns." });
    render(<RideSafetyPanel safety={offline.safety} />);

    expect(screen.getByRole("status")).toHaveTextContent("No signal");
  });
});

describe("RideSafetyOverlay", () => {
  it("renders nothing when no check is live", () => {
    const { safety } = fakeSafety();
    render(<RideSafetyOverlay safety={safety} />);

    expect(screen.queryByTestId("crash-check-overlay")).not.toBeInTheDocument();
  });

  it("puts the crash check over the ride screen during the countdown", () => {
    const { safety, imOkay, alertNow } = fakeSafety({
      live: { ...OFF_LIVE, status: "sharing", followUrl: FOLLOW_URL },
      crash: { phase: "countdown", suspected: { type: "suspected", atMs: 1_000, location: { lat: 45.5, lon: -122.6 } }, secondsRemaining: 42 },
    });
    render(<RideSafetyOverlay safety={safety} />);

    const overlay = screen.getByTestId("crash-check-overlay");
    expect(overlay).toHaveAttribute("data-status", "countdown");
    expect(screen.getByTestId("crash-check-countdown")).toHaveTextContent("42");

    fireEvent.click(screen.getByTestId("crash-check-im-okay"));
    expect(imOkay).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("crash-check-alert-now"));
    expect(alertNow).toHaveBeenCalledTimes(1);
  });

  it("stays up after escalation and offers I'm OK now", () => {
    const { safety, imOkayNow } = fakeSafety({
      live: { ...OFF_LIVE, status: "sharing", followUrl: FOLLOW_URL },
      crash: { phase: "escalated", suspected: { type: "suspected", atMs: 1_000, location: { lat: 45.5, lon: -122.6 } }, secondsRemaining: null },
    });
    render(<RideSafetyOverlay safety={safety} />);

    expect(screen.getByTestId("crash-check-overlay")).toHaveAttribute("data-status", "escalated");
    fireEvent.click(screen.getByTestId("crash-check-im-okay-now"));
    expect(imOkayNow).toHaveBeenCalledTimes(1);
  });

  it("disappears once the rider dismissed it", () => {
    const { safety } = fakeSafety({
      crash: { phase: "dismissed", suspected: null, secondsRemaining: null },
    });
    render(<RideSafetyOverlay safety={safety} />);

    expect(screen.queryByTestId("crash-check-overlay")).not.toBeInTheDocument();
  });
});
