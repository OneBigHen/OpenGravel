"use client";

/**
 * The rain radar timeline inside the map (map-experience wave 3, item 12).
 *
 * One compact pill, shown only while the Rain radar layer is on: play/pause,
 * a scrubber across two hours of past frames and the 30-minute nowcast, and the
 * frame's own label — "2:40 PM" for an observed frame, "+20 min" for a forecast
 * one. It holds no state: the frame list, the index and the loop live in
 * `useMapLayers`, so the map stays a renderer and this stays a control.
 *
 * A list that could not be read says so here instead of showing an empty
 * timeline, because an empty radar reads as "no rain".
 */

import { RADAR_ATTRIBUTION } from "@/application/map-layers/radar";

import type { RadarView } from "./useMapLayers";

const PLAY_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
  </svg>
);

const PAUSE_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
  </svg>
);

export interface RadarTimelineProps {
  readonly radar: RadarView;
}

export function RadarTimeline({ radar }: RadarTimelineProps) {
  if (radar.unavailable) {
    return (
      <div className="og-radar" data-testid="radar-timeline" data-state="unavailable" role="status">
        <p className="og-radar__note">Rain radar is unavailable right now.</p>
      </div>
    );
  }
  if (radar.loading || radar.frames.length === 0) {
    return (
      <div className="og-radar" data-testid="radar-timeline" data-state="loading" role="status">
        <p className="og-radar__note">Loading rain radar…</p>
      </div>
    );
  }

  const last = radar.frames.length - 1;
  const nowcast = radar.frames[radar.index]?.kind === "nowcast";
  return (
    <div
      className="og-radar"
      data-testid="radar-timeline"
      data-state="ready"
      data-frame={radar.index}
      data-nowcast={nowcast ? "true" : "false"}
      role="group"
      aria-label="Rain radar timeline"
    >
      <button
        type="button"
        className="og-radar__play"
        onClick={radar.togglePlay}
        aria-label={radar.playing ? "Pause rain radar" : "Play rain radar"}
        aria-pressed={radar.playing}
      >
        {radar.playing ? PAUSE_ICON : PLAY_ICON}
      </button>
      <input
        className="og-radar__scrub"
        type="range"
        min={0}
        max={Math.max(0, last)}
        step={1}
        value={radar.index}
        aria-label="Radar frame"
        aria-valuetext={radar.label}
        onChange={(event) => radar.scrub(Number(event.target.value))}
      />
      <span className="og-radar__time">
        <span className="og-radar__time-label">{radar.label}</span>
        <span className="og-radar__time-meta">
          {nowcast ? `Forecast · ${RADAR_ATTRIBUTION}` : RADAR_ATTRIBUTION}
        </span>
      </span>
    </div>
  );
}
