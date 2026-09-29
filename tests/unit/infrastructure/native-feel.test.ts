import { describe, expect, it, vi } from "vitest";

import { haptic, hapticForTestId, installTapHaptics } from "@/infrastructure/native/native-feel";

function app() {
  const plugin = {
    impact: vi.fn(async () => undefined),
    notification: vi.fn(async () => undefined),
    selectionChanged: vi.fn(async () => undefined),
  };
  return { plugin, scope: { Capacitor: { isNativePlatform: () => true, Plugins: { Haptics: plugin } }, document } };
}

describe("native feel", () => {
  it("gives the controls that matter a physical answer", () => {
    expect(hapticForTestId("start-ride")).toBe("medium");
    expect(hapticForTestId("ride-finish")).toBe("success");
    expect(hapticForTestId("route-card-best-ride")).toBe("select");
    expect(hapticForTestId("free-ride-loop-120")).toBe("medium");
    expect(hapticForTestId("place-option-describe")).toBe("light");
    expect(hapticForTestId("settings-save-home")).toBeNull();
    expect(hapticForTestId(null)).toBeNull();
  });

  it("plays the matching native haptic, and nothing in a browser", () => {
    const { plugin, scope } = app();
    haptic("success", scope);
    haptic("heavy", scope);
    haptic("select", scope);
    expect(plugin.notification).toHaveBeenCalledWith({ type: "SUCCESS" });
    expect(plugin.impact).toHaveBeenCalledWith({ style: "HEAVY" });
    expect(plugin.selectionChanged).toHaveBeenCalledOnce();
    expect(() => haptic("heavy", {})).not.toThrow();
    expect(installTapHaptics({ document })).toBeNull();
  });

  it("answers a tap on Start ride, and not on a disabled one", () => {
    const { plugin, scope } = app();
    const uninstall = installTapHaptics(scope);
    const button = document.createElement("button");
    button.dataset.testid = "start-ride";
    button.innerHTML = "<span>Start ride</span>";
    document.body.append(button);
    button.querySelector("span")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(plugin.impact).toHaveBeenCalledWith({ style: "MEDIUM" });
    button.disabled = true;
    button.click();
    expect(plugin.impact).toHaveBeenCalledOnce();
    uninstall?.();
    button.remove();
  });
});
