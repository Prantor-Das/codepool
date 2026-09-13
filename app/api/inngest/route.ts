import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import { buildRepositoryGraph, buildSandbox, expireStaleReviewChecks, indexRepo, ingestMergedPullRequestGraph, pollRepositories, publishDifferentialEvidenceComment, requestDifferentialRun, runDifferential, syncRepositoryHistory } from "./functions";
import { generateReview } from "./functions/review";
import { classifyHistoricalBugFix, extractHistoricalAntibody, extractHistoricalInvariant, mineHistoricalBugFixes } from "./functions/history";
import { receivePullRequestFeedback } from "./functions/feedback";

// Create an API that serves zero functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [indexRepo, generateReview, pollRepositories, expireStaleReviewChecks, syncRepositoryHistory, buildRepositoryGraph, ingestMergedPullRequestGraph, buildSandbox, requestDifferentialRun, runDifferential, publishDifferentialEvidenceComment, mineHistoricalBugFixes, classifyHistoricalBugFix, extractHistoricalAntibody, extractHistoricalInvariant, receivePullRequestFeedback],
});
