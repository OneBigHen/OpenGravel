/** Measurements of the routed hiking line; access approaches are never geometry. */
export interface HikeRouteSummary {
  readonly gainMeters: number | null;
  readonly lossMeters: number | null;
  readonly elevationMeasuredShare: number;
  readonly timeMethod: "Tobler";
  readonly roadMeters: number | null;
  readonly snapMeters: readonly number[];
}
