import { describe, expect, it } from "vitest";

import { reverseRideCommand } from "@/ui/stores/ride-document-store";
import { createRideDocument } from "@/domain/ride/create";

describe("reverseRideCommand", () => {
  it("builds one rider ride.reverse command for the current revision", () => {
    const document = createRideDocument({ now: "2026-09-26T12:00:00.000Z", title: null, provenance: { type: "new" } });
    const command = reverseRideCommand(document);
    expect(command.type).toBe("ride.reverse");
    expect(command.label).toBe("Swap start and destination");
  });
});
