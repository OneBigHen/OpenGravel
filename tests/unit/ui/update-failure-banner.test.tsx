/**
 * The failed-update banner and the route-delta chip (04-PLANNER-AND-WORKSPACE-UX
 * §21, §31; 05-MAP-INTERACTION-AND-CARTOGRAPHY §12).
 *
 * These two components are the rider-facing half of the recovery model, so what is
 * pinned here is exactly what a rider and an assistive-technology user can act on:
 * the failed change is named, the failure is stated in the taxonomy's own words, the
 * three §21 actions call what they say they call, and an action the model withheld is
 * visibly disabled with a reason instead of doing nothing.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  UpdateFailure,
  UpdateRecoveryActions,
} from "@/application/planner/update-recovery";
import { RouteDeltaChip, routeDeltaText } from "@/ui/planner/RouteDeltaChip";
import { UpdateFailureBanner } from "@/ui/planner/UpdateFailureBanner";

afterEach(cleanup);

const FAILURE: UpdateFailure = {
  attemptedCommandLabel: "Move stop",
  code: "no-route",
  message: "No legal route to this destination — try another point.",
  recoverable: false,
  rideRevision: 2,
};

function actions(overrides: Partial<UpdateRecoveryActions> = {}): UpdateRecoveryActions {
  return {
    canRetry: true,
    canEdit: true,
    canDiscard: true,
    editTarget: { kind: "map", ref: { kind: "stop", stopId: "stop_1" as never } },
    ...overrides,
  };
}

function renderBanner(
  props: Partial<Parameters<typeof UpdateFailureBanner>[0]> = {},
): {
  readonly onRetry: ReturnType<typeof vi.fn>;
  readonly onEdit: ReturnType<typeof vi.fn>;
  readonly onDiscard: ReturnType<typeof vi.fn>;
} {
  const onRetry = vi.fn();
  const onEdit = vi.fn();
  const onDiscard = vi.fn();
  render(
    <UpdateFailureBanner
      failure={FAILURE}
      actions={actions()}
      onRetry={onRetry}
      onEdit={onEdit}
      onDiscard={onDiscard}
      {...props}
    />,
  );
  return { onRetry, onEdit, onDiscard };
}

describe("UpdateFailureBanner", () => {
  it("names the attempted change and states the failure without provider text", () => {
    renderBanner();

    expect(screen.getByTestId("update-failure-banner")).toBeInTheDocument();
    expect(screen.getByTestId("update-failure-label")).toHaveTextContent("Move stop");
    expect(screen.getByTestId("update-failure-message")).toHaveTextContent(
      "No legal route to this destination — try another point.",
    );
    // 04 §21: the rider is told the route is still there, in the same breath.
    expect(screen.getByTestId("update-failure-banner")).toHaveTextContent(
      "Your previous ride is still on the map.",
    );
    // The machine-readable facts a test or a future surface can read.
    const banner = screen.getByTestId("update-failure-banner");
    expect(banner.getAttribute("data-failure-code")).toBe("no-route");
    expect(banner.getAttribute("data-recoverable")).toBe("false");
  });

  it("is not a second live region: the status line announces the failure", () => {
    renderBanner();

    // 04 §9 already announces the failure through the status line's `role="status"`.
    // A second live region would read the same news twice (12 §20).
    expect(screen.getByTestId("update-failure-banner")).not.toHaveAttribute("aria-live");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("calls Retry, Edit and Discard change", () => {
    const { onRetry, onEdit, onDiscard } = renderBanner();

    fireEvent.click(screen.getByTestId("update-retry"));
    fireEvent.click(screen.getByTestId("update-edit"));
    fireEvent.click(screen.getByTestId("update-discard"));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("disables an action the model withheld, and says why", () => {
    renderBanner({
      actions: actions({ canEdit: false, canDiscard: false, editTarget: null }),
    });

    const edit = screen.getByTestId("update-edit");
    const discard = screen.getByTestId("update-discard");
    expect(edit).toBeDisabled();
    expect(discard).toBeDisabled();
    expect(edit.getAttribute("title")).toMatch(/nothing to edit/);
    expect(discard.getAttribute("title")).toMatch(/only the change this failure describes/i);
    // Retry is never withheld: 04 §21 does not precondition it.
    expect(screen.getByTestId("update-retry")).toBeEnabled();
  });

  it("keeps a disabled action's name readable to a screen reader", () => {
    renderBanner({ actions: actions({ canEdit: false, editTarget: null }) });

    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
  });
});

describe("RouteDeltaChip", () => {
  it("states both numbers, measured against the answer it replaced", () => {
    render(<RouteDeltaChip delta={{ addedMinutes: 3, addedMeters: 2_897 }} />);

    expect(screen.getByTestId("route-delta-chip")).toHaveTextContent(
      "+3 min · +1.8 mi vs previous",
    );
  });

  it("states a shorter update as a negative delta", () => {
    expect(routeDeltaText({ addedMinutes: -2, addedMeters: -580 })).toBe(
      "-2 min · -0.4 mi vs previous",
    );
  });
});
