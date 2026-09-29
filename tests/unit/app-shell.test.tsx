import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlannerClient } from "@/app/PlannerClient";
import { assetBasePathFromEnv } from "@/app/asset-base-path";
import Home from "@/app/page";

import { createStubMapHostFactory } from "./support/stub-map-host";

/**
 * The composition root navigates to `/ride` when a ride starts (04 §28), so it
 * reads the app router. These tests render it outside a Next router, exactly as
 * `rides-library.test.tsx` does, and assert the routing it *would* perform only
 * where the handoff itself is under test (the Ride Focus suite).
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

/**
 * The application shell (Wave 0 → Wave 2).
 *
 * The Wave-0 placeholder shell is gone: `/` now renders the planner workspace
 * itself, so this test pins what the page must always provide — the product
 * heading, the map surface and the plan commitment — without asserting any
 * routing or session behaviour (that is the workspace's own suite).
 */
describe("application shell", () => {
  it("renders the planner workspace without any legacy planner import", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: "OpenGravel" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Find the ride worth taking.")).toBeInTheDocument();
    expect(screen.getByTestId("planner-map")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create ride" })).toBeInTheDocument();
  });
});

/**
 * The composition root (4.0 review findings 2 and 8).
 *
 * `PlannerClient` is where the UI layer and the concrete map renderer actually
 * meet, so it is the only place the deployment's asset prefix can be joined to the
 * renderer's worker URL — and the only place the renderer may be imported from the
 * UI side at all (the architecture scanner enforces the second half).
 */
describe("browser composition root", () => {
  it("normalizes the deployment prefix from the environment", () => {
    expect(assetBasePathFromEnv({})).toBe("");
    expect(assetBasePathFromEnv({ NEXT_PUBLIC_BASE_PATH: "ogv" })).toBe("/ogv");
    expect(assetBasePathFromEnv({ NEXT_PUBLIC_BASE_PATH: "/ogv/" })).toBe("/ogv");
    expect(assetBasePathFromEnv({ NEXT_PUBLIC_BASE_PATH: "/" })).toBe("");
  });

  it("hands the prefix through to the map host options", async () => {
    const factory = createStubMapHostFactory();
    render(
      <PlannerClient
        basemap="empty"
        assetBasePath="/ogv"
        mapHostFactory={factory.factory}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(factory.options[0]?.assetBasePath).toBe("/ogv");
  });
});

afterEach(() => {
  cleanup();
});
