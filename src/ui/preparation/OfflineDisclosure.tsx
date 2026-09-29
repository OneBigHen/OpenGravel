"use client";

import type {
  CapabilityMatrix,
  OfflineCapability,
  RouteReadiness,
} from "@/domain/offline/capabilities";

export interface OfflineDisclosureProps {
  readonly matrix: CapabilityMatrix;
  readonly readiness: RouteReadiness | null;
  readonly packPresence?: "present" | "not-present" | "unknown";
}

const LABELS: Readonly<Record<OfflineCapability, string>> = {
  "plan.route": "Plan a route",
  "plan.replan": "Replan offline",
  "nav.guidance": "Guidance",
  "nav.reroute": "Reroute",
  "explore.browse": "Explore browse",
  "library.read": "Read saved rides",
  "weather.live": "Live weather",
  "traffic.live": "Live traffic",
  "import.export": "Import and export",
};

function stateLabel(state: CapabilityMatrix[OfflineCapability]["state"]): string {
  switch (state) {
    case "available":
      return "Available";
    case "degraded":
      return "Degraded";
    case "requires_network":
      return "Needs network";
  }
}

function readinessLabel(readiness: RouteReadiness): string {
  switch (readiness.state) {
    case "ready":
      return "Ready";
    case "degraded":
      return "Degraded";
    case "not_ready":
      return "Not ready";
  }
}

export function OfflineDisclosure({ matrix, readiness, packPresence }: OfflineDisclosureProps) {
  return (
    <section className="og-offline" aria-labelledby="offline-disclosure-title" data-testid="offline-disclosure">
      <div className="og-offline__head">
        <div>
          <p className="og-eyebrow">Offline</p>
          <h2 id="offline-disclosure-title">Offline capability</h2>
        </div>
        {packPresence === undefined ? null : (
          <span className="og-offline__pack" data-testid="offline-pack-presence">
            {packPresence === "present" ? "Corridor pack saved" : packPresence === "unknown" ? "Corridor pack unknown" : "No corridor pack saved"}
          </span>
        )}
      </div>

      {readiness === null ? (
        <p className="og-offline__readiness" data-testid="offline-route-readiness">
          Route readiness: no selected route is available to check.
        </p>
      ) : (
        <div className="og-offline__readiness" data-testid="offline-route-readiness">
          <strong>{`Route corridor: ${readiness.coveragePercent}% cached · ${readinessLabel(readiness)}`}</strong>
          {readiness.reasons.length > 0 ? (
            <ul aria-label="Offline route gaps">
              {readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          ) : null}
        </div>
      )}

      <dl className="og-offline__list" aria-label="Offline capability matrix">
        {Object.entries(matrix).map(([capability, entry]) => {
          const typedCapability = capability as OfflineCapability;
          return (
            <div className="og-offline__row" key={typedCapability}>
              <dt>{LABELS[typedCapability]}</dt>
              <dd>
                <span
                  className="og-offline__state"
                  data-state={entry.state}
                  data-testid={`offline-state-${typedCapability}`}
                >
                  {stateLabel(entry.state)}
                </span>
                {entry.reason === undefined ? null : <span className="og-offline__reason">{entry.reason}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
