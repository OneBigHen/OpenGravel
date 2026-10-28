import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LiveActivityRow } from "@/ui/settings/LiveActivityRow";
import { LIVE_ACTIVITY_STORAGE_KEY, readLiveActivityEnabled, setLiveActivityEnabled } from "@/ui/navigation/live-activity-setting";

afterEach(() => { cleanup(); window.localStorage.clear(); });

describe("Lock screen Live Activity setting", () => {
  it("is on by default and stores only the off choice", () => {
    expect(readLiveActivityEnabled()).toBe(true);
    render(<LiveActivityRow />);
    const toggle = screen.getByRole("checkbox", { name: "Lock screen Live Activity" });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle);
    expect(window.localStorage.getItem(LIVE_ACTIVITY_STORAGE_KEY)).toBe("off");
    expect(readLiveActivityEnabled()).toBe(false);
    expect((toggle as HTMLInputElement).checked).toBe(false);
    act(() => setLiveActivityEnabled(true));
    expect(window.localStorage.getItem(LIVE_ACTIVITY_STORAGE_KEY)).toBeNull();
  });
});
