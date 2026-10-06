import type { CaptureResult, PostHogConfig } from "posthog-js";
import { TELEMETRY_EVENT_NAMES, sanitizeTelemetryProperties, type TelemetryBuildCorrelation, type TelemetryEventName } from "@/application/telemetry/events";

const AUTOMATIC_EVENTS = ["$autocapture", "$pageview", "$pageleave", "$rageclick", "$dead_click", "$exception", "$snapshot"];
const SAFE_CONTROL = /^(compose-create|prepare-toggle|save-named-ride|start-search|finish-search|settings-[a-z-]+)$/;
/** Reconstruct properties; never forward SDK URL, text or attribute enrichment. */
export function sanitizePostHogEvent(event: CaptureResult | null, build: TelemetryBuildCorrelation): CaptureResult | null {
  if (event === null) return null;
  if (!AUTOMATIC_EVENTS.includes(event.event) && !(TELEMETRY_EVENT_NAMES as readonly string[]).includes(event.event)) return null;
  const input = event.properties ?? {};
  const properties: Record<string, unknown> = { ...sanitizeTelemetryProperties(event.event as TelemetryEventName, input), appVersion: build.appVersion, buildId: build.buildId, telemetrySchemaVersion: "1", $process_person_profile: false };
  for (const key of ["routePolicyVersion", "graphVersionBand"] as const) {
    const value = build[key];
    if (typeof value === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(value)) properties[key] = value;
  }
  if (typeof input.token === "string" && input.token.startsWith("phc_")) properties.token = input.token;
  for (const key of ["distinct_id", "$session_id", "$window_id", "$lib", "$lib_version"]) {
    if (typeof input[key] === "string") properties[key] = input[key];
  }
  if (["planner", "settings", "explore", "rides", "ride"].includes(input.page)) {
    properties.page = input.page;
    properties.$current_url = `https://opengravel.henning.rodeo/${input.page === "planner" ? "" : input.page}`;
  }
  if (["click", "change", "submit"].includes(input.$event_type)) properties.$event_type = input.$event_type;
  if (Array.isArray(input.$elements)) {
    properties.$elements = input.$elements.slice(0, 15).map((element: Record<string, unknown>) => {
      const safe: Record<string, unknown> = {};
      if (typeof element.tag_name === "string" && /^[a-z]{1,20}$/.test(element.tag_name)) safe.tag_name = element.tag_name;
      for (const key of ["nth_child", "nth_of_type"]) if (typeof element[key] === "number") safe[key] = element[key];
      const control = element["attr__data-testid"];
      if (typeof control === "string" && SAFE_CONTROL.test(control)) safe["attr__data-testid"] = control;
      return safe;
    });
  }
  if (event.event === "$snapshot") {
    // DOM payloads were masked at recording time, before SDK compression.
    // rrweb metadata remains uncompressed: remove navigation URLs there too.
    const redact = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(redact);
      if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, ["href", "url"].includes(key) ? "https://opengravel.invalid/" : redact(child)]));
      return value;
    };
    properties.$snapshot_data = redact(input.$snapshot_data);
    properties.$snapshot_bytes = input.$snapshot_bytes;
  }
  if (event.event === "$exception") {
    // Exception text can contain provider payloads, URLs and rider-entered values.
    const exceptions = Array.isArray(input.$exception_list) ? input.$exception_list.slice(0, 5) : [{}];
    properties.$exception_list = exceptions.map((exception: Record<string, unknown>) => {
      const frames = Array.isArray((exception.stacktrace as { frames?: unknown[] } | undefined)?.frames) ? (exception.stacktrace as { frames: unknown[] }).frames.slice(-30).flatMap((rawFrame: unknown) => {
        if (!rawFrame || typeof rawFrame !== "object") return [];
        const frame = rawFrame as Record<string, unknown>;
        if (typeof frame.filename !== "string") return [];
        let pathname: string;
        try { pathname = new URL(frame.filename, "https://opengravel.invalid").pathname; } catch { return []; }
        if (!/^\/_next\/static\/[a-zA-Z0-9_./-]+\.js$/.test(pathname)) return [];
        const safe: Record<string, unknown> = { filename: pathname };
        for (const key of ["lineno", "colno"]) if (typeof frame[key] === "number") safe[key] = frame[key];
        if (typeof frame.function === "string" && /^[a-zA-Z_$][a-zA-Z0-9_$.[\]<> -]{0,100}$/.test(frame.function)) safe.function = frame.function;
        return [safe];
      }) : [];
      return { type: ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(String(exception.type)) ? exception.type : "Error", value: "Unhandled browser error (details excluded by privacy policy)", mechanism: { type: "generic", handled: false }, stacktrace: { frames } };
    });
  }
  return { uuid: event.uuid, event: event.event, properties, ...(event.timestamp instanceof Date ? { timestamp: event.timestamp } : {}) };
}

export interface PostHogPolicyOptions {
  /** True once the rider acknowledged: only then may more than a page visit leave the browser. */
  readonly full?: () => boolean;
  /** Keep an anonymous visitor id in localStorage (no cookie) so unique visitors can be counted. */
  readonly persistent?: boolean;
}

export function postHogConfig(host: string, build: TelemetryBuildCorrelation, allowed: () => boolean, policy: PostHogPolicyOptions = {}): Partial<PostHogConfig> {
  const full = policy.full ?? allowed;
  return {
    api_host: host,
    persistence: policy.persistent === true ? "localStorage" : "memory",
    person_profiles: "never",
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: { dom_event_allowlist: ["click", "change", "submit"], capture_copied_text: false, css_selector_ignorelist: [".ph-no-capture", ".ph-no-autocapture", "[data-ph-no-autocapture]", 'input[type="file"]', 'input[type="hidden"]'] },
    capture_exceptions: { capture_unhandled_errors: true, capture_unhandled_rejections: true, capture_console_errors: false },
    capture_dead_clicks: true,
    rageclick: true,
    disable_surveys: true,
    advanced_disable_feature_flags: true,
    enable_recording_console_log: false,
    capture_performance: false,
    session_recording: { maskAllInputs: true, maskTextSelector: "*", maskAllElementAttributes: false, maskAttributeFn: (name, value) => {
      if (name === "class" && value.split(/\s+/).every(token => /^(og-|maplibregl-|ph-)[a-z_-]+$/.test(token))) return value;
      if (name === "type" && ["button", "checkbox", "radio", "submit", "text"].includes(value)) return value;
      return "[masked]";
    }, blockSelector: '.ph-no-capture, input[type="file"], input[type="hidden"], [data-telemetry-sensitive]', recordHeaders: false, recordBody: false, captureCanvas: { recordCanvas: false }, maskCapturedNetworkRequestFn: () => null },
    before_send: (event) => {
      if (!allowed()) return null;
      // Before acknowledgement only the anonymous page visit is counted.
      if (!full() && event?.event !== "$pageview") return null;
      return sanitizePostHogEvent(event, build);
    },
  };
}
