"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function OwnerRevoke({ shareId }: { shareId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function revoke() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/shares/${encodeURIComponent(shareId)}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("This link could not be revoked. Try again when online.");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Revocation failed."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Your share link">
    <p>You created this link in this browser. You can remove its public snapshot.</p>
    <button className="og-secondary" disabled={busy} onClick={() => { void revoke(); }}>Revoke this link</button>
    {error !== null && <p role="alert">{error}</p>}
  </section>;
}
