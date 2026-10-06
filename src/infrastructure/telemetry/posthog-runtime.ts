import { postHogConfig } from "@/infrastructure/telemetry/posthog-policy";
import type { PostHog } from "posthog-js";
import { TELEMETRY_CONSENT_POLICY_VERSION, type TelemetryConsentState, type TelemetryMode } from "@/application/telemetry/consent";
import type { TelemetryBuildCorrelation } from "@/application/telemetry/events";
import type { TelemetryTransport } from "@/application/telemetry/ports/telemetry-transport";
export interface PostHogRuntimeOptions {
 readonly mode: TelemetryMode;
 readonly projectToken?: string | undefined;
 readonly host?: string | undefined;
 readonly build: TelemetryBuildCorrelation;
 readonly consent: () => TelemetryConsentState;
 readonly load?: () => Promise<PostHog>;
 readonly eligible?: () => boolean;
}
/** Optional browser integration; no provider or ride-state ownership. */
export function createPostHogRuntime(options: PostHogRuntimeOptions): { sync(): Promise<void>; transport: TelemetryTransport; stop(): void; pageview(page: string): void } {
 let sdk: PostHog | null = null;
 let active = false;
 let epoch = 0;
 let pending: Promise<void> | null = null;
 const host = options.host?.replace(/\/$/, "");
 let recording = false;
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
 const stop = (): void => {
   epoch++;
   active = false;
   recording = false;
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
       const loaded = sdk ?? await (options.load ?? (async () => (await import("posthog-js")).default))();
       if (loadingEpoch !== epoch || !allowed()) return;
       if (sdk === null) {
         sdk = loaded;
         const config = postHogConfig(host!, options.build, () => active && allowed(), { full: () => active && full(), persistent: true });
         sdk.init(options.projectToken!, config);
         // init() is a no-op for an existing browser singleton (e.g. remount).
         // Refresh the privacy callback instead of retaining a disposed closure.
         sdk.set_config(config);
       }
       active = true;
       sdk.opt_in_capturing({ captureEventName: false });
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
     try { if (active && allowed()) sdk?.capture("$pageview", { page }); } catch { /* Optional. */ }
   },
   transport: { send(envelope): void {
     try { if (active && full()) sdk?.capture(envelope.name, envelope.properties); } catch { /* Optional. */ }
   } },
 };
}
