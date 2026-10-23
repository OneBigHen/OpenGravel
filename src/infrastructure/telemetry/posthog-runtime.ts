import { postHogConfig } from "@/infrastructure/telemetry/posthog-policy";
import { scheduleAfterInteractive, type TelemetryIdleScheduler } from "@/infrastructure/telemetry/idle-scheduler";
import type { PostHog } from "posthog-js";
import { TELEMETRY_CONSENT_POLICY_VERSION, type TelemetryConsentState, type TelemetryMode } from "@/application/telemetry/consent";
import type { TelemetryBuildCorrelation, TelemetryEnvelope } from "@/application/telemetry/events";
import type { TelemetryTransport } from "@/application/telemetry/ports/telemetry-transport";
export interface PostHogRuntimeOptions {
 readonly mode: TelemetryMode;
 readonly projectToken?: string | undefined;
 readonly host?: string | undefined;
 readonly build: TelemetryBuildCorrelation;
 readonly consent: () => TelemetryConsentState;
 readonly load?: () => Promise<PostHog>;
 readonly eligible?: () => boolean;
 /**
  * Defers the first SDK import until the page is interactive. Injectable so
  * tests can drive the idle moment deterministically.
  */
 readonly schedule?: TelemetryIdleScheduler;
 /** Upper bound on events held while the deferred SDK import is in flight. */
 readonly queueLimit?: number;
}
type QueuedItem =
  | { readonly kind: "pageview"; readonly page: string }
  | { readonly kind: "event"; readonly envelope: TelemetryEnvelope };
/** Optional browser integration; no provider or ride-state ownership. */
export function createPostHogRuntime(options: PostHogRuntimeOptions): { sync(): Promise<void>; transport: TelemetryTransport; stop(): void; pageview(page: string): void } {
 let sdk: PostHog | null = null;
 let active = false;
 let epoch = 0;
 let pending: Promise<void> | null = null;
 const host = options.host?.replace(/\/$/, "");
 let recording = false;
 const schedule = options.schedule ?? scheduleAfterInteractive;
 const queueLimit = Math.max(1, options.queueLimit ?? 20);
 /** Events captured before the deferred import finishes; flushed on activation. */
 let queued: QueuedItem[] = [];
 let cancelScheduled: (() => void) | null = null;
 /** Visitor tier: anonymous page-visit counting needs no acknowledgement. */
 const allowed = (): boolean => {
   try {
     return (options.eligible?.() ?? true) && options.mode === "hosted-beta" && !!options.projectToken?.startsWith("phc_") && !!host && ["https://us.i.posthog.com", "https://eu.i.posthog.com"].includes(host);
   } catch { return false; }
 };
 /** Full tier: actions, errors and replay still require the acknowledgement. */
 const full = (): boolean => {
   try {
     const consent = options.consent();
     return allowed() && consent.status === "acknowledged" && consent.policyVersion === TELEMETRY_CONSENT_POLICY_VERSION;
   } catch { return false; }
 };
 /** True while an idle-scheduled import exists but has not finished. */
 const awaitingImport = (): boolean => pending !== null || cancelScheduled !== null;
 /** Bounded so a long-idle tab cannot grow an unbounded pre-load buffer. */
 const enqueue = (item: QueuedItem): void => {
   queued.push(item);
   if (queued.length > queueLimit) queued.shift();
 };
 /** Re-checks the tier at flush time: consent may have changed while queued. */
 const flush = (): void => {
   const items = queued;
   queued = [];
   for (const item of items) {
     try {
       if (item.kind === "pageview") { if (allowed()) sdk?.capture("$pageview", { page: item.page }); }
       else if (full()) sdk?.capture(item.envelope.name, item.envelope.properties);
     } catch { /* Telemetry cannot interrupt the application. */ }
   }
 };
 const stop = (): void => {
   epoch++;
   active = false;
   recording = false;
   queued = [];
   try { cancelScheduled?.(); } catch { /* Telemetry cannot interrupt the application. */ }
   cancelScheduled = null;
   try {
     sdk?.stopSessionRecording();
     sdk?.opt_out_capturing();
     sdk?.reset();
   } catch { /* Telemetry cannot interrupt the application. */ }
 };
 const syncRecording = (): void => {
   try {
     if (full() && !recording) { sdk?.startSessionRecording(); recording = true; }
     else if (!full() && recording) { sdk?.stopSessionRecording(); recording = false; }
   } catch { /* Telemetry cannot interrupt the application. */ }
 };
 /** Resolves true once the idle scheduler runs, false if `stop()` cancelled it. */
 const waitForInteractive = (): Promise<boolean> => new Promise<boolean>((resolve) => {
   let settled = false;
   let cancel: (() => void) | null = null;
   const settle = (interactive: boolean): void => {
     if (settled) return;
     settled = true;
     cancelScheduled = null;
     resolve(interactive);
   };
   try {
     cancel = schedule(() => settle(true));
   } catch {
     settle(true);
     return;
   }
   if (settled) return;
   cancelScheduled = () => {
     try { cancel?.(); } finally { settle(false); }
   };
 });
 const sync = async (): Promise<void> => {
   if (!allowed()) { stop(); return; }
   if (active) { syncRecording(); return; }
   if (pending !== null) {
     await pending;
     if (!active && allowed()) await sync();
     return;
   }
   const loadingEpoch = epoch;
   pending = (async () => {
     try {
       // The SDK chunk and the recorder are deferred until the page is interactive.
       if (!await waitForInteractive()) return;
       if (loadingEpoch !== epoch || !allowed()) return;
       const loaded = sdk ?? await (options.load ?? (async () => (await import("posthog-js")).default))();
       if (loadingEpoch !== epoch || !allowed()) return;
       if (sdk === null) {
         sdk = loaded;
         // `disable_session_recording` is on in the config, so init never starts replay.
         const config = postHogConfig(host!, options.build, () => active && allowed(), { full: () => active && full(), persistent: true });
         sdk.init(options.projectToken!, config);
         // init() is a no-op for an existing browser singleton (e.g. remount).
         // Refresh the privacy callback instead of retaining a disposed closure.
         sdk.set_config(config);
       }
       active = true;
       sdk.opt_in_capturing({ captureEventName: false });
       flush();
       // Replay starts only here: after idle and after the full-tier consent gate.
       syncRecording();
     } catch { active = false; }
   })();
   await pending;
   pending = null;
 };
 return {
   sync,
   stop,
   pageview(page): void {
     try {
       if (active) { if (allowed()) sdk?.capture("$pageview", { page }); }
       else if (allowed() && awaitingImport()) enqueue({ kind: "pageview", page });
     } catch { /* Optional. */ }
   },
   transport: { send(envelope): void {
     try {
       if (active) { if (full()) sdk?.capture(envelope.name, envelope.properties); }
       else if (full() && awaitingImport()) enqueue({ kind: "event", envelope });
     } catch { /* Optional. */ }
   } },
 };
}
