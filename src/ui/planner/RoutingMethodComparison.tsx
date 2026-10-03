"use client";

import { useId, useState } from "react";

import type {
  RoutingComparisonVm,
  RoutingMethodVm,
} from "@/application/planner/routing-method-comparison";
import type { RouteCandidateId } from "@/domain/route/ids";

export interface RoutingMethodComparisonProps {
  readonly model: RoutingComparisonVm;
  readonly onSelect: (routeId: RouteCandidateId) => void;
}

const METHOD_ORDER: readonly RoutingMethodVm["id"][] = [
  "classic",
  "frontier",
  "sustained-curves",
];

function orderedMethods(methods: readonly RoutingMethodVm[]): readonly RoutingMethodVm[] {
  return METHOD_ORDER.flatMap((id) => {
    const method = methods.find((candidate) => candidate.id === id);
    return method === undefined ? [] : [method];
  });
}

function addedTimeLabel(minutes: number | null, reference: RoutingMethodVm["addedTimeReference"]): string | null {
  if (minutes === null) return null;
  const baseline = reference === "loop-comparison" ? "fastest loop comparison" : "fastest shown";
  if (minutes === 0) return `Same estimated time as ${baseline}`;
  return `${minutes > 0 ? "+" : ""}${minutes} min vs ${baseline}`;
}

function confidenceLabel(confidence: number | null): string | null {
  if (confidence === null || !Number.isFinite(confidence)) return null;
  return `Model confidence (uncalibrated): ${Math.round(confidence * 100)}%`;
}

function routeActionLabel(
  method: RoutingMethodVm,
  selectedRouteId: RouteCandidateId | null,
  stale: boolean,
): string {
  if (method.routeId !== null && method.routeId === selectedRouteId) return "Already selected";
  if (stale) return "Unavailable while plan updates";
  return "Unavailable for this plan";
}

function canApply(
  method: RoutingMethodVm,
  selectedRouteId: RouteCandidateId | null,
  stale: boolean,
): boolean {
  return method.routeId !== null && method.routeId !== selectedRouteId && !stale;
}

function JevRead({
  model,
  selectedRouteId,
  stale,
  onSelect,
}: {
  readonly model: RoutingComparisonVm["jev"];
  readonly selectedRouteId: RouteCandidateId | null;
  readonly stale: boolean;
  readonly onSelect: (routeId: RouteCandidateId) => void;
}) {
  if (model.state === "unavailable") {
    return (
      <section className="og-routing-methods__jev" aria-labelledby="og-routing-methods-jev-heading">
        <h3 id="og-routing-methods-jev-heading">Jev&apos;s read</h3>
        <p>No Jev reading for this plan. Routing still works.</p>
      </section>
    );
  }

  const assessedRouteIsSelectable =
    model.routeId !== null && model.routeId !== selectedRouteId && !stale;
  const actionLabel = model.routeId === selectedRouteId
    ? "Already selected"
    : stale
      ? "Unavailable while plan updates"
      : "Show assessed route";

  return (
    <section className="og-routing-methods__jev" aria-labelledby="og-routing-methods-jev-heading">
      <h3 id="og-routing-methods-jev-heading">Jev&apos;s read</h3>
      <p className="og-routing-methods__advisory">Jev&apos;s read is advisory only.</p>
      <p>A model reading of one already scored route, using aggregate measurements. It does not create routes or choose your ride.</p>
      {model.label === null ? null : <p>{model.label}</p>}
      {confidenceLabel(model.confidence) === null ? null : (
        <p className="og-routing-methods__confidence">{confidenceLabel(model.confidence)}</p>
      )}
      {model.model === null ? null : <p className="og-routing-methods__model">Model: {model.model}</p>}
      {model.routeId === null ? null : (
        <button
          type="button"
          className="og-routing-methods__action og-routing-methods__jev-action"
          disabled={!assessedRouteIsSelectable}
          onClick={() => {
            if (assessedRouteIsSelectable && model.routeId !== null) onSelect(model.routeId);
          }}
        >
          {actionLabel}
        </button>
      )}
      <p className="og-routing-methods__boundary">No road facts or safety claims are added by this reading.</p>
    </section>
  );
}

