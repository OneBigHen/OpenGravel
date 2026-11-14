/**
 * The one way a weather summary reads, for the map chip and the loop sheet
 * alike: `Rain likely · 54% · 50°F`. The temperature always carries `°F`, a
 * rain chance is a bare percentage after a rain word (never "54% rain", which
 * reads as an amount), and nothing here ever hides an alert.
 */

const RAINY = /\b(rain|showers?|drizzle|thunderstorms?|storms?)\b/i;

/** `Chance Rain Showers` becomes `Rain possible`; `Rain Likely` stays likely. */
export function plainCondition(shortForecast: string): string {
  const text = shortForecast.trim();
  if (!RAINY.test(text)) return text;
  if (/\blikely\b/i.test(text)) return "Rain likely";
  if (/\bchance|slight|isolated|scattered\b/i.test(text)) return "Rain possible";
  return text;
}

export function formatTempF(tempF: number): string {
  return `${Math.round(tempF)}°F`;
}

export interface WeatherLineInput {
  readonly shortForecast: string;
  readonly tempF?: number | null;
  /** A rain chance worth saying; the caller decides the threshold. */
  readonly rainChancePct?: number | null;
}

export function formatWeatherLine(input: WeatherLineInput): string {
  const condition = plainCondition(input.shortForecast);
  const parts: string[] = [condition];
  const chance = input.rainChancePct;
  if (chance !== null && chance !== undefined && Number.isFinite(chance)) {
    const rounded = Math.round(chance);
    parts.push(RAINY.test(input.shortForecast) ? `${rounded}%` : `Rain ${rounded}%`);
  }
  if (input.tempF !== null && input.tempF !== undefined && Number.isFinite(input.tempF)) parts.push(formatTempF(input.tempF));
  return parts.join(" · ");
}
