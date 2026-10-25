import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGarage, snapshotOf } from "@/application/garage/garage-model";
import { RideBikeControl } from "@/ui/planner/PlannerPreparation";

afterEach(() => cleanup());

describe("ride bike control", () => {
  it("shows the ride snapshot and emits one replacement snapshot when changed", () => {
    const garage = createGarage();
    const shortBike = {
      ...garage.bikes[0]!, id: "bike_short", name: "Trail bike", fuelRangeMiles: 60, reserveMiles: 10,
    };
    const onChange = vi.fn();
    render(<RideBikeControl bike={snapshotOf(shortBike)} bikes={[...garage.bikes, shortBike]} onChange={onChange} />);
    // The range the ride can use before its reserve, and nothing else: the
    // fuel line below the chips already reads the tank against the route.
    expect(screen.getByText("Trail bike · 50 mi range", { selector: ".og-prepare__bike > span" })).toBeInTheDocument();
    expect(screen.queryByText(/reserve/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Change bike for this ride"), { target: { value: garage.bikes[0]!.id } });
    expect(onChange).toHaveBeenCalledWith(snapshotOf(garage.bikes[0]!));
  });
});
