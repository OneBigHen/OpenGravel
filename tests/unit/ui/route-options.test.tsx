import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RouteOptions } from "@/ui/planner/RouteOptions";

afterEach(cleanup);

it("wraps the one ride summary and adds Options and Edit route under it (R3-4)", () => {
  const onEdit = vi.fn(), onOptions = vi.fn();
  render(<RouteOptions summary={<section data-testid="route-summary">Your ride</section>} onEdit={onEdit} onOptions={onOptions} optionsLabel="Balanced · Mixed" />);
  expect(screen.getByTestId("route-options")).toContainElement(screen.getByTestId("route-summary"));
  // A destination reads like every other ride: no second header, list or Start of its own.
  expect(screen.queryByTestId("route-options-header")).toBeNull();
  expect(screen.queryByTestId("start-ride")).toBeNull();
  fireEvent.click(screen.getByTestId("route-options-settings"));
  expect(onOptions).toHaveBeenCalledOnce();
  expect(screen.getByTestId("route-options-settings")).toHaveTextContent("Balanced · Mixed");
  fireEvent.click(screen.getByTestId("route-options-edit"));
  expect(onEdit).toHaveBeenCalledOnce();
});

it("has no offline-maps dead end", () => {
  render(<RouteOptions summary={null} />);
  expect(screen.queryByRole("link", { name: "Offline maps" })).toBeNull();
});
