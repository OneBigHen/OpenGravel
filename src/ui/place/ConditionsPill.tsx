"use client";

/**
 * Live riding conditions where the map is: temperature and sky in the search
 * bar, with the one thing a rider should know next (an alert, rain coming,
 * dark coming, strong wind). A tap opens the next hours. NWS via our own
 * /api/weather (free, cached server-side); nothing shows when it is unavailable.
 */

import { useEffect, useRef, useState } from "react";

import { calculateSunrise, calculateSunset, sunState } from "@/application/long-trip/daylight";
import type { WeatherForecastPeriod, WeatherSnapshot } from "@/application/preparation/providers";
import type { Coordinate } from "@/domain/ride/types";

type Sky = "clear" | "partly" | "cloudy" | "rain" | "storm" | "snow" | "fog";

function skyOf(text: string): Sky {
  const t = text.toLowerCase();
  if (/thunder|t-storm/.test(t)) return "storm";
  if (/snow|sleet|flurr|ice/.test(t)) return "snow";
  if (/rain|shower|drizzle/.test(t)) return "rain";
  if (/fog|haze|smoke|mist/.test(t)) return "fog";
  if (/partly|mostly sunny|mostly clear|few clouds/.test(t)) return "partly";
  if (/cloud|overcast/.test(t)) return "cloudy";
  return "clear";
}

function SkyGlyph({ sky, night }: { readonly sky: Sky; readonly night: boolean }) {
  const sun = night
    ? <path d="M15.5 4.5a6 6 0 1 0 4 10.4A7 7 0 0 1 15.5 4.5Z" className="og-conditions__sun" />
    : <><circle cx="10" cy="9" r="3.6" className="og-conditions__sun" /><path d="M10 2.5v1.5M3.5 9H5M5.4 4.4l1 1M14.6 4.4l-1 1" className="og-conditions__sun" /></>;
  const cloud = <path d="M8 19a3.6 3.6 0 1 1 .9-7.1A4.6 4.6 0 0 1 17.6 12.6 3.2 3.2 0 1 1 17.5 19Z" />;
  return (
    <svg className="og-conditions__glyph" data-sky={sky} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {sky === "clear" ? (night ? <path d="M15 4a7.5 7.5 0 1 0 5 13A8.5 8.5 0 0 1 15 4Z" className="og-conditions__sun" /> : <><circle cx="12" cy="12" r="4.2" className="og-conditions__sun" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" className="og-conditions__sun" /></>) : null}
      {sky === "partly" ? <>{sun}{cloud}</> : null}
      {sky === "cloudy" || sky === "fog" ? cloud : null}
      {sky === "fog" ? <path d="M5 22h14" /> : null}
      {sky === "rain" ? <>{cloud}<path d="M9 21.5l-.5 1M13 21.5l-.5 1" className="og-conditions__rain" /></> : null}
      {sky === "storm" ? <>{cloud}<path d="m12.5 15-2 3.5h3l-2 3.5" className="og-conditions__bolt" /></> : null}
      {sky === "snow" ? <>{cloud}<path d="M9 22h.01M13 22h.01M16 22h.01" /></> : null}
    </svg>
  );
}

/** Midday UTC on the observer's own (solar-local) calendar day, `days` ahead. */
function localNoon(lon: number, now: number, days = 0): string {
  const local = new Date(now + (lon / 15) * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, 12)).toISOString();
}

function clock(iso: string | number): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function hourLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric" });
}

/** The one thing to know next, most urgent first. */
function headsUp(snapshot: WeatherSnapshot, upcoming: readonly WeatherForecastPeriod[], sunsetMs: number | null, now: number, day: boolean): { readonly text: string; readonly tone: "alert" | "warn" | "info" } | null {
  const alert = snapshot.alerts[0];
  if (alert !== undefined) return { text: alert.event, tone: "alert" };
  const wet = upcoming.find((period) => period.precipChance !== null && period.precipChance !== undefined && period.precipChance >= 50);
  if (wet !== undefined) {
    const sky = skyOf(wet.shortForecast);
    return { text: `${sky === "snow" ? "Snow" : sky === "storm" ? "Storms" : "Rain"} ${Date.parse(wet.startTime) <= now ? "now" : hourLabel(wet.startTime)}`, tone: "warn" };
  }
  if (day && sunsetMs !== null && sunsetMs > now && sunsetMs - now <= 3 * 3_600_000) {
    return { text: `Dark ${clock(sunsetMs)}`, tone: "info" };
  }
  const windy = upcoming.slice(0, 3).find((period) => (period.windMph ?? 0) >= 20);
  if (windy !== undefined) return { text: `Wind ${windy.windMph} mph`, tone: "warn" };
  return null;
}

