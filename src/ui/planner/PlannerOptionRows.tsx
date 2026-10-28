"use client";

import Link from "next/link";

export type PlannerOption = "style" | "surface" | "time" | "traffic" | "stops" | "areas" | "roads" | "sketch";

type Values = Readonly<Record<PlannerOption, string>>;

export function PlannerOptionRows({ values, hasRoute, onSelect, onBreadcrumb }: {
  readonly values: Values;
  readonly hasRoute: boolean;
  readonly onSelect: (option: PlannerOption) => void;
  readonly onBreadcrumb?: (() => void) | undefined;
}) {
  const rows: readonly [PlannerOption, string][] = [
    ["style", "Ride style and lenses"], ["surface", "Surface"], ["time", "Time, loop and sunset"],
    ["traffic", "Traffic and tolls"], ["stops", "Stops"], ["areas", "Avoid areas"],
    ["roads", "Road spans"], ["sketch", "Draw route"],
  ];
  return <div className="og-option-rows" aria-label="Route settings">
    {rows.map(([key, label]) => <button className="og-option-rows__row" type="button" key={key}
      disabled={key === "roads" && !hasRoute} onClick={() => onSelect(key)}>
      <span>{label}</span><span>{key === "roads" && !hasRoute ? "Plan a route first" : values[key]} <span aria-hidden="true">›</span></span>
    </button>)}
    <Link className="og-option-rows__row" href="/settings#settings-bikes-title"><span>Bike</span><span>Garage ›</span></Link>
    {onBreadcrumb === undefined ? null : <button className="og-option-rows__row" type="button" onClick={onBreadcrumb}><span>Breadcrumb</span><span>Place waypoints ›</span></button>}
  </div>;
}
