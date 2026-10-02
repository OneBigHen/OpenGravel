import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExplorePanel } from "@/ui/explore/ExplorePanel";

describe("Explore road openings", () => {
  it("offers seasonal road planning as a first-class Explore lens", () => {
    render(<ExplorePanel entries={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Openings" }));
    expect(screen.getByRole("heading", { name: "What opens next?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show openings near me" })).toBeInTheDocument();
  });
});
