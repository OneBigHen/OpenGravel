import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OfflineShell } from "@/app/OfflineShell";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function browser() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_OGV_SHELL_BUILD_ID", "build-123");
  const register = vi.fn().mockResolvedValue({});
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  return register;
}

it("registers a versioned worker in production and tolerates an unavailable install", async () => {
  const register = browser().mockRejectedValue(new Error("Storage unavailable"));
  render(<OfflineShell />);
  await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js?build=build-123", { scope: "/", updateViaCache: "none" }));
});

it("registers within the runtime deployment prefix passed by the server", () => {
  const register = browser();
  render(<OfflineShell assetBasePath="/ogv" />);
  expect(register).toHaveBeenCalledWith("/ogv/sw.js?build=build-123", { scope: "/ogv/", updateViaCache: "none" });
});

it("does not register in development", () => {
  const register = browser();
  vi.stubEnv("NODE_ENV", "development");
  render(<OfflineShell />);
  expect(register).not.toHaveBeenCalled();
});

it("leaves the Capacitor native shell in charge of its own startup", () => {
  const register = browser();
  vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
  render(<OfflineShell />);
  expect(register).not.toHaveBeenCalled();
});

it("does nothing when the browser does not support service workers", () => {
  browser();
  vi.stubGlobal("navigator", {});
  expect(() => render(<OfflineShell />)).not.toThrow();
});
