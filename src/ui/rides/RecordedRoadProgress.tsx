"use client";

import { formatDistance } from "@/application/planner/measurements";
import type { RoadProgressProjection } from "@/application/roads/explorable-roads";

export type RecordedRoadProgressState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly projection: RoadProgressProjection };

export interface RecordedRoadProgressProps {
  readonly state: RecordedRoadProgressState;
}

export function RecordedRoadProgress({ state }: RecordedRoadProgressProps) {
  if (state.status === "loading") {
    return <p className="og-library__progress" data-testid="recorded-road-progress">Reading mapped road progress…</p>;
  }
  if (state.status === "error") {
    return <p className="og-library__reason" data-testid="recorded-road-progress">Mapped road progress is unavailable right now.</p>;
  }

  const { projection } = state;
  if (projection.coverage === "unknown") {
    return (
      <section className="og-library__progress" data-testid="recorded-road-progress" aria-label="Recorded road progress">
        <strong>Mapped good-road progress</strong>
        <p>Unknown for this area. The mapped good-road catalogue did not provide usable coverage.</p>
      </section>
    );
  }

  return (
    <section className="og-library__progress" data-testid="recorded-road-progress" aria-label="Recorded road progress">
      <strong>Mapped good-road progress</strong>
      <p>Ridden on mapped good roads: {formatDistance(projection.qualifiedMeters)}.</p>
      <p>
        New-to-you: {projection.newToYouMeters === null ? "Unknown" : `${formatDistance(projection.newToYouMeters)} estimated`}.
      </p>
      <p>Partial catalogue coverage; this estimate does not classify unmapped roads.</p>
    </section>
  );
}
