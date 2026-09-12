import { describe, expect, test } from "bun:test";
import { reviewCheckRunPayload } from "@/lib/review-check";

describe("review check lifecycle", () => {
  test("models queued to in_progress to completed", () => {
    expect(reviewCheckRunPayload("queued").status).toBe("queued");
    expect(reviewCheckRunPayload("in_progress").status).toBe("in_progress");
    expect(reviewCheckRunPayload("completed", "success").conclusion).toBe("success");
  });
  test("models a failed check without exposing the original error", () => {
    const payload = reviewCheckRunPayload("completed", "failure", "Review generation failed. Please retry the pull request review.");
    expect(payload.conclusion).toBe("failure");
    expect(payload.output.summary).not.toContain("/Users/");
  });
});
