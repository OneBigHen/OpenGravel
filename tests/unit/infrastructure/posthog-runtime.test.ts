import { describe, expect, it, vi } from "vitest";
import { createPostHogRuntime } from "@/infrastructure/telemetry/posthog-runtime";
import { acknowledgedConsentState } from "@/application/telemetry/consent";
import type { TelemetryConsentState } from "@/application/telemetry/consent";
import type { PostHog } from "posthog-js";
function setup() {
  let consent: TelemetryConsentState = { status: "unacknowledged" };
  const sdk = { init: vi.fn(), set_config: vi.fn(), capture: vi.fn(), opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn(), startSessionRecording: vi.fn(), stopSessionRecording: vi.fn(), reset: vi.fn() };
  const load = vi.fn().mockResolvedValue(sdk);
  const runtime = createPostHogRuntime({ mode: "hosted-beta", projectToken: "phc_test", host: "https://us.i.posthog.com", build: { appVersion: "0.0.0", buildId: "test" }, consent: () => consent, load: load as () => Promise<PostHog> });
  return { sdk, runtime, load, acknowledge: () => { consent = acknowledgedConsentState("now"); }, withdraw: () => { consent = { status: "unacknowledged" }; } };
}
describe("PostHog browser lifecycle", () => {
  it("counts page visits before consent, adds actions and replay after it, and drops back on withdrawal", async () => {
    const { runtime, sdk, load, acknowledge, withdraw } = setup();
    await runtime.sync();
    // Visitor tier: the SDK loads, a page visit is counted, nothing else is sent.
    expect(load).toHaveBeenCalledTimes(1);
    expect(sdk.startSessionRecording).not.toHaveBeenCalled();
    runtime.pageview("planner");
    expect(sdk.capture).toHaveBeenCalledWith("$pageview", { page: "planner" });
    runtime.transport.send({ name: "planner_opened", properties: {}, build: { appVersion: "0", buildId: "test" } });
    expect(sdk.capture).toHaveBeenCalledTimes(1);
    acknowledge();
    await runtime.sync();
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.set_config).toHaveBeenCalledTimes(1);
    expect(sdk.startSessionRecording).toHaveBeenCalledTimes(1);
    runtime.transport.send({ name: "planner_opened", properties: {}, build: { appVersion: "0", buildId: "test" } });
    expect(sdk.capture).toHaveBeenCalledTimes(2);
    withdraw();
    await runtime.sync();
    expect(sdk.stopSessionRecording).toHaveBeenCalled();
    runtime.transport.send({ name: "planner_opened", properties: {}, build: { appVersion: "0", buildId: "test" } });
    expect(sdk.capture).toHaveBeenCalledTimes(2);
  });

  it("sends nothing when the page is not eligible", async () => {
    const sdk = { init: vi.fn(), set_config: vi.fn(), capture: vi.fn(), opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn(), startSessionRecording: vi.fn(), stopSessionRecording: vi.fn(), reset: vi.fn() };
    const load = vi.fn().mockResolvedValue(sdk);
    const runtime = createPostHogRuntime({ mode: "hosted-beta", projectToken: "phc_test", host: "https://us.i.posthog.com", build: { appVersion: "0", buildId: "t" }, consent: () => ({ status: "unacknowledged" }), eligible: () => false, load: load as () => Promise<PostHog> });
    await runtime.sync();
    runtime.pageview("planner");
    expect(load).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
  });
  it("handles the page becoming ineligible while the SDK is loading", async () => {
    let eligible = true;
    const sdk = { init: vi.fn(), set_config: vi.fn(), capture: vi.fn(), opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn(), startSessionRecording: vi.fn(), stopSessionRecording: vi.fn(), reset: vi.fn() };
    let finish!: (sdk: unknown) => void;
    const load = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const runtime = createPostHogRuntime({ mode: "hosted-beta", projectToken: "phc_test", host: "https://us.i.posthog.com", build: { appVersion: "0", buildId: "t" }, consent: () => ({ status: "unacknowledged" }), eligible: () => eligible, load: load as () => Promise<PostHog> });
    const pending = runtime.sync();
    eligible = false;
    await runtime.sync();
    finish(sdk);
    await pending;
    expect(sdk.init).not.toHaveBeenCalled();
  });
});

it("retries initialization when the page becomes eligible again during a pending import", async () => {
  let eligible = true;
  const sdk = { init: vi.fn(), set_config: vi.fn(), capture: vi.fn(), opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn(), startSessionRecording: vi.fn(), stopSessionRecording: vi.fn(), reset: vi.fn() };
  let finish!: (sdk: unknown) => void;
  const load = vi.fn().mockResolvedValue(sdk).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const runtime = createPostHogRuntime({ mode: "hosted-beta", projectToken: "phc_test", host: "https://us.i.posthog.com", build: { appVersion: "0", buildId: "t" }, consent: () => ({ status: "unacknowledged" }), eligible: () => eligible, load: load as () => Promise<PostHog> });
  const first = runtime.sync();
  eligible = false;
  await runtime.sync();
  eligible = true;
  const second = runtime.sync();
  finish(sdk);
  await Promise.all([first, second]);
  expect(sdk.init).toHaveBeenCalledTimes(1);
});
