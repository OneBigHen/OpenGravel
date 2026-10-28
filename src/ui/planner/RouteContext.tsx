"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sunriseOnDepartureDay, sunsetOnDepartureDay } from "@/application/long-trip";
import { proportionalEtaProfile, splitRouteByDaylight } from "@/application/map/route-daylight";
import { routeLineMeters } from "@/application/weather/route-weather";
import type { RideDocument } from "@/domain/ride/types";
import { useActivityMode } from "@/ui/stores/activity-mode";
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
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} m`;
}

/** A hike's numbers live in its summary; the ride context bar (daylight at road pace) steps aside. */
export function RouteContext(props: { readonly route: PlannerActiveRoute; readonly intent: RideDocument["intent"] }) {
  const activity = useActivityMode();
  return activity === "hike" ? null : <RideRouteContext {...props} />;
}

function RideRouteContext({ route, intent }: { readonly route: PlannerActiveRoute; readonly intent: RideDocument["intent"] }) {
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
    const totalMeters = routeLineMeters(route.geometry);
    const darkSeconds = totalMeters > 0 ? route.durationSeconds * routeLineMeters(split.afterSunset) / totalMeters : 0;
    return { split, sunset: split.sunsetIso ?? sunset, difference, beforeDawn, arrivesBeforeDawn, sunrise: endSunrise, darkSeconds };
  }, [route, departure.departureAt, arrival]);
  const lightLabel = daylight === null ? null : daylight.arrivesBeforeDawn ? "arrive before sunrise" : daylight.difference === 0 ? "arrive around sunset" : `${duration(Math.abs(daylight.difference) * 60)} ${daylight.difference < 0 ? "before" : "after"} dark`;
  return <>
    <div className="og-route-context-row" data-testid="route-context-row">
      <ContextLine distance={`${miles(route.distanceMeters)} mi`} durationLabel={duration(route.durationSeconds)} arrival={arrival === null || !Number.isFinite(arrival) ? null : clock(arrival)} daylight={lightLabel} onOpen={() => setOpen(true)} />
      <MapAdvisorAsk />
    </div>
    {open && typeof document !== "undefined" ? createPortal(<ConditionsSheet route={route} departureAt={departure.departureAt} daylight={daylight} lightLabel={lightLabel} onClose={() => setOpen(false)} />, document.body) : null}
  </>;
}

/** Fit whole facts to the available width; never clip a word or the Ask control. */
function ContextLine({ distance, durationLabel, arrival, daylight, onOpen }: {
  readonly distance: string; readonly durationLabel: string; readonly arrival: string | null;
  readonly daylight: string | null; readonly onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState(`${distance} · ${durationLabel}`);
  const base = `${distance} · ${durationLabel}`;
  const withArrival = arrival === null ? base : `${base} · arrive ${arrival}`;
  const full = daylight === null ? withArrival : `${withArrival} · ${daylight}`;
  const lightWord = daylight === null ? null : daylight.includes("before sunrise") ? "before sunrise" : daylight.includes("before dark") ? "before dark" : daylight.includes("after dark") ? "after dark" : daylight;
  const shortLight = lightWord === null ? withArrival : `${withArrival} · ${lightWord}`;
  // On a narrow phone the arrival time goes before the daylight: being out after
  // dark is the fact a rider cannot afford to lose.
  const baseLight = lightWord === null ? base : `${base} · ${lightWord}`;
  useEffect(() => {
    const button = ref.current;
    if (button === null) return;
    const measure = (): void => {
      const context = document.createElement("canvas").getContext("2d");
      if (context === null) return;
      const style = getComputedStyle(button);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const available = button.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 20;
      setText([full, shortLight, baseLight, withArrival, base, distance].find((candidate) => context.measureText(candidate).width <= available) ?? distance);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(button);
    void document.fonts.ready.then(measure);
    measure();
    return () => observer.disconnect();
  }, [base, baseLight, distance, full, shortLight, withArrival]);
  return <button ref={ref} className="og-route-context" type="button" data-testid="route-context" aria-label={full} aria-haspopup="dialog" onClick={onOpen}><span>{text}</span><span aria-hidden="true">›</span></button>;
}

function ConditionsSheet({ route, departureAt, daylight, lightLabel, onClose }: {
  readonly route: PlannerActiveRoute;
  readonly departureAt: string | null;
  readonly daylight: { readonly split: ReturnType<typeof splitRouteByDaylight>; readonly sunset: string; readonly difference: number; readonly beforeDawn: boolean; readonly arrivesBeforeDawn: boolean; readonly sunrise: string | null; readonly darkSeconds: number } | null;
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
        <section className="og-route-conditions__section"><h3>Daylight</h3>{daylight === null ? <p>Daylight along this route is unavailable.</p> : <><strong>{daylight.arrivesBeforeDawn ? "In the dark the whole way" : daylight.beforeDawn ? "The ride begins before sunrise" : daylight.split.outcome === "after-dark" ? "In the dark the whole way" : `Sunset ${clock(daylight.sunset)}`}</strong><p>{daylight.arrivesBeforeDawn && daylight.sunrise !== null ? `Sunrise ${clock(daylight.sunrise)}` : daylight.beforeDawn && daylight.sunrise !== null ? `Sunrise ${clock(daylight.sunrise)}` : daylight.split.outcome === "crosses-sunset" ? `Last ${duration(daylight.darkSeconds)} after dark` : daylight.split.outcome === "after-dark" ? `Sunset ${clock(daylight.sunset)}` : lightLabel === null ? null : `Arrive ${lightLabel}`}</p></>}</section>
        <section className="og-route-conditions__section"><h3>Weather along the route</h3>{weather.status === "ready" ? <><strong>{weather.report.headline}</strong><div className="og-route-conditions__samples" aria-label="Forecast samples along the route">{weather.report.samples.map((sample, index) => <div key={index}><span>{index === 0 ? "Start" : `mi ${sample.mile}`}</span><b>{sample.tempF === null ? "–" : `${sample.tempF}°`}</b><span>{sample.rainChancePct === null ? "Rain –" : `Rain ${sample.rainChancePct}%`}</span><span>{sample.windMph === null ? "Wind –" : `Wind ${sample.windMph} mph`}</span></div>)}</div><p className="og-route-conditions__source">Forecast at estimated arrival times · National Weather Service</p></> : <p>{weather.status === "loading" ? "Checking the forecast along your route…" : "Weather along the route is unavailable right now."}</p>}</section>
        {start === undefined ? null : <section className="og-route-conditions__section og-route-conditions__here"><h3>Conditions at the start</h3><ConditionsPill at={start} embedded /></section>}
      </div>
    </section>
  </div>;
}
