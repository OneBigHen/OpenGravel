import { describe, expect, it } from "vitest";

import { readQuery } from "@/application/advisor/ride-description";

describe("readQuery: a ride or a place?", () => {
  it.each([
    "2 hour twisty loop",
    "2h of backroads",
    "90 min ride",
    "twisty backroads from Jim Thorpe, no highways",
    "loop from here back by 5",
    "somewhere nice for lunch about an hour away",
    "60 miles of gravel",
  ])("reads %j as a ride", (text) => {
    expect(readQuery(text)).toBe("ride");
  });

  it.each(["Jim Thorpe", "Hawk Mountain Sanctuary", "Sample Cafe", "123 Main St", "Mountain Road", "Wawa"])(
    "reads %j as a place, or at most offers the advisor after places",
    (text) => {
      expect(readQuery(text)).not.toBe("ride");
    },
  );

  it("offers the advisor after places when it could be either", () => {
    expect(readQuery("twisty loop")).toBe("maybe");
    expect(readQuery("Loop Road")).toBe("maybe");
    expect(readQuery("Jim")).toBe("place");
  });
});
