"use client";

import type { ElevationProfile } from "@/application/elevation/profile";

const WIDTH = 320;
const HEIGHT = 64;
const FEET_PER_METER = 3.28084;
const METERS_PER_MILE = 1609.344;

interface Span { readonly from: number; readonly to: number }

/**
 * A compact elevation profile for the Breadcrumb card: a filled area under the
 * line, with the steep legs redrawn over it in the warning colour. Decorative
 * for pointers, described for screen readers.
 */
export function BreadcrumbProfile({ profile, steepSpans }: { readonly profile: ElevationProfile; readonly steepSpans: readonly Span[] }) {
  const span = Math.max(profile.maxMeters - profile.minMeters, 40);
  const floor = profile.minMeters - span * 0.1;
  const ceiling = profile.maxMeters + span * 0.1;
  const total = Math.max(profile.totalMeters, 1);
  const x = (distance: number): number => (distance / total) * WIDTH;
  const y = (elevation: number): number => HEIGHT - ((elevation - floor) / (ceiling - floor)) * HEIGHT;
  const coordinates = profile.points.map((point) => `${x(point.distanceMeters).toFixed(1)},${y(point.elevationMeters).toFixed(1)}`);
  const line = `M${coordinates.join("L")}`;
  const steepLines = steepSpans.map((range) => {
    const inside = profile.points.filter((point) => point.distanceMeters >= range.from && point.distanceMeters <= range.to);
    return inside.length < 2 ? "" : `M${inside.map((point) => `${x(point.distanceMeters).toFixed(1)},${y(point.elevationMeters).toFixed(1)}`).join("L")}`;
  }).filter((path) => path !== "");
  const low = Math.round(profile.minMeters * FEET_PER_METER).toLocaleString("en-US");
  const high = Math.round(profile.maxMeters * FEET_PER_METER).toLocaleString("en-US");
  const miles = (total / METERS_PER_MILE).toFixed(1);
  return (
    <figure className="og-breadcrumb-profile">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`Elevation profile, ${low} to ${high} feet over ${miles} miles`} focusable="false">
        <path className="og-breadcrumb-profile__area" d={`${line}L${WIDTH},${HEIGHT}L0,${HEIGHT}Z`} />
        <path className="og-breadcrumb-profile__line" d={line} />
        {steepLines.map((path) => <path key={path} className="og-breadcrumb-profile__steep" d={path} />)}
      </svg>
      <figcaption><span>{low}–{high} ft</span><span>{miles} mi</span></figcaption>
    </figure>
  );
}
