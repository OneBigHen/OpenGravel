import { describe, expect, it, vi } from "vitest";
import { createPostHogRuntime } from "@/infrastructure/telemetry/posthog-runtime";
import type { TelemetryIdleScheduler } from "@/infrastructure/telemetry/idle-scheduler";
import { acknowledgedConsentState } from "@/application/telemetry/consent";
import type { TelemetryConsentState } from "@/application/telemetry/consent";
import type { TelemetryEnvelope } from "@/application/telemetry/events";
import type { PostHog } from "posthog-js";

const BUILD = { appVersion: "0", buildId: "test" };
const ENVELOPE: TelemetryEnvelope = { name: "planner_opened", properties: {}, build: BUILD };

/** Runs the deferred task immediately; the production scheduler waits for idle. */
const immediately: TelemetryIdleScheduler = (run) => {
  run();
  return () => {};
};

/** Holds the deferred task until the test releases the idle moment. */
function deferredScheduler() {
  let scheduled: (() => void) | null = null;
  const scheduler: TelemetryIdleScheduler = (run) => {
    scheduled = run;
    return () => { scheduled = null; };
  };
  return {
    scheduler,
    get hasPending(): boolean { return scheduled !== null; },
    run(): void {
      const next = scheduled;
      scheduled = null;
      next?.();
    },
  };
}

function fakeSdk() {
  return {
    init: vi.fn(),
    set_config: vi.fn(),
    capture: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    startSessionRecording: vi.fn(),
    stopSessionRecording: vi.fn(),
    reset: vi.fn(),
  };
}

