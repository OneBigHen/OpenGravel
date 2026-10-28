"use client";

/**
 * Weather along the route, drawn (MAP-EXPERIENCE-NEXT Wave 2, item 7).
 *
 * The data half samples the forecast at about six points along the planned
 * route, each at the hour the rider reaches it, and words one headline
 * ("Rain from mile 38 around 3 PM"). This is the projection: the headline with
 * a glyph, then one cell per sample — the hour, the temperature and a small bar
 * for the rain chance — so the strip reads against the elevation profile above
 * it instead of asking the rider to open a second screen.
 *
 * Two rules keep it honest:
 *
 * - **Unknown is a dash.** A sample with no reading shows `—` in the field, a
 *   hatched track and no fill. It is never drawn as 0%, and a missing chance
 *   leaves the glyph unknown unless a sample that does have one carries rain.
 * - **Failure is quiet.** Loading and unavailable are one short line each; a
 *   provider that did not answer does not take the elevation profile or the
 *   ride with it.
 */

import {
  ROUTE_RAIN_CHANCE_PCT,
  routeWeatherHourLabel,
  type RouteWeatherReport,
  type RouteWeatherSample,
} from "@/application/weather/route-weather";
import type { RouteWeatherState } from "@/ui/weather/useRouteWeather";

/** The one mark an unknown reading gets: never zero, never "dry". */
const UNKNOWN = "—";

export type RouteWeatherGlyphKind = "dry" | "rain" | "unknown";

/**
 * The sky the headline is about. A single sample without a rain chance makes
 * this unknown rather than sunny, because the report's own "mostly dry" wording
 * is the most that can be said then.
 */
export function routeWeatherGlyph(report: RouteWeatherReport): RouteWeatherGlyphKind {
  if (!report.forecastAvailable || report.samples.length === 0) return "unknown";
  const chances = report.samples.map((sample) => sample.rainChancePct);
  const known = chances.filter((chance): chance is number => chance !== null && Number.isFinite(chance));
  // Rain a sample does carry is a fact even when another sample is missing.
  if (known.some((chance) => chance >= ROUTE_RAIN_CHANCE_PCT)) return "rain";
  return known.length === chances.length ? "dry" : "unknown";
}

type RainBucket = "none" | "low" | "mid" | "high" | "unknown";

/**
 * How much of the cell's bar is filled. The `—` beside it carries the exact
 * chance; the bar exists so the whole ride's shape can be read at a glance.
 */
function rainBucket(chance: number | null): RainBucket {
  if (chance === null || !Number.isFinite(chance)) return "unknown";
  if (chance <= 0) return "none";
  if (chance >= 60) return "high";
  if (chance >= ROUTE_RAIN_CHANCE_PCT) return "mid";
  return "low";
}

function degreeLabel(tempF: number | null): string {
  return tempF === null || !Number.isFinite(tempF) ? UNKNOWN : `${Math.round(tempF)}°`;
}

function chanceLabel(chance: number | null): string {
  return chance === null || !Number.isFinite(chance) ? UNKNOWN : `${Math.round(chance)}%`;
}

/** The rider's own zone, for a cell's hour. `null` leaves the hour unknown. */
function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function hourLabel(sample: RouteWeatherSample, timeZone: string | null): string {
  return routeWeatherHourLabel(sample.eta, timeZone) ?? UNKNOWN;
}

/** A small mark beside the headline, in the colour of what it says. */
function WeatherGlyph({ kind }: { readonly kind: RouteWeatherGlyphKind }) {
  return (
    <svg
      className="og-route-weather__glyph"
      data-kind={kind}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "dry" ? (
        <>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
        </>
      ) : kind === "rain" ? (
        <>
          <path d="M4.4 10.4a2.6 2.6 0 0 1 .3-5.2 3.6 3.6 0 0 1 6.9.5 2.3 2.3 0 0 1 .2 4.6" />
          <path d="M5.6 12v1.4M8 12v1.8M10.4 12v1.4" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M6.3 6.3a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.7-.8 1.2v.2" />
          <circle cx="8" cy="11.6" r="0.7" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

export interface RouteWeatherStripProps {
  readonly state: RouteWeatherState;
  /**
   * IANA zone for a cell's hour. The device's own when omitted; an unknown zone
   * leaves every hour a dash rather than guessing one.
   */
  readonly timeZone?: string | null;
}

/**
 * The planned route's weather: nothing while there is no ride to place it
 * against, one quiet line while it loads or when it is unavailable, and the
 * headline and cell strip once a report arrives.
 */
export function RouteWeatherStrip({ state, timeZone }: RouteWeatherStripProps) {
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <p className="og-route-weather__note" data-testid="route-weather-loading" role="status">
        Checking the weather along the route…
      </p>
    );
  }
  if (state.status === "unavailable") {
    return (
      <p className="og-route-weather__note" data-testid="route-weather-unavailable">
        Weather along the route is unavailable right now.
      </p>
    );
  }

  const { report } = state;
  const zone = timeZone ?? deviceTimeZone();
  return (
    <section className="og-route-weather" data-testid="route-weather" aria-label="Weather along the route">
      <p className="og-route-weather__headline" data-testid="route-weather-headline">
        <WeatherGlyph kind={routeWeatherGlyph(report)} />
        <span>{report.headline}</span>
      </p>
      {report.samples.length === 0 ? null : (
        <ol className="og-route-weather__cells" data-testid="route-weather-cells">
          {report.samples.map((sample, index) => {
            const bucket = rainBucket(sample.rainChancePct);
            return (
              <li
                key={`${sample.mile}-${index}`}
                className="og-route-weather__cell"
                data-testid="route-weather-cell"
                data-mile={sample.mile}
                data-rain={bucket}
              >
                <span className="og-visually-hidden">Mile {Math.round(sample.mile)}</span>
                <span className="og-route-weather__hour">{hourLabel(sample, zone)}</span>
                <span className="og-route-weather__temp">{degreeLabel(sample.tempF)}</span>
                <span className="og-route-weather__rain" aria-hidden="true">
                  {bucket === "unknown" ? null : <span className="og-route-weather__bar" data-rain={bucket} />}
                </span>
                <span className="og-route-weather__pct">{chanceLabel(sample.rainChancePct)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
