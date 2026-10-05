"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { TelemetryBuildCorrelation } from "@/application/telemetry/events";
import { createTelemetryService } from "@/application/telemetry/telemetry-service";
import type { TelemetryMode } from "@/application/telemetry/consent";
import { TELEMETRY_INTENT_EVENT, type BrowserTelemetryIntent } from "@/infrastructure/telemetry/browser-event-bridge";
import { createPostHogRuntime } from "@/infrastructure/telemetry/posthog-runtime";
import { createLocalStorageTelemetryConsentStore, TELEMETRY_CONSENT_CHANGED_EVENT } from "@/infrastructure/telemetry/local-storage-consent-store";

/** Hosted observability is composed here; never in the planner component. */
export function TelemetryClient({ build, mode }: { readonly build: TelemetryBuildCorrelation; readonly mode: TelemetryMode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  useEffect(() => {
    window.dispatchEvent(new Event("opengravel:telemetry-page-changed"));
  }, [pathname, search]);
  useEffect(() => {
    const consentStore = createLocalStorageTelemetryConsentStore();
    let withdrawnInThisTab = false;
    const readConsent = () => {
      if (withdrawnInThisTab) return { status: "unacknowledged" as const };
      const read = consentStore.read();
      return read.status === "found" ? read.state : { status: "unacknowledged" as const };
    };
    // Private share/account routes and token-bearing URLs never load the SDK.
    const safePage = () => ["/", "/settings", "/explore", "/rides", "/ride"].includes(window.location.pathname) && window.location.search === "" && window.location.hash === "";
    const runtime = createPostHogRuntime({
      mode,
      eligible: safePage,
      projectToken: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      build,
      consent: readConsent,
    });
    const service = createTelemetryService({ mode, transport: runtime.transport, consentStore, build });
    const receiveIntent = (event: Event) => {
      const intent = (event as CustomEvent<BrowserTelemetryIntent>).detail;
      if (intent && typeof intent.name === "string") service.track(intent.name, intent.properties);
    };
    window.addEventListener(TELEMETRY_INTENT_EVENT, receiveIntent);
    let disposed = false;
    const sync = () => {
      void runtime.sync().then(() => {
        if (disposed || !safePage()) return;
        const page = window.location.pathname === "/" ? "planner" : window.location.pathname.slice(1);
        runtime.pageview(page);
        if (page === "planner") service.track("planner_opened");
      });
    };
    const consentChanged = (event: Event) => {
      withdrawnInThisTab = (event as CustomEvent).detail?.status !== "acknowledged";
      sync();
    };
    sync();
    window.addEventListener("opengravel:telemetry-page-changed", sync);
    window.addEventListener("storage", sync);
    window.addEventListener(TELEMETRY_CONSENT_CHANGED_EVENT, consentChanged);
    return () => {
      disposed = true;
      window.removeEventListener(TELEMETRY_INTENT_EVENT, receiveIntent);
      window.removeEventListener("opengravel:telemetry-page-changed", sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener(TELEMETRY_CONSENT_CHANGED_EVENT, consentChanged);
      runtime.stop();
    };
  }, [build, mode]);
  return null;
}
