import { creditDescription } from "@/domain/ride/credit";
import type { Coordinate } from "@/domain/ride/types";

import { decodeLine, splitSegments } from "./geometry";
import type { RideDetail } from "./types";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function segmentXml(points: readonly Coordinate[]): string {
  return `<trkseg>${points.map((point) => `<trkpt lat="${point.lat.toFixed(5)}" lon="${point.lon.toFixed(5)}"/>`).join("")}</trkseg>`;
}

/**
 * A GPX file written from a stored line, with the credit sentence in its
 * metadata so the file keeps it wherever it goes.
 */
export function rideGpx(detail: Pick<RideDetail, "name" | "credit" | "track">, storedLine: string): string {
  const credit = creditDescription({ author: detail.credit.author, sourceName: detail.credit.sourceName, sourceUrl: detail.credit.sourceUrl });
  const older = detail.track.year === null ? "Track date unknown." : `Source track from ${detail.track.year}.`;
  const description = `${credit}. ${older} Not checked against today's roads, closures or surface.`;
  const segments = splitSegments(storedLine).map((segment) => segmentXml(decodeLine(segment)));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="OpenGravel route library" xmlns="http://www.topografix.com/GPX/1/1">',
    `<metadata><name>${escapeXml(detail.name)}</name><desc>${escapeXml(description)}</desc>` +
      `<link href="${escapeXml(detail.credit.sourceUrl)}"><text>${escapeXml(detail.credit.sourceName)}</text></link></metadata>`,
    `<trk><name>${escapeXml(detail.name)}</name><desc>${escapeXml(detail.credit.creditLine)}</desc>${segments.join("")}</trk>`,
    "</gpx>",
    "",
  ].join("\n");
}
