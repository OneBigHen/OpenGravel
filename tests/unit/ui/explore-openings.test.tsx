import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExplorePanel } from "@/ui/explore/ExplorePanel";

describe("Explore weekend intelligence", () => {
  it("offers road openings plus things and places as a first-class Explore lens", () => {
    render(<ExplorePanel entries={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Openings" }));
    expect(screen.getByRole("heading", { name: "What is worth riding to?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show weekend ideas near me" })).toBeInTheDocument();
  });
});
