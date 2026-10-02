import type { RoadOpeningCertainty } from "./opening-calendar";

export interface RoadOpeningSummary {
  readonly id: string;
  readonly sourceId: string;
  readonly roadName: string | null;
  readonly description: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly certainty: RoadOpeningCertainty;
  readonly anchor: readonly [number, number] | null;
}

export interface UndatedSeasonalRoadSummary {
  readonly id: string;
  readonly sourceId: string;
  readonly roadName: string | null;
  readonly description: string;
  readonly anchor: readonly [number, number] | null;
}

export interface RoadOpeningsBody {
  readonly generatedAt: string;
  readonly from: string;
  readonly to: string;
  readonly events: readonly RoadOpeningSummary[];
  readonly undated: readonly UndatedSeasonalRoadSummary[];
  readonly truncated: boolean;
  readonly sources: readonly {
    readonly id: string;
    readonly label: string;
    readonly status: "fresh" | "stale" | "unavailable";
    readonly reason: string | null;
  }[];
}

export interface RoadOpeningsUnavailableBody {
  readonly unavailable: true;
  readonly reason: string;
}
