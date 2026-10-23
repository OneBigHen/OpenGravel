"use client";

import Link from "next/link";
import { useState } from "react";

import { CommunityRouteError, removeCommunityRoute } from "@/application/community/route-sharing-client";
import { ownerTokenFor } from "@/ui/community/community-owner-token";
import { hiddenRouteIds, setRouteHidden } from "@/ui/explore/hidden-routes";
export { ShareWithEveryone } from "@/ui/community/GroupRouteShare";

function message(caught: unknown): string {
  return caught instanceof CommunityRouteError ? caught.message : "Something went wrong. Try again.";
}

/**
 * The device that shared a route can remove it. The share response minted a
 * removal secret; without it a rider can only hide the route for themselves,
 * because the catalog and other riders' shares have no owner on this device.
 */
export function RemoveRoute({ routeId, name }: { readonly routeId: string; readonly name: string }) {
  const [ownerToken] = useState(() => ownerTokenFor(routeId));
  return ownerToken === null
    ? <HideOnThisDevice routeId={routeId} />
    : <OwnerRemoval routeId={routeId} name={name} ownerToken={ownerToken} />;
}

function OwnerRemoval({ routeId, name, ownerToken }: {
  readonly routeId: string;
  readonly name: string;
  readonly ownerToken: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (removed) {
    return (
      <p className="og-community-action" role="status">
        Removed from Explore for everyone. <Link href="/explore">Back to Explore</Link>
      </p>
    );
  }
  return (
    <section className="og-community-action" aria-label="Remove this route">
      <p>
        You shared this route from this device. Removing it hides it for everyone on Explore, and the site owner is emailed a restore link.
      </p>
      {open ? (
        <>
          <label className="og-community-action__label" htmlFor="remove-reason">Why? (optional)</label>
          <textarea id="remove-reason" className="og-community-action__reason" maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
          <p>
            <b>{name}</b> will come off Explore for everyone straight away.
          </p>
          <div className="og-community-action__row">
            <button
              type="button"
              className="og-primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                removeCommunityRoute(routeId, reason, ownerToken).then(
                  () => setRemoved(true),
                  (caught: unknown) => {
                    setError(message(caught));
                    setBusy(false);
                  },
                );
              }}
            >
              {busy ? "Removing…" : "Remove for everyone"}
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

function HideOnThisDevice({ routeId }: { readonly routeId: string }) {
  const [hidden, setHidden] = useState(() => hiddenRouteIds().has(routeId));
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="og-community-action" aria-label="Hide this route on this device">
      <p>
        This route stays on Explore for everyone. Hiding it only changes what you see on this device.
      </p>
      <button
        type="button"
        className="og-secondary"
        onClick={() => {
          const next = !hidden;
          if (setRouteHidden(routeId, next)) {
            setHidden(next);
            setError(null);
          } else {
            setError("Your browser did not keep that setting.");
          }
        }}
      >
        {hidden ? "Show on my Explore" : "Hide from my Explore"}
      </button>
      {error !== null ? <p role="alert" className="og-community-action__error">{error}</p> : null}
      {error === null && hidden ? <p role="status">Hidden on this device.</p> : null}
    </section>
  );
}
