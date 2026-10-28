"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sunriseOnDepartureDay, sunsetOnDepartureDay } from "@/application/long-trip";
import { proportionalEtaProfile, splitRouteByDaylight } from "@/application/map/route-daylight";
import { routeLineMeters } from "@/application/weather/route-weather";
import type { RideDocument } from "@/domain/ride/types";
import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";
import { ConditionsPill } from "@/ui/place/ConditionsPill";
import { useRouteWeather } from "@/ui/weather/useRouteWeather";
import { MapAdvisorAsk } from "./RideAdvisor";
import { usePlannerDaylight } from "./hooks/usePlannerDaylight";
import type { PlannerActiveRoute } from "./hooks/usePlannerActiveRoute";

const miles = (meters: number): number => {
  const value = meters / 1609.344;
  return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
};
const clock = (instant: string | number): string => new Date(instant).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function RouteContext({ route, intent }: { readonly route: PlannerActiveRoute; readonly intent: RideDocument["intent"] }) {
  const [open, setOpen] = useState(false);
  const departure = usePlannerDaylight({ departure: intent.departure, time: intent.time, durationSeconds: route.durationSeconds });
  const arrival = departure.departureAt === null ? null : Date.parse(departure.departureAt) + route.durationSeconds * 1000;
  const daylight = useMemo(() => {
    if (departure.departureAt === null || arrival === null || !Number.isFinite(arrival)) return null;
    const end = route.geometry.at(-1);
    const profile = proportionalEtaProfile(route.geometry, route.durationSeconds);
    if (end === undefined || profile === null) return null;
    const split = splitRouteByDaylight(route.geometry, profile, departure.departureAt);
    if (split.outcome === "unknown") return null;
    const sunset = sunsetOnDepartureDay(end, new Date(arrival).toISOString())?.sunset ?? null;
    if (sunset === null) return null;
    const difference = Math.round((arrival - Date.parse(sunset)) / 60000);
    const start = route.geometry[0];
    const sunrise = start === undefined ? null : sunriseOnDepartureDay(start, departure.departureAt);
    const beforeDawn = sunrise !== null && Date.parse(departure.departureAt) < Date.parse(sunrise);
    const endSunrise = sunriseOnDepartureDay(end, new Date(arrival).toISOString());
    const arrivesBeforeDawn = endSunrise !== null && arrival < Date.parse(endSunrise);
    return { split, sunset: split.sunsetIso ?? sunset, difference, beforeDawn, arrivesBeforeDawn, darkMiles: miles(routeLineMeters(split.afterSunset)) };
  }, [route, departure.departureAt, arrival]);
  const lightLabel = daylight === null ? null : daylight.arrivesBeforeDawn ? "arrive before sunrise" : daylight.difference === 0 ? "arrive around sunset" : `${duration(Math.abs(daylight.difference) * 60)} ${daylight.difference < 0 ? "before" : "after"} dark`;
  return <>
    <div className="og-route-context-row" data-testid="route-context-row">
      <button className="og-route-context" type="button" data-testid="route-context" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span>{miles(route.distanceMeters)} mi · {duration(route.durationSeconds)}{arrival === null || !Number.isFinite(arrival) ? "" : ` · arrive ${clock(arrival)}`}{lightLabel === null ? "" : ` · ${lightLabel}`}</span><span aria-hidden="true">›</span>
      </button>
      <MapAdvisorAsk />
    </div>
    {open && typeof document !== "undefined" ? createPortal(<ConditionsSheet route={route} departureAt={departure.departureAt} daylight={daylight} lightLabel={lightLabel} onClose={() => setOpen(false)} />, document.body) : null}
  </>;
}

function ConditionsSheet({ route, departureAt, daylight, lightLabel, onClose }: {
  readonly route: PlannerActiveRoute;
  readonly departureAt: string | null;
  readonly daylight: { readonly split: ReturnType<typeof splitRouteByDaylight>; readonly sunset: string; readonly difference: number; readonly beforeDawn: boolean; readonly arrivesBeforeDawn: boolean; readonly darkMiles: number } | null;
  readonly lightLabel: string | null;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, onClose);
  const weather = useRouteWeather({ line: route.geometry, departureTime: departureAt, durationSeconds: route.durationSeconds });
  const start = route.geometry[0];
  return <div className="og-route-conditions-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="route-conditions-title" className="og-route-conditions" data-testid="route-conditions">
      <header className="og-route-conditions__header"><div><p>YOUR RIDE</p><h2 id="route-conditions-title">Ride conditions</h2></div><button type="button" onClick={onClose} aria-label="Close ride conditions">×</button></header>
      <div className="og-route-conditions__body">
        <section className="og-route-conditions__section"><h3>Daylight</h3>{daylight === null ? <p>Daylight along this route is unavailable.</p> : <><strong>Sunset {clock(daylight.sunset)}</strong><p>{lightLabel} · {daylight.beforeDawn ? "The sunset split does not include darkness before sunrise" : daylight.split.outcome === "all-daylight" ? "The whole route before sunset" : daylight.split.outcome === "after-dark" ? "The whole route after sunset" : `About ${daylight.darkMiles} mi after sunset`}</p></>}</section>
        <section className="og-route-conditions__section"><h3>Weather along the route</h3>{weather.status === "ready" ? <><strong>{weather.report.headline}</strong><div className="og-route-conditions__samples" aria-label="Forecast samples along the route">{weather.report.samples.map((sample, index) => <div key={index}><span>{index === 0 ? "Start" : `mi ${sample.mile}`}</span><b>{sample.tempF === null ? "–" : `${sample.tempF}°`}</b><span>{sample.rainChancePct === null ? "Rain –" : `Rain ${sample.rainChancePct}%`}</span><span>{sample.windMph === null ? "Wind –" : `Wind ${sample.windMph} mph`}</span></div>)}</div><p className="og-route-conditions__source">Forecast at estimated arrival times · National Weather Service</p></> : <p>{weather.status === "loading" ? "Checking the forecast along your route…" : "Weather along the route is unavailable right now."}</p>}</section>
        {start === undefined ? null : <section className="og-route-conditions__section og-route-conditions__here"><h3>Conditions at the start</h3><ConditionsPill at={start} embedded /></section>}
      </div>
    </section>
  </div>;
}
