import Link from "next/link";

import { AppBar } from "@/ui/nav/AppBar";

/**
 * A missing page keeps the app around it (external audit 2026-09-27): the same
 * bar and tab bar as every surface, a plain statement, and the two ways back.
 */
export default function NotFound() {
  return (
    <main id="main" className="og-library og-not-found">
      <AppBar current="" />
      <section className="og-not-found__card" aria-labelledby="not-found-title">
        <div className="og-not-found__copy">
          <p className="og-eyebrow">Page not found</p>
          <h1 id="not-found-title">This road doesn’t go anywhere.</h1>
          <p>The link may be old, or the ride was removed. Start a new plan or find one worth taking.</p>
          <div className="og-not-found__actions">
            <Link className="og-primary" href="/">Plan a ride</Link>
            <Link className="og-secondary" href="/explore">Browse Explore</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
