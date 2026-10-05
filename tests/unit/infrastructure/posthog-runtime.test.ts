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
  it("does not load before consent and stops immediately after withdrawal", async () => {
    const { runtime, sdk, load, acknowledge, withdraw } = setup();
    await runtime.sync();
    expect(load).not.toHaveBeenCalled();
    acknowledge();
    await runtime.sync();
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.set_config).toHaveBeenCalledTimes(1);
    expect(sdk.startSessionRecording).toHaveBeenCalled();
    withdraw();
    await runtime.sync();
    expect(sdk.stopSessionRecording).toHaveBeenCalled();
    expect(sdk.opt_out_capturing).toHaveBeenCalled();
    runtime.transport.send({ name: "planner_opened", properties: {}, build: { appVersion: "0", buildId: "test" } });
    expect(sdk.capture).not.toHaveBeenCalled();
  });
  it("handles consent withdrawal while the SDK is loading", async () => {
    const { runtime, load, sdk, acknowledge, withdraw } = setup();
    let finish!: (sdk: unknown) => void;
    load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    acknowledge();
    const pending = runtime.sync();
    withdraw();
    await runtime.sync();
    finish(sdk);
    await pending;
    expect(sdk.init).not.toHaveBeenCalled();
  });
});

it("retries initialization when consent is regranted during a pending import", async () => {
  const { runtime, load, sdk, acknowledge, withdraw } = setup();
  let finish!: (sdk: unknown) => void;
  load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  acknowledge();
  const first = runtime.sync();
  withdraw();
  await runtime.sync();
  acknowledge();
  const second = runtime.sync();
  finish(sdk);
  await Promise.all([first, second]);
  expect(sdk.init).toHaveBeenCalledTimes(1);
});