function setup(options: { schedule?: TelemetryIdleScheduler; projectToken?: string; consent?: TelemetryConsentState } = {}) {
  let consent: TelemetryConsentState = options.consent ?? { status: "unacknowledged" };
  const sdk = fakeSdk();
  const load = vi.fn().mockResolvedValue(sdk);
  const runtime = createPostHogRuntime({
    mode: "hosted-beta",
    projectToken: options.projectToken ?? "phc_test",
    host: "https://us.i.posthog.com",
    build: BUILD,
    consent: () => consent,
    load: load as () => Promise<PostHog>,
    schedule: options.schedule ?? immediately,
  });
  return {
    sdk,
    runtime,
    load,
    acknowledge: () => { consent = acknowledgedConsentState("now"); },
    withdraw: () => { consent = { status: "unacknowledged" }; },
  };
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
    runtime.transport.send(ENVELOPE);
    expect(sdk.capture).toHaveBeenCalledTimes(1);
    acknowledge();
    await runtime.sync();
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.set_config).toHaveBeenCalledTimes(1);
    expect(sdk.startSessionRecording).toHaveBeenCalledTimes(1);
    runtime.transport.send(ENVELOPE);
    expect(sdk.capture).toHaveBeenCalledTimes(2);
    withdraw();
    await runtime.sync();
    expect(sdk.stopSessionRecording).toHaveBeenCalled();
    runtime.transport.send(ENVELOPE);
    expect(sdk.capture).toHaveBeenCalledTimes(2);
  });

  it("waits for the idle scheduler before importing the SDK", async () => {
    const idle = deferredScheduler();
    const { runtime, load } = setup({ schedule: idle.scheduler });
    const first = runtime.sync();
    expect(load).not.toHaveBeenCalled();
    expect(idle.hasPending).toBe(true);
    idle.run();
    await first;
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("queues page visits and full-tier events until the deferred import, then flushes them in order", async () => {
    const idle = deferredScheduler();
    const { runtime, sdk, load, acknowledge } = setup({ schedule: idle.scheduler });
    acknowledge();
    const syncing = runtime.sync();
    runtime.pageview("planner");
    runtime.transport.send(ENVELOPE);
    expect(load).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
    idle.run();
    await syncing;
    expect(load).toHaveBeenCalledTimes(1);
    expect(sdk.capture).toHaveBeenNthCalledWith(1, "$pageview", { page: "planner" });
    expect(sdk.capture).toHaveBeenNthCalledWith(2, "planner_opened", {});
  });

  it("keeps the anonymous page-visit tier while queued: no acknowledgement still counts the visit", async () => {
    const idle = deferredScheduler();
    const { runtime, sdk } = setup({ schedule: idle.scheduler });
    const syncing = runtime.sync();
    runtime.pageview("planner");
    runtime.transport.send(ENVELOPE);
    idle.run();
    await syncing;
    expect(sdk.capture).toHaveBeenCalledTimes(1);
    expect(sdk.capture).toHaveBeenCalledWith("$pageview", { page: "planner" });
    expect(sdk.startSessionRecording).not.toHaveBeenCalled();
  });

  it("re-checks consent when flushing: a withdrawal while queued never sends full-tier events", async () => {
    const idle = deferredScheduler();
    const { runtime, sdk, acknowledge, withdraw } = setup({ schedule: idle.scheduler });
    acknowledge();
    const syncing = runtime.sync();
    runtime.pageview("planner");
    runtime.transport.send(ENVELOPE);
    withdraw();
    idle.run();
    await syncing;
    // The anonymous page visit stays; the action and replay do not.
    expect(sdk.capture).toHaveBeenCalledTimes(1);
    expect(sdk.capture).toHaveBeenCalledWith("$pageview", { page: "planner" });
    expect(sdk.startSessionRecording).not.toHaveBeenCalled();
  });

  it("does not schedule anything when the project token is absent (dev/tests)", async () => {
    const idle = deferredScheduler();
    const { runtime, sdk, load } = setup({ schedule: idle.scheduler, projectToken: "" });
    await runtime.sync();
    runtime.pageview("planner");
    runtime.transport.send(ENVELOPE);
    expect(idle.hasPending).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
  });

  it("keeps session recording off at init and starts it only for the acknowledged tier", async () => {
    const { runtime, sdk, acknowledge } = setup();
    await runtime.sync();
    const config = sdk.init.mock.calls[0]?.[1] as { disable_session_recording?: boolean };
    expect(config.disable_session_recording).toBe(true);
    expect(sdk.startSessionRecording).not.toHaveBeenCalled();
    acknowledge();
    await runtime.sync();
    expect(sdk.startSessionRecording).toHaveBeenCalledTimes(1);
  });

  it("cancels a scheduled import when the runtime is stopped", async () => {
    const idle = deferredScheduler();
    const { runtime, load } = setup({ schedule: idle.scheduler });
    const syncing = runtime.sync();
    expect(idle.hasPending).toBe(true);
    runtime.stop();
    expect(idle.hasPending).toBe(false);
    await syncing;
    expect(load).not.toHaveBeenCalled();
  });

  it("sends nothing when the page is not eligible", async () => {
    const sdk = fakeSdk();
    const load = vi.fn().mockResolvedValue(sdk);
    const schedule = vi.fn(immediately);
    const runtime = createPostHogRuntime({ mode: "hosted-beta", projectToken: "phc_test", host: "https://us.i.posthog.com", build: BUILD, consent: () => ({ status: "unacknowledged" }), eligible: () => false, load: load as () => Promise<PostHog>, schedule });
    await runtime.sync();
    runtime.pageview("planner");
    expect(schedule).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
  });

  it("handles the page becoming ineligible while the SDK is loading", async () => {
    let eligible = true;
    const sdk = fakeSdk();
    let finish!: (sdk: unknown) => void;
    const load = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const runtime = createPostHogRuntime({ mode: "hosted-beta", projectToken: "phc_test", host: "https://us.i.posthog.com", build: BUILD, consent: () => ({ status: "unacknowledged" }), eligible: () => eligible, load: load as () => Promise<PostHog>, schedule: immediately });
    const pending = runtime.sync();
    await Promise.resolve();
    eligible = false;
    await runtime.sync();
    finish(sdk);
    await pending;
    expect(sdk.init).not.toHaveBeenCalled();
  });
});

it("retries initialization when the page becomes eligible again during a pending import", async () => {
  let eligible = true;
  const sdk = fakeSdk();
  let finish!: (sdk: unknown) => void;
  const load = vi.fn().mockResolvedValue(sdk).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const runtime = createPostHogRuntime({ mode: "hosted-beta", projectToken: "phc_test", host: "https://us.i.posthog.com", build: BUILD, consent: () => ({ status: "unacknowledged" }), eligible: () => eligible, load: load as () => Promise<PostHog>, schedule: immediately });
  const first = runtime.sync();
  await Promise.resolve();
  eligible = false;
  await runtime.sync();
  eligible = true;
  const second = runtime.sync();
  finish(sdk);
  await Promise.all([first, second]);
  expect(sdk.init).toHaveBeenCalledTimes(1);
});
