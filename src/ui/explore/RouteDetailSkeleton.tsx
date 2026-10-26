import Link from "next/link";

/**
 * The route page's first paint: the same frame the real page opens with — the
 * way back, the map's box, the four figures and the one action — held with
 * quiet shapes while the route's full line arrives. A rider who tapped a card
 * sees the page they asked for, not a sentence about loading.
 */
export function RouteDetailSkeleton() {
  return (
    <main id="main" className="og-route-detail og-route-detail--loading" aria-busy="true">
      <header className="og-route-detail__header">
        <Link className="og-route-detail__back" href="/explore" aria-label="Back to Explore">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <div className="og-route-detail__heading">
          <span className="og-skeleton og-route-detail-skeleton__heading" aria-hidden="true" />
        </div>
      </header>
      <p className="og-visually-hidden" role="status">Loading ride details…</p>
      <div className="og-route-detail__body" aria-hidden="true">
        <div className="og-route-detail__visual">
          <div className="og-route-detail__map">
            <span className="og-skeleton og-route-detail-skeleton__map" />
          </div>
          <div className="og-route-detail-skeleton__facts">
            {[0, 1, 2, 3].map((index) => (
              <span key={index} className="og-skeleton og-route-detail-skeleton__fact" />
            ))}
          </div>
        </div>
        <div className="og-route-detail__content">
          <span className="og-skeleton og-route-detail-skeleton__action" />
          <span className="og-skeleton og-route-detail-skeleton__line" />
          <span className="og-skeleton og-route-detail-skeleton__line og-route-detail-skeleton__line--short" />
          <span className="og-skeleton og-route-detail-skeleton__line" />
        </div>
      </div>
    </main>
  );
}
