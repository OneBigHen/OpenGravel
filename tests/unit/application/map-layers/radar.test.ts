import { describe, expect, it } from "vitest";

import {
  RADAR_ATTRIBUTION,
  RADAR_PAST_SPAN_MS,
  RADAR_STALE_AFTER_MS,
  advanceRadarTimeline,
  initialRadarTimeline,
  isRadarFrameList,
  latestFrameIndex,
  parseRainViewerWeatherMaps,
  radarFrameLabel,
  radarFreshness,
  radarTileTemplate,
  scrubRadarTimeline,
  setRadarPlaying,
} from "@/application/map-layers";

const NOW = Date.parse("2026-10-03T18:40:00Z");
const HOST = "https://tilecache.rainviewer.com";

function unix(iso: string): number {
  return Math.floor(Date.parse(iso) / 1_000);
}

function payload(overrides: { readonly host?: unknown; readonly past?: unknown; readonly nowcast?: unknown } = {}): unknown {
  return {
    version: "2.0",
    generated: unix("2026-10-03T18:40:00Z"),
    host: overrides.host ?? HOST,
    radar: {
      past: overrides.past ?? [
        { time: unix("2026-10-03T16:20:00Z"), path: "/v2/radar/too_old" },
        { time: unix("2026-10-03T16:40:00Z"), path: "/v2/radar/start" },
        { time: unix("2026-10-03T18:30:00Z"), path: "/v2/radar/latest" },
        { time: unix("2026-10-03T21:00:00Z"), path: "/v2/radar/future" },
      ],
      nowcast: overrides.nowcast ?? [
        { time: unix("2026-10-03T18:50:00Z"), path: "/v2/radar/nowcast_ab12" },
        { time: unix("2026-10-03T19:10:00Z"), path: "/v2/radar/nowcast_cd34" },
        { time: unix("2026-10-03T20:00:00Z"), path: "/v2/radar/nowcast_too_far" },
      ],
    },
  };
}

describe("RainViewer frame list", () => {
  it("keeps the last two hours and the 30-minute nowcast, oldest first", () => {
    const list = parseRainViewerWeatherMaps(payload(), NOW);
    expect(list.host).toBe(HOST);
    expect(list.generatedAt).toBe("2026-10-03T18:40:00.000Z");
    expect(list.frames.map((frame) => [new Date(frame.time * 1_000).toISOString(), frame.kind])).toEqual([
      ["2026-10-03T16:40:00.000Z", "past"],
      ["2026-10-03T18:30:00.000Z", "past"],
      ["2026-10-03T18:50:00.000Z", "nowcast"],
      ["2026-10-03T19:10:00.000Z", "nowcast"],
    ]);
  });

  it("drops frames with unsafe paths instead of building tile URLs from them", () => {
    const list = parseRainViewerWeatherMaps(payload({
      past: [
        { time: unix("2026-10-03T18:30:00Z"), path: "/v2/radar/latest" },
        { time: unix("2026-10-03T18:20:00Z"), path: "https://evil.example/v2/radar/x" },
        { time: unix("2026-10-03T18:10:00Z"), path: "/v2/radar/../../secret" },
        { time: unix("2026-10-03T18:00:00Z"), path: "/v2/radar/frame?x=1" },
        { time: unix("2026-10-03T17:50:00Z"), path: "" },
      ],
      nowcast: [],
    }), NOW);
    expect(list.frames).toHaveLength(1);
    expect(list.frames[0]?.path).toBe("/v2/radar/latest");
  });

  it("refuses a tile host that is not a bare https origin", () => {
    expect(() => parseRainViewerWeatherMaps(payload({ host: "http://tilecache.rainviewer.com" }), NOW)).toThrow();
    expect(() => parseRainViewerWeatherMaps(payload({ host: `${HOST}/v2` }), NOW)).toThrow();
    expect(() => parseRainViewerWeatherMaps(payload({ host: "https://user:pw@tilecache.rainviewer.com" }), NOW)).toThrow();
    expect(() => parseRainViewerWeatherMaps(payload({ host: "" }), NOW)).toThrow();
  });

  it("fails instead of reporting an empty sky when no frame is usable", () => {
    expect(() => parseRainViewerWeatherMaps(null, NOW)).toThrow();
    expect(() => parseRainViewerWeatherMaps({}, NOW)).toThrow();
    expect(() => parseRainViewerWeatherMaps(payload({ past: [], nowcast: [] }), NOW)).toThrow();
    expect(() => parseRainViewerWeatherMaps(payload({
      past: [{ time: unix("2026-10-03T08:00:00Z"), path: "/v2/radar/ancient" }],
      nowcast: [],
    }), NOW)).toThrow();
  });

  it("builds the frame tile template RainViewer documents", () => {
    expect(radarTileTemplate(HOST, "/v2/radar/1712345400")).toBe(
      `${HOST}/v2/radar/1712345400/256/{z}/{x}/{y}/2/1_1.png`,
    );
  });

  it("accepts only a normalised list from our own route", () => {
    const list = parseRainViewerWeatherMaps(payload(), NOW);
    expect(isRadarFrameList(list)).toBe(true);
    expect(isRadarFrameList({ ...list, frames: [] })).toBe(false);
    expect(isRadarFrameList({ ...list, generatedAt: "not a time" })).toBe(false);
    expect(isRadarFrameList({ ...list, frames: [{ ...list.frames[0], path: "javascript:alert(1)" }] })).toBe(false);
    expect(isRadarFrameList({ ...list, frames: [{ ...list.frames[0], kind: "here" }] })).toBe(false);
  });
});

