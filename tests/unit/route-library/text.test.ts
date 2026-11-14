import { describe, expect, it } from "vitest";

import { milesInText } from "@/application/route-library/ride-detail";

describe("miles in source text", () => {
  it("turns kilometers into miles and leaves other words alone", () => {
    expect(milesInText("19 km run — Cool road")).toBe("12 mi run — Cool road");
    expect(milesInText("BBR 2.5/5; 18.9 km measured")).toBe("BBR 2.5/5; 12 mi measured");
    expect(milesInText("a short 3 km hop")).toBe("a short 1.9 mi hop");
    expect(milesInText("limit 90 km/h")).toBe("limit 90 km/h");
    expect(milesInText("no distance here")).toBe("no distance here");
  });
});
