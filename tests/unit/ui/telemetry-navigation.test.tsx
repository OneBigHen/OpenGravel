import { render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ search: "", sync: vi.fn(), pageview: vi.fn(), stop: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/ride", useSearchParams: () => new URLSearchParams(state.search) }));
vi.mock("@/infrastructure/telemetry/posthog-runtime", () => ({ createPostHogRuntime: () => ({ sync: state.sync, pageview: state.pageview, stop: state.stop, transport: { send: vi.fn() } }) }));
import { TelemetryClient } from "@/app/TelemetryClient";

beforeEach(() => { vi.clearAllMocks(); state.sync.mockResolvedValue(undefined); localStorage.clear(); });

it("resumes the safe Ride Focus page after private handoff parameters are removed", async () => {
  const build = { appVersion: "test", buildId: "test" };
  state.search = "record=1&rideId=private";
  window.history.replaceState(null, "", "/ride?" + state.search);
  const view = render(<TelemetryClient build={build} mode="hosted-beta" />);
  await waitFor(() => expect(state.sync).toHaveBeenCalled());
  expect(state.pageview).not.toHaveBeenCalled();
  state.search = "";
  window.history.replaceState(null, "", "/ride");
  view.rerender(<TelemetryClient build={build} mode="hosted-beta" />);
  await waitFor(() => expect(state.pageview).toHaveBeenCalledWith("ride"));
});
