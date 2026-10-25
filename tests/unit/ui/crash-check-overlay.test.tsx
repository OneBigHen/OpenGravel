/**
 * The crash-check overlay (issue #12 follower safety): the huge explicit
 * choices, the countdown copy, the post-escalation copy, and the one thing the
 * screen must never do — disappear on Escape without the rider saying so.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CrashCheckOverlay } from "@/ui/safety/CrashCheckOverlay";

function renderCountdown(overrides: Partial<Parameters<typeof CrashCheckOverlay>[0]> = {}) {
  const onImOkay = vi.fn();
  const onAlertNow = vi.fn();
  const onImOkayNow = vi.fn();
  const view = render(
    <CrashCheckOverlay
      status="countdown"
      secondsRemaining={42}
      onImOkay={onImOkay}
      onAlertNow={onAlertNow}
      onImOkayNow={onImOkayNow}
      {...overrides}
    />,
  );
  return { ...view, onImOkay, onAlertNow, onImOkayNow };
}

afterEach(() => {
  cleanup();
  delete (navigator as { vibrate?: unknown }).vibrate;
});

describe("CrashCheckOverlay — countdown", () => {
  it("is an alert dialog with the question, the seconds and the alert promise", () => {
    renderCountdown();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Are you OK?" })).toBeInTheDocument();
    expect(screen.getByTestId("crash-check-countdown")).toHaveTextContent("42");
    expect(screen.getByTestId("crash-check-line")).toHaveTextContent(
      "Crash detected? We'll alert your followers in 42 s.",
    );
  });

  it("names the follower or group the alert will reach", () => {
    renderCountdown({ audience: "Sam" });
    expect(screen.getByTestId("crash-check-line")).toHaveTextContent(
      "Crash detected? We'll alert Sam in 42 s.",
    );
  });

  it("calls back when the rider says they are OK", () => {
    const { onImOkay } = renderCountdown();
    fireEvent.click(screen.getByRole("button", { name: "I’m OK" }));
    expect(onImOkay).toHaveBeenCalledTimes(1);
  });

  it("calls back on Alert now and offers a real 911 dial link", () => {
    const { onAlertNow } = renderCountdown();
    fireEvent.click(screen.getByRole("button", { name: "Alert now" }));
    expect(onAlertNow).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Call 911" })).toHaveAttribute("href", "tel:911");
  });

  it("does not dismiss on Escape", () => {
    const { onImOkay, onAlertNow, onImOkayNow } = renderCountdown();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onImOkay).not.toHaveBeenCalled();
    expect(onAlertNow).not.toHaveBeenCalled();
    expect(onImOkayNow).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("puts focus on I'm OK on open and traps Tab inside the dialog", () => {
    renderCountdown();
    const primary = screen.getByRole("button", { name: "I’m OK" });
    expect(document.activeElement).toBe(primary);

    // Shift+Tab from the first control wraps to the last one (the 911 link).
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Call 911" }));

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(primary);
  });

  it("vibrates when the device supports it", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true });
    renderCountdown();
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate.mock.calls[0]?.[0]).toEqual([400, 200, 400]);
  });

  it("renders without a vibration API (desktop) without failing", () => {
    expect(() => renderCountdown()).not.toThrow();
  });

  it("never shows a negative countdown", () => {
    renderCountdown({ secondsRemaining: -3 });
    expect(screen.getByTestId("crash-check-countdown")).toHaveTextContent("0");
    expect(screen.getByTestId("crash-check-line")).toHaveTextContent(
      "Crash detected? We'll alert your followers in 0 s.",
    );
  });
});

describe("CrashCheckOverlay — escalated", () => {
  it("says the alert went out and offers I'm OK now, not a dismissal", () => {
    const onImOkay = vi.fn();
    const onImOkayNow = vi.fn();
    render(
      <CrashCheckOverlay
        status="escalated"
        secondsRemaining={0}
        onImOkay={onImOkay}
        onAlertNow={vi.fn()}
        onImOkayNow={onImOkayNow}
      />,
    );

    expect(screen.getByTestId("crash-check-overlay")).toHaveAttribute("data-status", "escalated");
    expect(screen.getByTestId("crash-check-line")).toHaveTextContent(
      "Your followers were alerted with your location.",
    );
    expect(screen.queryByTestId("crash-check-countdown")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I’m OK" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "I’m OK now" }));
    expect(onImOkayNow).toHaveBeenCalledTimes(1);
    expect(onImOkay).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Call 911" })).toHaveAttribute("href", "tel:911");
  });

  it("still does not dismiss on Escape after escalation", () => {
    const onImOkayNow = vi.fn();
    render(
      <CrashCheckOverlay
        status="escalated"
        secondsRemaining={0}
        onImOkay={vi.fn()}
        onAlertNow={vi.fn()}
        onImOkayNow={onImOkayNow}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onImOkayNow).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("moves focus to I'm OK now when the countdown escalates in place", () => {
    const props = {
      onImOkay: vi.fn(),
      onAlertNow: vi.fn(),
      onImOkayNow: vi.fn(),
    };
    const view = render(<CrashCheckOverlay status="countdown" secondsRemaining={10} {...props} />);
    view.rerender(<CrashCheckOverlay status="escalated" secondsRemaining={0} {...props} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "I’m OK now" }));
  });
});
