import { describe, expect, it } from "vitest";
import type { CaptureResult } from "posthog-js";
import { postHogConfig, sanitizePostHogEvent } from "@/infrastructure/telemetry/posthog-policy";
const build = { appVersion: "0.0.0", buildId: "test-build" };
const event = (name: string, properties: Record<string, unknown>) => ({ event: name, properties }) as CaptureResult;
describe("PostHog privacy policy", () => {
  it("keeps useful click structure but strips text, attributes, URLs and identifiers", () => {
    const result = sanitizePostHogEvent(event("$autocapture", { distinct_id: "anonymous", $session_id: "session", $current_url: "https://example.com/share/private?token=secret", $referrer: "private", $event_type: "click", $elements: [{ tag_name: "button", nth_child: 1, $el_text: "Private ride", "attr__href": "secret", "attr__data-testid": "compose-create" }] }), build);
    expect(result?.properties.$elements).toEqual([{ tag_name: "button", nth_child: 1, "attr__data-testid": "compose-create" }]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result?.properties.buildId).toBe("test-build");
  });
  it("drops unknown events and unbounded semantic properties", () => {
    expect(sanitizePostHogEvent(event("accidental", { geometry: [1, 2] }), build)).toBeNull();
    expect(sanitizePostHogEvent(event("route_plan_failed", { errorClass: "no-result", geometry: [1, 2] }), build)?.properties).not.toHaveProperty("geometry");
  });
  it("pins replay masking, disables network/console capture and enables selected autocapture", () => {
    const config = postHogConfig("https://us.i.posthog.com", build, () => true);
    expect(config.autocapture).toMatchObject({ dom_event_allowlist: ["click", "change", "submit"], capture_copied_text: false });
    expect(config.session_recording).toMatchObject({ maskAllInputs: true, maskTextSelector: "*", recordHeaders: false, recordBody: false, captureCanvas: { recordCanvas: false } });
    expect(config.enable_recording_console_log).toBe(false);
    expect(config.persistence).toBe("memory");
    expect(config.capture_exceptions).toBeTruthy();
  });
  it("drops events immediately after withdrawal", () => {
    const config = postHogConfig("https://us.i.posthog.com", build, () => false);
    expect(typeof config.before_send === "function" && config.before_send(event("planner_opened", {}))).toBeNull();
  });
});

it("before acknowledgement lets only an anonymous page visit through, with a persistent visitor id", () => {
  const config = postHogConfig("https://us.i.posthog.com", build, () => true, { full: () => false, persistent: true });
  expect(config.persistence).toBe("localStorage");
  const send = config.before_send as (event: CaptureResult) => CaptureResult | null;
  expect(send(event("$pageview", { distinct_id: "anon", page: "planner" }))?.properties.distinct_id).toBe("anon");
  expect(send(event("$autocapture", {}))).toBeNull();
  expect(send(event("route_plan_requested", {}))).toBeNull();
  expect(send(event("$exception", {}))).toBeNull();
});

it("preserves safe UI styling and masks rider-controlled attributes", () => {
  const recording = postHogConfig("https://us.i.posthog.com", { appVersion: "0", buildId: "test" }, () => true).session_recording;
  expect(recording?.maskAttributeFn?.("class", "og-settings__section")).toBe("og-settings__section");
  expect(recording?.maskAttributeFn?.("href", "/share/private")).toBe("[masked]");
  expect(recording?.maskAttributeFn?.("id", "private-ride-id")).toBe("[masked]");
});

it("keeps static JavaScript stack locations without leaking error text or query strings", () => {
  const result = sanitizePostHogEvent({ uuid: "test", event: "$exception", properties: { $exception_list: [{ type: "TypeError", value: "private coordinates", stacktrace: { frames: [{ filename: "https://example.com/_next/static/chunks/app.js?token=secret", lineno: 21, colno: 3, function: "planRide", vars: { location: "private" } }] } }] } } as CaptureResult, { appVersion: "0", buildId: "test" });
  expect(result?.properties.$exception_list[0].stacktrace.frames).toEqual([{ filename: "/_next/static/chunks/app.js", lineno: 21, colno: 3, function: "planRide" }]);
  expect(JSON.stringify(result)).not.toContain("private");
  expect(JSON.stringify(result)).not.toContain("secret");
});

it("retains the public project token required by SDK ingestion", () => {
  const result = sanitizePostHogEvent({ uuid: "test", event: "$pageview", properties: { token: "phc_project", distinct_id: "anonymous" } } as CaptureResult, { appVersion: "0", buildId: "test" });
  expect(result?.properties.token).toBe("phc_project");
});

it("correlates routing events with bounded policy and graph versions", () => {
  const result = sanitizePostHogEvent({ uuid: "test", event: "route_plan_requested", properties: {} } as CaptureResult, { appVersion: "1", buildId: "test", routePolicyVersion: "vnext-1", graphVersionBand: "graph-2026-10" });
  expect(result?.properties).toMatchObject({ routePolicyVersion: "vnext-1", graphVersionBand: "graph-2026-10" });
});
