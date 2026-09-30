import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdvisorProposalClient } from "@/application/advisor";
import type { AdvisorDraft } from "@/application/advisor/advisor-proposal";
import type { PlaceSearchPort } from "@/application/geocoding/place-search";
import { createRideDocument } from "@/domain/ride/create";
import type { RideDocument } from "@/domain/ride/types";
import { PlaceSearchField } from "@/ui/planner/PlaceSearchField";
import { AdvisorInline, RideAdvisorProvider, useRideAdvisor, type AdvisorAppliedNext } from "@/ui/planner/RideAdvisor";
import { createRideDocumentStore } from "@/ui/stores/ride-document-store";

afterEach(() => cleanup());

function jimThorpeLoop(document: RideDocument): AdvisorDraft {
  return {
    rideId: document.rideId, baseRevision: document.revision, localDate: "2026-09-26", timeZone: "America/New_York",
    outcome: "proposal", clarification: null,
    fields: {
      shape: "loop", startPlace: "Jim Thorpe", finishPlace: null, stopPlace: null, stopArrivalIntent: null,
      rideTimeKind: "budget", rideTimeMinutes: 120, rideTimeDate: null, rideTimeLocalTime: null,
      roadCharacter: "backroads", noveltyPreference: null, surfacePreference: null, terrainLevel: null, avoidHighways: true, tollPolicy: null,
      departureKind: "unchanged", departureLocalDate: null, departureLocalTime: null,
    },
    resolvedPlaces: {
      start: { id: "photon:1", label: "Jim Thorpe, PA", name: "Jim Thorpe", context: "Carbon County, PA", coordinate: { lat: 40.8759, lon: -75.7324 }, provider: "photon" },
      finish: null, stop: null,
    },
    notes: [],
  };
}

function places(): PlaceSearchPort & { search: ReturnType<typeof vi.fn> } {
  return {
    search: vi.fn(async () => ({ status: "ok" as const, places: [] })),
    reverse: vi.fn(async () => null),
  };
}

/** The finish box the composer renders, wired to the provider's advisor. */
function WhereTo({ port }: { readonly port: PlaceSearchPort }) {
  const advisor = useRideAdvisor();
  return (
    <PlaceSearchField
      slot="finish"
      search={port}
      onPick={() => undefined}
      {...(advisor === null ? {} : { describe: advisor.ask })}
    />
  );
}

function setup(options: { readonly enabled?: boolean; readonly onApplied?: () => AdvisorAppliedNext } = {}) {
  const store = createRideDocumentStore({ document: createRideDocument() });
  const client: AdvisorProposalClient = {
    request: vi.fn(async () => ({ ok: true as const, draft: jimThorpeLoop(store.getState().document) })),
  };
  const port = places();
  render(
    <RideAdvisorProvider enabled={options.enabled ?? true} store={store} client={client} {...(options.onApplied === undefined ? {} : { onApplied: options.onApplied })}>
      <WhereTo port={port} />
      <AdvisorInline />
    </RideAdvisorProvider>,
  );
  return { store, client, port };
}

describe("one box for where to and describe a ride", () => {
  it("is a plain place search when the deployment has no advisor", () => {
    setup({ enabled: false });
    const box = screen.getByTestId("finish-search");
    expect(box).toHaveAttribute("placeholder", "Where to?");
    fireEvent.change(box, { target: { value: "2 hour twisty loop" } });
    expect(screen.queryByTestId("place-option-describe")).toBeNull();
    expect(screen.queryByTestId("advisor-inline")).toBeNull();
  });

  it("offers Plan this ride for a description, and never geocodes it", async () => {
    const { port, client } = setup();
    const box = screen.getByTestId("finish-search");
    expect(box).toHaveAttribute("placeholder", "Where to, or a ride idea");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "2 hours of backroads from Jim Thorpe" } });
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Plan this ride");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(client.request).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(port.search).not.toHaveBeenCalled();
  });

  it("shows the proposal in rider words and plans it on one tap", async () => {
    const onApplied = vi.fn((): AdvisorAppliedNext => ({ kind: "planning" }));
    const { store } = setup({ onApplied });
    const box = screen.getByTestId("finish-search");
    fireEvent.change(box, { target: { value: "2h of backroads from Jim Thorpe, no highways" } });
    fireEvent.keyDown(box, { key: "Enter" });

    const proposal = await screen.findByTestId("advisor-proposal");
    expect(proposal).toHaveTextContent("Loop");
    expect(proposal).toHaveTextContent("From Jim Thorpe, PA");
    expect(proposal).toHaveTextContent("2 hours");
    expect(proposal).toHaveTextContent("Backroads");
    expect(proposal).toHaveTextContent("No highways");
    fireEvent.click(screen.getByRole("button", { name: "Plan it" }));

    expect(onApplied).toHaveBeenCalledOnce();
    expect(store.getState().document.intent.shape).toBe("loop");
    await waitFor(() => expect(screen.queryByTestId("advisor-inline")).toBeNull());
  });

  it("names the point still missing after applying", async () => {
    setup({ onApplied: () => ({ kind: "needs-point", point: "finish" }) });
    const box = screen.getByTestId("finish-search");
    fireEvent.change(box, { target: { value: "2h of backroads from Jim Thorpe" } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "Plan it" }));
    expect(await screen.findByText("Now set your destination to plan this ride.")).toBeInTheDocument();
  });
});
