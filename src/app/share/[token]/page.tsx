import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { formatDistance, formatDuration } from "@/application/planner/measurements";
import type { SurfaceIntent } from "@/domain/ride/types";
import type { ShareSnapshot } from "@/domain/sharing/types";
import { publicShareStore } from "@/server/sharing/public-share-store";
import { shareOwnerHash } from "@/server/sharing/public-share-handler";
import { RideCreditLine } from "@/ui/credit/RideCreditLine";
import { AppBar } from "@/ui/nav/AppBar";
import { OwnerRevoke } from "./OwnerRevoke";
import { RideThisButton } from "./RideThisButton";
import { ShareRouteMap } from "./ShareRouteMap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared ride · OpenGravel", robots: { index: false, follow: false }, referrer: "no-referrer" };

const SURFACE_PREFERENCE: Readonly<Record<SurfaceIntent["preference"], string>> = {
  pavement: "Pavement",
  "mostly-pavement": "Mostly pavement",
  mixed: "Mixed surface",
  "dirt-preferred": "Dirt preferred",
};

const UNKNOWN_SURFACE: Readonly<Record<SurfaceIntent["unknownSurfacePolicy"], string>> = {
  "allow-with-warning": "Unknown surfaces allowed with a warning",
  "avoid-when-possible": "Unknown surfaces avoided when possible",
};

export default async function SharedRidePage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const store = publicShareStore();
  const result = store.resolve(token);
  if (result.state === "not-found") notFound();
  if (result.state === "revoked") return (
    <>
      <AppBar current="" />
      <main className="og-route-detail">
        <header className="og-route-detail__header">
          <div className="og-route-detail__heading">
            <p className="og-eyebrow">Shared ride</p>
            <h1>This link has been revoked</h1>
          </div>
        </header>
        <div className="og-route-detail__content">
          <p className="og-route-detail__summary">The owner removed this shared snapshot. Ask them for a new link.</p>
          <Link className="og-primary" href="/">Plan a ride</Link>
        </div>
      </main>
    </>
  );

  const snapshot = JSON.parse(result.output) as ShareSnapshot;
  const ownerId = store.ownedShareId(token, shareOwnerHash((await cookies()).get("og-share-owner")?.value));
  const line = snapshot.route.segments.flatMap((segment) => segment);
  const surface = `${SURFACE_PREFERENCE[snapshot.surface.preference]} · ${UNKNOWN_SURFACE[snapshot.surface.unknownSurfacePolicy]}`;
  const rideTime = snapshot.rideDurationSeconds === null ? "Not shared" : formatDuration(snapshot.rideDurationSeconds);
  // The planner's own distance for the ride. The shared line may be trimmed at
  // its ends, so its length is not the number the rider planned. Only when the
  // planner's number was never shared does the line's own length stand in.
  const rideDistance = snapshot.rideDistanceMeters ?? snapshot.distanceMeters;

  return (
    <>
      <AppBar current="" />
      <main className="og-route-detail">
        <header className="og-route-detail__header">
          <div className="og-route-detail__heading">
            <p className="og-eyebrow">Shared ride · Read only</p>
            <h1>{snapshot.title}</h1>
          </div>
          {snapshot.author === null ? null : (
            <p className="og-route-detail__meta">Shared by {snapshot.author.pseudonym}</p>
          )}
          <RideCreditLine credit={snapshot.credit} />
          <dl className="og-route-detail__facts" data-testid="shared-facts">
            <div className="og-route-detail__stat" data-stat="distance">
              <dt>Distance</dt>
              <dd data-testid="shared-distance">{formatDistance(rideDistance)}</dd>
            </div>
            <div className="og-route-detail__stat" data-stat="time">
              <dt>Time</dt>
              <dd data-testid="shared-time">{rideTime}</dd>
            </div>
          </dl>
        </header>

        <div className="og-route-detail__body">
          <div className="og-route-detail__visual">
            <section className="og-route-detail__map" aria-label="Shared route map">
              <ShareRouteMap
                line={line}
                name={snapshot.title}
                {...(process.env.NEXT_PUBLIC_MAPBOX_TOKEN === undefined
                  ? {}
                  : { token: process.env.NEXT_PUBLIC_MAPBOX_TOKEN })}
              />
            </section>
          </div>

          <div className="og-route-detail__content">
            <p className="og-route-detail__surface-summary" data-testid="shared-surface">{surface}</p>
            <section className="og-route-detail__actions" aria-label="Shared route actions">
              <RideThisButton snapshot={snapshot} sourceId={token} />
            </section>
            <p className="og-route-detail__summary">
              This is the owner’s published snapshot, and its start and finish may be hidden. It does not show
              current road conditions or guarantee access.
            </p>
            {ownerId !== null && <OwnerRevoke shareId={ownerId} />}
            <pre data-testid="public-share-payload" hidden>{result.output}</pre>
          </div>
        </div>
      </main>
    </>
  );
}