describe("radar timeline", () => {
  const list = parseRainViewerWeatherMaps(payload(), NOW);

  it("starts on the frame that reads as now and plays unless motion is reduced", () => {
    expect(initialRadarTimeline(list.frames, NOW, false)).toEqual({ index: 1, playing: true });
    expect(initialRadarTimeline(list.frames, NOW, true)).toEqual({ index: 1, playing: false });
    expect(latestFrameIndex(list.frames, Date.parse("2026-10-03T18:35:00Z"))).toBe(1);
    expect(latestFrameIndex(list.frames, Date.parse("2026-10-03T15:00:00Z"))).toBe(0);
  });

  it("loops from the last nowcast frame back to the first past frame", () => {
    const last = { index: list.frames.length - 1, playing: true };
    expect(advanceRadarTimeline(last, list.frames.length)).toEqual({ index: 0, playing: true });
    expect(advanceRadarTimeline({ index: 0, playing: false }, list.frames.length)).toEqual({ index: 1, playing: false });
    // One frame is not a loop, and the control must not claim it is playing.
    expect(advanceRadarTimeline({ index: 0, playing: true }, 1)).toEqual({ index: 0, playing: false });
  });

  it("stops playing when the rider scrubs, and clamps to the list", () => {
    expect(scrubRadarTimeline(2, 4)).toEqual({ index: 2, playing: false });
    expect(scrubRadarTimeline(9, 4)).toEqual({ index: 3, playing: false });
    expect(scrubRadarTimeline(-4, 4)).toEqual({ index: 0, playing: false });
    expect(setRadarPlaying({ index: 2, playing: false }, true, 4)).toEqual({ index: 2, playing: true });
    expect(setRadarPlaying({ index: 2, playing: true }, true, 1)).toEqual({ index: 2, playing: false });
  });

  it("labels observed frames with a clock time and nowcast frames with an offset", () => {
    const observed = { time: unix("2026-10-03T18:40:00Z"), path: "/v2/radar/latest", kind: "past" as const };
    const [firstNowcast, secondNowcast] = list.frames.filter((frame) => frame.kind === "nowcast");
    expect(radarFrameLabel(observed, NOW, "America/New_York")).toBe("2:40 PM");
    expect(radarFrameLabel(firstNowcast!, NOW, "America/New_York")).toBe("+10 min");
    expect(radarFrameLabel(secondNowcast!, NOW, "America/New_York")).toBe("+30 min");
  });

  it("calls a frame list older than the stale bound out of date", () => {
    const fresh = radarFreshness(list, Date.parse("2026-10-03T18:45:00Z"));
    expect(fresh.layerId).toBe("weather-radar");
    expect(fresh.source).toBe(RADAR_ATTRIBUTION);
    expect(fresh.observedAt).toBe("2026-10-03T18:30:00.000Z");
    expect(fresh.stale).toBe(false);
    expect(fresh.staleAfterMs).toBe(RADAR_STALE_AFTER_MS);
    const stale = radarFreshness(list, Date.parse("2026-10-03T18:55:00Z"));
    expect(stale.stale).toBe(true);
    expect(RADAR_PAST_SPAN_MS).toBe(2 * 60 * 60_000);
  });
});
