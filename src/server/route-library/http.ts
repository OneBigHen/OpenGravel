import "server-only";

import { gunzipSync } from "node:zlib";

import { rideGpx } from "@/application/route-library/gpx-out";
import { splitSegments } from "@/application/route-library/geometry";

import { packAsset, packManifest, packRide, packVersion } from "./pack";

const IMMUTABLE = "public, max-age=31536000, immutable";
const FIVE_MINUTES = "public, max-age=300";
const ONE_HOUR = "public, max-age=3600";
const JSON_TYPE = "application/json; charset=utf-8";
const RIDE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATE_CODE = /^(?:[A-Z]{2}|NATIONAL)$/;

function notFound(message = "Not found"): Response {
  return Response.json({ error: message }, { status: 404, headers: { "cache-control": "no-store" } });
}

/** A stored gzip body is sent as it is; a client that cannot read gzip gets it unpacked. */
function storedGzip(request: Request, body: Buffer, headers: Record<string, string>): Response {
  const accepts = /\bgzip\b/i.test(request.headers.get("accept-encoding") ?? "");
  if (accepts) {
    return new Response(new Uint8Array(body), { headers: { ...headers, "content-encoding": "gzip", vary: "accept-encoding" } });
  }
  return new Response(new Uint8Array(gunzipSync(body)), { headers: { ...headers, vary: "accept-encoding" } });
}

function etagMatches(request: Request, etag: string): boolean {
  const header = request.headers.get("if-none-match");
  return header !== null && header.split(",").some((candidate) => candidate.trim().replace(/^W\//, "") === etag);
}

export function manifestResponse(): Response {
  const manifest = packManifest();
  if (manifest === null) return notFound("The ride library is not available.");
  return Response.json(manifest, { headers: { "cache-control": FIVE_MINUTES } });
}

export function indexResponse(request: Request, version: string): Response {
  if (packVersion() !== version) return notFound();
  const asset = packAsset("index");
  if (asset === null) return notFound();
  return storedGzip(request, asset.body, { "content-type": JSON_TYPE, "cache-control": IMMUTABLE, etag: `"${version}"` });
}

export function linesResponse(request: Request, version: string, stateFile: string): Response {
  const state = stateFile.replace(/\.json$/, "");
  if (!STATE_CODE.test(state) || packVersion() !== version) return notFound();
  const asset = packAsset(`lines/${state}`);
  if (asset === null) return notFound();
  return storedGzip(request, asset.body, { "content-type": JSON_TYPE, "cache-control": IMMUTABLE, etag: `"${version}"` });
}

export function rideResponse(request: Request, id: string): Response {
  const version = packVersion();
  if (version === null || !RIDE_ID.test(id)) return notFound();
  const etag = `"${version}"`;
  if (etagMatches(request, etag)) return new Response(null, { status: 304, headers: { etag, "cache-control": ONE_HOUR } });
  const ride = packRide(id);
  if (ride === null) return notFound("That ride is not in the library.");
  const segments = splitSegments(ride.line);
  const body = {
    ...ride.detail,
    precision: 5,
    ...(segments.length <= 1 ? { line: segments[0] ?? "" } : { segments }),
  };
  return Response.json(body, { headers: { "cache-control": ONE_HOUR, etag } });
}

export function gpxResponse(id: string): Response {
  if (packVersion() === null || !RIDE_ID.test(id)) return notFound();
  const ride = packRide(id);
  if (ride === null) return notFound("That ride is not in the library.");
  if (!ride.detail.track.gpxAllowed || ride.line === "") {
    return Response.json(
      {
        error: "This ride's file is not hosted here. Get the track from its source.",
        sourceName: ride.detail.credit.sourceName,
        sourceUrl: ride.detail.credit.sourceUrl,
        downloadUrl: ride.detail.track.sourceDownloadUrl,
      },
      { status: 403, headers: { "cache-control": ONE_HOUR, link: `<${ride.detail.credit.sourceUrl}>; rel="alternate"` } },
    );
  }
  return new Response(rideGpx(ride.detail, ride.line), {
    headers: {
      "content-type": "application/gpx+xml; charset=utf-8",
      "content-disposition": `attachment; filename="${ride.id}.gpx"`,
      "cache-control": ONE_HOUR,
    },
  });
}
