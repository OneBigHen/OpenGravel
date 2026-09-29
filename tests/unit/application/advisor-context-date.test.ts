import { afterEach, describe, expect, it, vi } from "vitest";

import { advisorContextFromDocument, parseAdvisorRequest } from "@/application/advisor/advisor-proposal";
import { createRideDocument } from "@/domain/ride/create";

describe("advisor context date", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends an ISO local date the server accepts, even where en-CA formats as MM/DD/YYYY (WebKit)", () => {
    const original = Intl.DateTimeFormat;
    // WebKit's "en-CA" answer. The context must not depend on any locale's
    // whole-date pattern.
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function webkitLike(locale?: string | string[], options?: Intl.DateTimeFormatOptions) {
      const real = new original(locale, options);
      if (locale !== "en-CA") return real;
      return Object.assign(Object.create(real) as Intl.DateTimeFormat, { format: () => "09/26/2026" });
    } as unknown as typeof Intl.DateTimeFormat);

    const document = createRideDocument({ now: "2026-09-26T05:40:00.000Z" });
    const context = advisorContextFromDocument(document, { now: new Date("2026-09-26T05:40:00.000Z"), timeZone: "America/New_York" });

    expect(context.localDate).toBe("2026-09-26");
    expect(parseAdvisorRequest({ prompt: "2 hour twisty loop", rideId: document.rideId, baseRevision: 0, context })).not.toBeNull();
  });

  it("uses the rider's time zone for the date", () => {
    const document = createRideDocument({ now: "2026-09-26T02:00:00.000Z" });
    const context = advisorContextFromDocument(document, { now: new Date("2026-09-26T02:00:00.000Z"), timeZone: "America/New_York" });
    expect(context.localDate).toBe("2026-09-25");
  });
});
