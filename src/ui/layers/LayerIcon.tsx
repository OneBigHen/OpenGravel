/**
 * Line icons for the layers sheet, one per layer and quick set, drawn on one
 * 24px grid with a 1.8 stroke so every tile reads as one family. The catalog's
 * text glyphs stay for map markers; the sheet uses these.
 */

import type { ReactNode } from "react";

import type { MapLayerId } from "@/application/map-layers";

type IconKey = MapLayerId | "fun" | "stops" | "traffic" | "hiking";

const PATHS: Readonly<Record<IconKey, ReactNode>> = {
  "hiking": <><path d="m2 19 7-10 4 6 3-4 6 8Z" /><path d="M8 21h8" /></>,
  "trails": <path d="M3 17c3 0 3-10 6-10s3 10 6 10 3-6 6-6" />,
  "trailheads": <path d="M12 3 3 20h18Z" />,
  "water-sources": <path d="M12 3C9 8 6 11 6 15a6 6 0 0 0 12 0c0-4-3-7-6-12Z" />,
  "shelters": <path d="M3 20 12 5l9 15Z" />,
  "summits": <path d="M2 20 12 4l10 16Z" />,
  "hunting-season": <path d="M12 3 2 20h20ZM12 10v5" />,
  "trail-closures": <path d="M4 4l16 16M20 4 4 20" />,
  "fun": <path d="M3 17c3 0 3-10 6-10s3 10 6 10 3-6 6-6" />,
  "great-roads": <path d="M3 17c3 0 3-10 6-10s3 10 6 10 3-6 6-6" />,
  "gravel": <><path d="M4 20 10 4M20 20 14 4" /><path d="M12 7v2M12 12v2M12 17v2" /></>,
  "road-history": <><path d="M4 18a8 8 0 1 1 3 2" /><path d="M4 13v5h5" /><path d="M12 8v4l3 2" /></>,
  "weather": <><path d="M7 17a4 4 0 1 1 1-7.9A5 5 0 0 1 17.6 10 3.5 3.5 0 1 1 17.5 17Z" /></>,
  "weather-radar": <><path d="M7 14a4 4 0 1 1 1-7.9A5 5 0 0 1 17.6 7 3.5 3.5 0 1 1 17.5 14Z" /><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" /></>,
  "traffic": <><rect x="8" y="3" width="8" height="18" rx="3" /><circle cx="12" cy="7.5" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="12" cy="16.5" r="1.2" /></>,
  "traffic-flow": <><path d="M4 8h12M4 12h16M4 16h9" /><path d="m17 5 3 3-3 3" /></>,
  "live-traffic": <><path d="M12 3 2 20h20Z" /><path d="M12 10v4M12 17v.5" /></>,
  "traffic-cameras": <><rect x="3" y="7" width="13" height="10" rx="2" /><path d="m16 11 5-3v8l-5-3" /></>,
  "work-zones": <><path d="M5 20h14M8 20 12 5l4 15" /><path d="M9.5 14h5M10.6 10h2.8" /></>,
  "active-fire": <path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 1 1 1.5 2 1.5 3C12 8 11 6 12 3Z" />,
  "stops": <><path d="M5 20V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v14M4 20h11M5 11h9" /><path d="M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3" /></>,
  "fuel": <><path d="M5 20V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v14M4 20h11M5 11h9" /><path d="M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3" /></>,
  "food": <><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10" /><path d="M17 21V3c-2 1-3 4-3 8h3" /></>,
  "coffee": <><path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z" /><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3" /></>,
  "viewpoints": <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  "camping": <><path d="M3 20 12 5l9 15Z" /><path d="M12 12l-3 8M12 12l3 8" /></>,
  "lodging": <><path d="M3 18V8M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" /><circle cx="7" cy="11" r="1.6" /></>,
  "repair": <path d="M14.5 5.5a4 4 0 0 0 5 5L12 18a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2ZM5 19l2-2" />,
  "public-land": <><path d="m12 3-5 7h3l-4 6h12l-4-6h3Z" /><path d="M12 16v5" /></>,
  "mvum": <><path d="M5 21 11 3M19 21 13 3" /><path d="m9 13 3-3 3 3" /></>,
  "hillshade": <><path d="m2 19 7-10 4 6 3-4 6 8Z" /><path d="m9 9 2 3" /></>,
  "contours": <><path d="M3 15c3-4 6 1 9-3s6 1 9-3" /><path d="M3 19c3-4 6 1 9-3s6 1 9-3" /><path d="M3 11c3-4 6 1 9-3s6 1 9-3" /></>,
  "slope": <><path d="M3 20h18L3 7Z" /><path d="M7 20a5 5 0 0 0-1-3" /></>,
  "terrain-3d": <><path d="M12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></>,
};

/**
 * A layer's icon on its own tinted tile: a soft wash of the layer's colour
 * when off, the full colour with a paper icon when on.
 */
export function LayerIcon({
  id,
  tint = "var(--og-ink-2)",
  on = false,
  size = 40,
}: {
  readonly id: string;
  readonly tint?: string;
  readonly on?: boolean;
  readonly size?: number;
}) {
  const path = (PATHS as Readonly<Record<string, ReactNode>>)[id];
  return (
    <svg className="og-layer-icon" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="12" fill={tint} opacity={on ? 1 : 0.14} />
      <g
        transform="translate(8 8)"
        fill="none"
        stroke={on ? "var(--og-on-primary)" : tint}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {path ?? <circle cx="12" cy="12" r="6" />}
      </g>
    </svg>
  );
}

/** The bare line icon, in the current text colour, for chips and buttons. */
export function LayerGlyph({ id, size = 18, className }: { readonly id: string; readonly size?: number; readonly className?: string }) {
  const path = (PATHS as Readonly<Record<string, ReactNode>>)[id];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path ?? <circle cx="12" cy="12" r="6" />}
    </svg>
  );
}
