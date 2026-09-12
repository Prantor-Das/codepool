import { inngest } from "@/inngest/client";
import { classifyBugFix, type HistoricalPullRequest } from "@/module/knowledge-graph/history/bug-classifier";
import { extractAntibody } from "@/module/knowledge-graph/history/antibody-extractor";
import { extractInvariant } from "@/module/knowledge-graph/history/invariant-extractor";
import { writeBugFixKnowledge } from "@/module/knowledge-graph/history/bug-fix-pipeline";

export const mineHistoricalBugFixes = inngest.createFunction({ id: "mine-historical-bug-fixes", triggers: [{ event: "history.mine.requested" }] }, async ({ event, step }) => {
  const pullRequests = event.data.pullRequests as HistoricalPullRequest[];
  for (const [index, pr] of pullRequests.entries()) await step.run(`queue-bug-classification-${index}`, () => inngest.send({ name: "bug.classify", data: { pr } }));
  return { queued: pullRequests.length };
});

export const classifyHistoricalBugFix = inngest.createFunction({ id: "classify-historical-bug-fix", triggers: [{ event: "bug.classify" }] }, async ({ event, step }) => {
  const pr = event.data.pr as HistoricalPullRequest;
  const classification = await step.run("classify-merged-pr", () => classifyBugFix(pr));
  if (!classification.isBugFix) return classification;
  await step.run("queue-antibody-extraction", () => inngest.send({ name: "antibody.extract.requested", data: { pr, classification } }));
  return classification;
});

export const extractHistoricalAntibody = inngest.createFunction({ id: "extract-historical-antibody", triggers: [{ event: "antibody.extract.requested" }] }, async ({ event, step }) => {
  const pr = event.data.pr as HistoricalPullRequest;
  const antibody = await step.run("extract-antibody", () => extractAntibody(pr));
  await step.run("queue-invariant-extraction", () => inngest.send({ name: "invariant.extract.requested", data: { pr, classification: event.data.classification, antibody } }));
  return antibody;
});

export const extractHistoricalInvariant = inngest.createFunction({ id: "extract-historical-invariant", triggers: [{ event: "invariant.extract.requested" }] }, async ({ event, step }) => {
  const pr = event.data.pr as HistoricalPullRequest;
  const invariant = await step.run("extract-invariant", () => extractInvariant(pr));
  return step.run("write-bug-fix-knowledge", () => writeBugFixKnowledge(pr, event.data.classification, event.data.antibody, invariant));
});

