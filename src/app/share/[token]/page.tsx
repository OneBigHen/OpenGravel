import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ShareSnapshot } from "@/domain/sharing/types";
import { publicShareStore } from "@/server/sharing/public-share-store";
import { shareOwnerHash } from "@/server/sharing/public-share-handler";
import { OwnerRevoke } from "./OwnerRevoke";
import styles from "./share.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared ride · OpenGravel", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function SharedRidePage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const store = publicShareStore();
  const result = store.resolve(token);
  if (result.state === "not-found") notFound();
  if (result.state === "revoked") return <main className={styles.page}><Link href="/">OpenGravel</Link><h1>This link has been revoked</h1><p>The owner removed this shared snapshot. Ask them for a new link.</p></main>;
  const snapshot = JSON.parse(result.output) as ShareSnapshot;
  const ownerId = store.ownedShareId(token, shareOwnerHash((await cookies()).get("og-share-owner")?.value));
  const points = snapshot.route.segments.flat();
  const minLon = Math.min(...points.map(p => p.lon)), maxLon = Math.max(...points.map(p => p.lon));
  const minLat = Math.min(...points.map(p => p.lat)), maxLat = Math.max(...points.map(p => p.lat));
  const width = Math.max(maxLon - minLon, 0.0001), height = Math.max(maxLat - minLat, 0.0001);
  const scale = Math.min(720 / width, 340 / height);
  const x = (lon: number) => 400 + (lon - (minLon + maxLon) / 2) * scale;
  const y = (lat: number) => 190 - (lat - (minLat + maxLat) / 2) * scale;
  return <main className={styles.page}>
    <Link href="/">OpenGravel</Link><p>Shared ride · Read only</p><h1>{snapshot.title}</h1>
    {snapshot.author !== null && <p>Shared by {snapshot.author.pseudonym}</p>}
    <svg className={styles.route} viewBox="0 0 800 380" role="img" aria-label="Shared route outline">
      {snapshot.route.segments.map((segment, i) => <polyline key={i} points={segment.map(p => `${x(p.lon)},${y(p.lat)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />)}
    </svg>
    <p>{(snapshot.distanceMeters / 1609.344).toFixed(1)} miles shared · {snapshot.surface.preference.replaceAll("-", " ")}</p>
    <p>Ride time: {snapshot.rideDurationSeconds === null ? "Not shared" : `${Math.round(snapshot.rideDurationSeconds / 60)} minutes`} · {snapshot.surface.unknownSurfacePolicy === "allow-with-warning" ? "Unknown surfaces allowed with a warning" : "Unknown surfaces avoided when possible"}</p>
    <p>Source: {snapshot.source.attribution.replaceAll("-", " ")}. Surface preference is rider intent, not verified road evidence.</p>
    <p>This is the owner’s published snapshot. Its start and finish may be hidden. The route outline has no basemap; it does not show current road conditions or guarantee access.</p>
    <details><summary>Shared data</summary><pre data-testid="public-share-payload">{result.output}</pre></details>
    {ownerId !== null && <OwnerRevoke shareId={ownerId} />}
  </main>;
}