function MethodOption({
  method,
  active,
  selectedRouteId,
  stale,
  groupName,
  onActivate,
  onSelect,
}: {
  readonly method: RoutingMethodVm;
  readonly active: boolean;
  readonly selectedRouteId: RouteCandidateId | null;
  readonly stale: boolean;
  readonly groupName: string;
  readonly onActivate: () => void;
  readonly onSelect: (routeId: RouteCandidateId) => void;
}) {
  const methodId = `routing-method-${method.id}`;
  const actionEnabled = canApply(method, selectedRouteId, stale);
  const actionLabel = actionEnabled
    ? "Show this route"
    : routeActionLabel(method, selectedRouteId, stale);

  return (
    <article className="og-routing-methods__option" data-testid={methodId} data-active={active}>
      <label className="og-routing-methods__choice">
        <input
          type="radio"
          name={groupName}
          value={method.id}
          checked={active}
          onChange={onActivate}
        />
        <span className="og-routing-methods__choice-copy">
          <span className="og-routing-methods__label">{method.label}</span>
          <span className="og-routing-methods__summary">{method.summary}</span>
        </span>
      </label>
      {active ? (
        <div className="og-routing-methods__detail" aria-live="polite">
          {method.routeLabel === null ? null : (
            <p className="og-routing-methods__route-label">Candidate: {method.routeLabel}</p>
          )}
          {addedTimeLabel(method.addedMinutes, method.addedTimeReference) === null ? null : (
            <p className="og-routing-methods__delta">{addedTimeLabel(method.addedMinutes, method.addedTimeReference)}</p>
          )}
          {method.caveat === null ? null : (
            <p className="og-routing-methods__caveat">{method.caveat}</p>
          )}
          <button
            type="button"
            className="og-routing-methods__action"
            disabled={!actionEnabled}
            onClick={() => {
              if (actionEnabled && method.routeId !== null) onSelect(method.routeId);
            }}
          >
            {actionLabel}
          </button>
          <details className="og-routing-methods__why">
            <summary>Why this route?</summary>
            {method.detail.split("\n\n").map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </details>
        </div>
      ) : null}
    </article>
  );
}

export function RoutingMethodComparison({ model, onSelect }: RoutingMethodComparisonProps) {
  const methods = orderedMethods(model.methods);
  const [open, setOpen] = useState(false);
  const [activeMethodId, setActiveMethodId] = useState<RoutingMethodVm["id"] | null>(methods[0]?.id ?? null);
  const activeMethod = methods.find((method) => method.id === activeMethodId) ?? methods[0] ?? null;
  const groupName = useId();
  const detailsId = `${groupName}-details`;

  if (methods.length === 0) return null;

  return (
    <details
      className="og-routing-methods"
      data-testid="routing-method-comparison"
      open={open}
    >
      <summary
        className="og-routing-methods__summary-toggle"
        aria-controls={detailsId}
        onClick={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
        }}
      >
        <span>Compare routing methods</span>
        {open ? <span className="og-routing-methods__experimental">Experimental</span> : null}
      </summary>
      <div id={detailsId} className="og-routing-methods__body">
        {model.stale ? (
          <p className="og-routing-methods__stale" role="status">
            Showing the previous ride while this plan updates. Replan before comparing.
          </p>
        ) : null}
        <p className="og-routing-methods__guidance">
          These methods compare the valid routes from the same search. They can choose the same route. Change Ride style and replan to search different roads.
        </p>
        <fieldset className="og-routing-methods__list">
          <legend className="og-visually-hidden">Routing methods</legend>
          {methods.map((method) => (
            <MethodOption
              key={method.id}
              method={method}
              active={activeMethod?.id === method.id}
              selectedRouteId={model.selectedRouteId}
              stale={model.stale}
              groupName={groupName}
              onActivate={() => setActiveMethodId(method.id)}
              onSelect={onSelect}
            />
          ))}
        </fieldset>
        <JevRead
          model={model.jev}
          selectedRouteId={model.selectedRouteId}
          stale={model.stale}
          onSelect={onSelect}
        />
        <details className="og-routing-methods__how">
          <summary>How these options work</summary>
          <div className="og-routing-methods__how-copy">
            <p>Maps estimate bends, not safety. Traffic and junction evidence may be unknown.</p>
            <p>Library corridor routing still needs licensed contiguous road data and verified connectors before it can run here.</p>
            <p>Ride Arc is a diagnostic that requires ordered evidence; it cannot yet claim good-road minutes.</p>
            <p>Methods are not access or surface proof. Check the existing route warnings before riding.</p>
          </div>
        </details>
      </div>
    </details>
  );
}
