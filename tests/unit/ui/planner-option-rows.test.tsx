import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlannerOptionRows } from "@/ui/planner/PlannerOptionRows";

afterEach(cleanup);

it("opens a named route control and explains when road spans need a route", () => {
  const select = vi.fn();
  render(<PlannerOptionRows values={{ style: "Curvy", surface: "Mixed", time: "Loop", traffic: "Avoid tolls", stops: "2", areas: "1", roads: "0", sketch: "None" }} hasRoute={false} onSelect={select} />);
  fireEvent.click(screen.getByRole("button", { name: /Stops/ }));
  expect(select).toHaveBeenCalledWith("stops");
  expect(screen.getByRole("button", { name: /Road spans/ })).toBeDisabled();
  expect(screen.getByText("Plan a route first")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Bike/ })).toHaveAttribute("href", "/settings#settings-bikes-title");
});
