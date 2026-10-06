"use client";

import Link from "next/link";
import { useState } from "react";

import { CommunityRouteError, removeCommunityRoute, shareRouteWithEveryone } from "@/application/community/route-sharing-client";
import type { Coordinate } from "@/domain/ride/types";

/** Riders who first posted a route in the group these were gathered from can still ask for it to go. */
const IMPORTED_NOTICE_UNTIL = Date.UTC(2026, 9, 20);
const IMPORTED_NOTICE_LAST_DAY = "Oct 19";

function message(caught: unknown): string {
  return caught instanceof CommunityRouteError ? caught.message : "Something went wrong. Try again.";
}

/** One tap puts a rider's own route on Explore for everyone. */
export function ShareWithEveryone({ name, geometry }: { readonly name: string; readonly geometry: readonly Coordinate[] }) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "busy" | "done">("idle");
  const [sharedId, setSharedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (geometry.length < 2) return null;
  if (phase === "done" && sharedId !== null) {
    return (
      <p className="og-community-action" role="status">
        Shared with everyone. <Link href={`/explore/${encodeURIComponent(sharedId)}`}>See it on Explore</Link>. Anyone can take a shared route down.
      </p>
    );
  }
  if (phase === "idle") {
    return <button type="button" className="og-secondary" onClick={() => setPhase("confirm")}>Share with everyone</button>;
  }
  return (
    <div className="og-community-action" role="group" aria-label="Share with everyone">
      <p>
        This puts <b>{name}</b> on Explore for anyone to see, ride and download, including exactly where it starts and ends. Anyone can also take it down again.
      </p>
      <div className="og-community-action__row">
        <button
          type="button"
          className="og-primary"
          disabled={phase === "busy"}
          onClick={() => {
            setPhase("busy");
            setError(null);
            shareRouteWithEveryone(name, geometry).then(
              (id) => {
                setSharedId(id);
                setPhase("done");
              },
              (caught: unknown) => {
                setError(message(caught));
                setPhase("confirm");
              },
            );
          }}
        >
          {phase === "busy" ? "Sharing…" : "Share it"}
        </button>
        <button type="button" className="og-secondary" disabled={phase === "busy"} onClick={() => setPhase("idle")}>Not now</button>
      </div>
      {error === null ? null : <p role="alert" className="og-community-action__error">{error}</p>}
    </div>
  );
}

/** Anyone can take a community route down, at once, with an optional reason. */
export function RemoveRoute({ routeId, name }: { readonly routeId: string; readonly name: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeOpen] = useState(() => Date.now() < IMPORTED_NOTICE_UNTIL);
  const fromGroup = !routeId.startsWith("community_") && noticeOpen;
  if (removed) {
    return (
      <p className="og-community-action" role="status">
        Removed. <Link href="/explore">Back to Explore</Link>
      </p>
    );
  }
  return (
    <section className="og-community-action" aria-label="Remove this route">
      {fromGroup ? (
        <p>
          This route was gathered from a public riders&apos; group. If it is yours and you would rather it were not here, you can remove it until {IMPORTED_NOTICE_LAST_DAY}.
        </p>
      ) : null}
      {open ? (
        <>
          <label className="og-community-action__label" htmlFor="remove-reason">Why? (optional)</label>
          <textarea id="remove-reason" className="og-community-action__reason" maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
          <p>
            <b>{name}</b> comes down for everyone straight away.
          </p>
          <div className="og-community-action__row">
            <button
              type="button"
              className="og-primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                removeCommunityRoute(routeId, reason).then(
                  () => setRemoved(true),
                  (caught: unknown) => {
                    setError(message(caught));
                    setBusy(false);
                  },
                );
              }}
            >
              {busy ? "Removing…" : "Remove this route"}
            </button>
            <button type="button" className="og-secondary" disabled={busy} onClick={() => setOpen(false)}>Keep it</button>
          </div>
          {error === null ? null : <p role="alert" className="og-community-action__error">{error}</p>}
        </>
      ) : (
        <button type="button" className="og-secondary" onClick={() => setOpen(true)}>Remove this route</button>
      )}
    </section>
  );
}
