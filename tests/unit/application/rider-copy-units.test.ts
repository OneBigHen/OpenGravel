import { describe, expect, it } from "vitest";
import { arrivalLabel, arrivalWithLight } from "@/application/planner/arrival";
import { formatDuration } from "@/application/planner/measurements";
import { formatWholeMinutes } from "@/domain/format/duration";
import { formatTempF, formatWeatherLine, plainCondition } from "@/application/weather/weather-line";
import { formatRideMinutes } from "@/ui/explore/route-facts";
import { formatRideTime } from "@/ui/planner/RideStyleControls";
import { timeLeftText } from "@/domain/live/expected-finish";

describe("one duration formatter", () => {
  it("spells minutes as min everywhere, never a bare m", () => {
    expect(formatDuration(6720)).toBe("1 h 52 min");
    expect(formatWholeMinutes(112)).toBe("1 h 52 min");
    expect(formatRideMinutes(112)).toBe("1 h 52 min");
    expect(formatRideTime(112)).toBe("1 h 52 min");
    expect(timeLeftText(112 * 60_000)).toBe("1 h 52 min");
    expect(formatWholeMinutes(120)).toBe("2 h");
    expect(formatWholeMinutes(45)).toBe("45 min");
  });
});

describe("one arrival string", () => {
  it("always carries the clock time, then the daylight fact", () => {
    expect(arrivalLabel("12:50 AM", true)).toBe("Back 12:50 AM");
    expect(arrivalLabel("6:10 PM", false)).toBe("Arrive 6:10 PM");
    expect(arrivalWithLight("12:50 AM", true, "before sunrise")).toBe("Back 12:50 AM · before sunrise");
    expect(arrivalWithLight("6:10 PM", false, null)).toBe("Arrive 6:10 PM");
  });
});

describe("one weather string", () => {
  it("reads like Rain likely · 54% · 50°F with the unit always shown", () => {
    expect(formatWeatherLine({ shortForecast: "Rain Likely", rainChancePct: 54, tempF: 50 })).toBe("Rain likely · 54% · 50°F");
    expect(formatWeatherLine({ shortForecast: "Chance Rain Showers", rainChancePct: 54, tempF: 50 })).toBe("Rain possible · 54% · 50°F");
    expect(formatWeatherLine({ shortForecast: "Sunny", tempF: 72 })).toBe("Sunny · 72°F");
    expect(formatWeatherLine({ shortForecast: "Cloudy", rainChancePct: 40, tempF: 61 })).toBe("Cloudy · Rain 40% · 61°F");
    expect(formatTempF(49.4)).toBe("49°F");
    expect(plainCondition("Partly Sunny")).toBe("Partly Sunny");
  });
});
