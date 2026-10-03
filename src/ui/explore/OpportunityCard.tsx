import type { RiderOpportunity } from "@/application/discover/rider-opportunities";

export function OpportunityCard({
  item,
  onAddStop,
  added = false,
}: {
  readonly item: RiderOpportunity;
  readonly onAddStop?: ((item: RiderOpportunity) => void) | undefined;
  readonly added?: boolean;
}) {
  return (
    <li className="og-explore-card">
      <div className="og-explore-card__body">
        <span className="og-explore-card__topline">
          <span>
            {item.kind === "event"
              ? "Event"
              : item.kind === "happy-hour"
                ? "Food & drink"
                : "Destination"}
          </span>
          <span>{item.reason}</span>
        </span>
        <strong>{item.name}</strong>
        <span className="og-explore-card__facts">
          {item.detourMinutes !== null ? (
            <span>
              {item.detourMinutes <= 1
                ? "On route"
                : `~${item.detourMinutes} min detour`}
            </span>
          ) : item.distanceMeters !== null ? (
            <span>{Math.round(item.distanceMeters / 1609.344)} mi away</span>
          ) : null}
          {item.routeMile !== null ? (
            <span>Mile {Math.round(item.routeMile)}</span>
          ) : null}
          {item.estimatedArrivalAt !== null ? (
            <span>
              Arrive about{" "}
              {new Date(item.estimatedArrivalAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          ) : null}
          {item.startsAt !== null ? (
            <span>
              Starts{" "}
              {new Date(item.startsAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          ) : null}
        </span>
        {item.description !== null ? <p>{item.description}</p> : null}
        <span className="og-explore-card__byline">{item.sourceLabel}</span>
        <div className="og-explore__actions">
          {item.url !== null ? (
            <a
              className="og-secondary"
              href={item.url}
              target="_blank"
              rel="noreferrer"
            >
              Details<span className="sr-only"> for {item.name}</span>
            </a>
          ) : null}
          {onAddStop !== undefined ? (
            <button
              type="button"
              className="og-primary"
              disabled={added}
              onClick={() => onAddStop(item)}
            >
              {added ? "Added" : "Add stop"}
              <span className="sr-only"> · {item.name}</span>
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
