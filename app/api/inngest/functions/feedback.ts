import { inngest } from "@/inngest/client";
import { applyEvidenceFeedback, type FeedbackAction } from "@/module/knowledge-graph/feedback";

export const receivePullRequestFeedback = inngest.createFunction(
  { id: "receive-pr-runtime-feedback", triggers: [{ event: "pr.feedback.received" }] },
  async ({ event, step }) => step.run("update-graph-from-human-feedback", () => applyEvidenceFeedback({
    action: event.data.action as FeedbackAction,
    antibodyId: event.data.antibodyId,
    invariantId: event.data.invariantId,
    newInvariantId: event.data.newInvariantId,
    actor: event.data.actor,
  })),
);
