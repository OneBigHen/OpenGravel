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
    "roads I haven't ridden",
    "use familiar roads today",
    "find never ridden backroads",
  ])("reads %j as a ride", (text) => {
    expect(readQuery(text)).toBe("ride");
  });

  it.each(["Jim Thorpe", "Hawk Mountain Sanctuary", "Sample Cafe", "123 Main St", "Mountain Road", "Wawa"])(
    "reads %j as a place, or at most offers the advisor after places",
    (text) => {
      expect(readQuery(text)).not.toBe("ride");
    },
  );

  it.each([
    // An address is a place however many words it has.
    "1234 Old Mill Gap Road, Stroudsburg, PA 18360",
    "1234 Old Mill Gap Road",
    "Turkey Hill, 100 Main Street, Doylestown, PA",
    "Jim Thorpe, PA 18229",
    "jim thorpe, pa",
    // A street called "Scenic Drive" is still a street.
    "100 Scenic Drive, Stroudsburg, PA",
  ])("reads the address %j as a place", (text) => {
    expect(readQuery(text)).toBe("place");
  });

  it("keeps the advisor after the places when a ride word and a town are both present", () => {
    expect(readQuery("twisty loop near Jim Thorpe, PA")).toBe("maybe");
  });

  it.each(["coffee shop, Jim Thorpe PA", "coffee shop Jim Thorpe"])(
    "does not read the business search %j as a ride description",
    (text) => {
      expect(readQuery(text)).not.toBe("ride");
    },
  );

  it("offers the advisor after places when it could be either", () => {
    expect(readQuery("twisty loop")).toBe("maybe");
    expect(readQuery("new roads")).toBe("maybe");
    // "Loop Road" is a street: the word alone is not a ride signal.
    expect(readQuery("Loop Road")).toBe("place");
    expect(readQuery("Jim")).toBe("place");
  });
});

describe("ride phrases", () => {
  it.each([
    "loop from Jim Thorpe, leave at 8",
    "ride from Doylestown to the coast",
    "lunch stop in Jim Thorpe",
    "leave by 9 and back by lunch",
  ])("reads %s as a ride", (text) => {
    expect(readQuery(text)).toBe("ride");
  });

  it.each(["Loop Road", "Lunch Box Cafe, Easton PA", "Ride Shop, Stroudsburg, PA"])("keeps %s a place", (text) => {
    expect(readQuery(text)).not.toBe("ride");
  });
});
