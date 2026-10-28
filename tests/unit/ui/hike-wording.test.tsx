import { describe, expect, it } from "vitest";
import { hikeStatus } from "@/ui/planner/PlannerWorkspaceStatus";

describe("hike wording", () => {
  it("says hike where the planner says ride", () => {
    expect(hikeStatus("Ride ready.")).toBe("Hike ready.");
    expect(hikeStatus("Finding your ride…")).toBe("Finding your hike…");
    expect(hikeStatus("Planning failed — your previous ride is still shown.")).toBe("Planning failed — your previous hike is still shown.");
    expect(hikeStatus("Finding other roads…")).toBe("Checking other trails…");
    expect(hikeStatus("Riders love this")).toBe("Riders love this");
  });
});
