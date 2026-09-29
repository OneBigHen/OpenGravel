import { describe, expect, it } from "vitest";

import {
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_WINDOW_MS,
  FEEDBACK_WRITE_LIMIT,
  SQLiteFeedbackStore,
  handleFeedbackPost,
} from "@/server/feedback/feedback-store";

describe("rider feedback", () => {
  it("stores a note with its optional reply address and lists newest first", () => {
    const store = new SQLiteFeedbackStore(":memory:");
    expect(handleFeedbackPost({ message: "Loop button did nothing", contact: "a@b.c", page: "/" }, store, "1.2.3.4", "UA").status).toBe(201);
    expect(handleFeedbackPost({ message: "Second note" }, store, "1.2.3.4", null).status).toBe(201);
    const [latest, first] = store.list();
    expect(latest?.message).toBe("Second note");
    expect(latest?.contact).toBeNull();
    expect(first).toMatchObject({ message: "Loop button did nothing", contact: "a@b.c", page: "/", userAgent: "UA" });
  });

  it("refuses an empty note and caps an overlong one", () => {
    const store = new SQLiteFeedbackStore(":memory:");
    expect(handleFeedbackPost({ message: "  " }, store, "1.2.3.4", null).status).toBe(400);
    expect(handleFeedbackPost("nope", store, "1.2.3.4", null).status).toBe(400);
    expect(handleFeedbackPost({ message: "x".repeat(FEEDBACK_MESSAGE_MAX + 50) }, store, "1.2.3.4", null).status).toBe(201);
    expect(store.list()[0]?.message).toHaveLength(FEEDBACK_MESSAGE_MAX);
  });

  it("caps writes per address inside the window, and lets them through after it", () => {
    let now = new Date("2026-09-28T12:00:00Z");
    const store = new SQLiteFeedbackStore(":memory:", { now: () => now });
    for (let i = 0; i < FEEDBACK_WRITE_LIMIT; i += 1) {
      expect(handleFeedbackPost({ message: `note ${i}` }, store, "9.9.9.9", null).status).toBe(201);
    }
    expect(handleFeedbackPost({ message: "one more" }, store, "9.9.9.9", null).status).toBe(429);
    // Another address is not affected.
    expect(handleFeedbackPost({ message: "someone else" }, store, "8.8.8.8", null).status).toBe(201);
    now = new Date(now.getTime() + FEEDBACK_WINDOW_MS + 1_000);
    expect(handleFeedbackPost({ message: "later" }, store, "9.9.9.9", null).status).toBe(201);
  });
});