export function ConditionsPill({ at }: { readonly at: Coordinate }) {
  // Rounded so panning a few streets does not refetch; the route caches too.
  const lat = Math.round(at.lat * 10) / 10;
  const lon = Math.round(at.lon * 10) / 10;
  // Keyed by where it was fetched, so a pan never shows another place's weather.
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly snapshot: WeatherSnapshot | null } | null>(null);
  const key = `${lat},${lon}`;
  const [now, setNow] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = (): void => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const controller = new AbortController();
    const load = (): void => {
      fetch(`/api/weather?lat=${lat}&lon=${lon}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { snapshot?: WeatherSnapshot } | null) => setLoaded({ key: `${lat},${lon}`, snapshot: body?.snapshot ?? null }))
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 10 * 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [lat, lon]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const snapshot = loaded?.key === key ? loaded.snapshot : null;
  if (snapshot === null || now === null) return null;
  const upcoming = snapshot.forecast.filter((period) => Date.parse(period.endTime) > now).slice(0, 8);
  const current = upcoming[0];
  if (current === undefined || current.temperatureF === null || current.temperatureF === undefined) return null;
  const place = { lat, lon };
  const day = sunState(place, now) !== "night";
  const sunsetIso = calculateSunset(place, localNoon(lon, now))?.sunset ?? null;
  const sunsetMs = sunsetIso === null ? null : Date.parse(sunsetIso);
  // The next change of light: sunset by day; before dawn today's sunrise,
  // after dark tomorrow's.
  const sunriseToday = calculateSunrise(place, localNoon(lon, now));
  const nextSunrise = sunriseToday !== null && Date.parse(sunriseToday) > now ? sunriseToday : calculateSunrise(place, localNoon(lon, now, 1));
  const light = day && sunsetMs !== null && sunsetMs > now ? `Sunset ${clock(sunsetMs)}` : nextSunrise === null ? null : `Sunrise ${clock(nextSunrise)}`;
  const sky = skyOf(current.shortForecast);
  const note = headsUp(snapshot, upcoming.slice(0, 6), sunsetMs, now, day);
  const summary = `${current.temperatureF}°, ${current.shortForecast}${note === null ? "" : `. ${note.text}`}`;

  return (
    <div className="og-conditions" ref={root} data-testid="conditions">
      <button
        type="button"
        className="og-conditions__pill"
        data-tone={note?.tone ?? "none"}
        aria-expanded={open}
        aria-label={`Conditions here: ${summary}`}
        onClick={() => setOpen((value) => !value)}
      >
        <SkyGlyph sky={sky} night={!day} />
        <span className="og-conditions__temp">{current.temperatureF}°</span>
        {note === null ? null : <span className="og-conditions__note">{note.text}</span>}
      </button>
      {open ? (
        <section className="og-conditions__panel" aria-label="Conditions in the next hours">
          <header>
            <strong>{current.shortForecast}</strong>
            <span>{[current.windMph === undefined ? null : current.windMph === 0 ? "Calm" : `Wind ${current.windMph} mph`, light].filter(Boolean).join(" · ")}</span>
          </header>
          {snapshot.alerts.map((alert) => (
            <p key={`${alert.event}-${alert.onset ?? ""}`} className="og-conditions__alert">{alert.event}{alert.ends === null ? "" : ` until ${clock(alert.ends)}`}</p>
          ))}
          <ol className="og-conditions__hours">
            {upcoming.slice(0, 6).map((period) => {
              const start = Date.parse(period.startTime);
              return (
                <li key={period.startTime}>
                  <span className="og-conditions__hour">{start <= now ? "Now" : hourLabel(period.startTime)}</span>
                  <SkyGlyph sky={skyOf(period.shortForecast)} night={sunState(place, start) === "night"} />
                  <span className="og-conditions__hour-temp">{period.temperatureF ?? "–"}°</span>
                  <span className="og-conditions__hour-rain">{period.precipChance ? `${period.precipChance}%` : ""}</span>
                </li>
              );
            })}
          </ol>
          <p className="og-conditions__source">Forecast near the map center · National Weather Service · {clock(snapshot.fetchedAt)}</p>
        </section>
      ) : null}
    </div>
  );
}
