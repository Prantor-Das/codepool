import {
  getGithubTokenForUser,
  getPullRequestDiff,
  postReviewComment,
  upsertReviewStatusComment,
} from "@/module/github/lib/github";
import { resolveLocalSandboxConfig, resolveRepositorySandboxConfig } from "@/module/execution/config/repository-sandbox";
import { buildRegressionJudgeContext } from "@/module/regression/judge";
import { generateReview as generateModelReview, reviewOutputToMarkdown } from "@/lib/modelscope";
import { prisma } from "@/src/prisma/db";
import { inngest } from "@/inngest/client";
import { NonRetriableError } from "inngest";

function isPermanentModelScopeAuthError(error: unknown) {
  const candidate = error as { status?: number; cause?: unknown } | undefined;
  const message = error instanceof Error ? error.message : String(error);
  const causeMessage =
    candidate?.cause instanceof Error ? candidate.cause.message : "";

  return (
    candidate?.status === 401 ||
    /(?:^|\D)401(?:\D|$)|authentication failed|valid ModelScope token/i.test(
      `${message} ${causeMessage}`,
    )
  );
}

export const generateReview = inngest.createFunction(
  {
    id: "generate-review",
    concurrency: 5,
    idempotency: "event.data.repositoryId + ':' + event.data.prNumber + ':' + event.data.headSha",
    triggers: [{ event: "pr.review.requested" }],
  },
  // jbnj

  async ({ event, step }) => {
    const { owner, repo, prNumber, userId, repositoryId } = event.data;
    let reviewHeadSha = event.data.headSha;

    const reviewUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
    const reviewRecordId = await step.run("initialize-review", async () => {
      const repository = await prisma.orm.public.Repository.where({ id: repositoryId }).first();
      if (!repository) {
        throw new NonRetriableError(
          `Cannot start review for ${owner}/${repo}#${prNumber}: repository ${repositoryId} no longer exists.`,
        );
      }
      if (repository.userId !== userId) {
        throw new NonRetriableError(
          `Cannot start review for ${owner}/${repo}#${prNumber}: repository ownership does not match the event.`,
        );
      }
      const existing = await prisma.orm.public.Review.where({
        repositoryId,
        prNumber,
      }).first();

      if (existing) {
        await prisma.orm.public.Review.where({ id: existing.id }).update({
          prTitle: "Review in progress…",
          prUrl: reviewUrl,
          status: "pending",
        });
        return existing.id;
      }

      const created = await prisma.orm.public.Review.create({
        repositoryId,
        prNumber,
        prTitle: "Review in progress…",
        prUrl: reviewUrl,
          review: JSON.stringify({ kind: "review", headSha: event.data.headSha, queuedAt: new Date().toISOString() }),
        status: "pending",
      });
      return created.id;
    });

    try {
      const account = await step.run("load-github-account-for-check", () => prisma.orm.public.Account.where({ userId, providerId: "github" }).first());
      if (!account?.accessToken) throw new Error("No GitHub access token found");
      const githubToken = await getGithubTokenForUser(userId);
      if (typeof reviewHeadSha !== "string") {
        reviewHeadSha = await step.run("resolve-review-head-sha", async () => {
          const data = await getPullRequestDiff(githubToken, owner, repo, prNumber);
          return data.headSha;
        });
      }
      // GitHub's Checks API only accepts GitHub App authentication. OAuth
      // tokens used by Codepool cannot create check runs, so the issue comment
      // below is the portable progress indicator.
      await step.run("record-review-head", async () => {
        const current = await prisma.orm.public.Review.where({ id: reviewRecordId }).first();
        if (!current) return;
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(current.review) as Record<string, unknown>; } catch { /* replace legacy marker */ }
        await prisma.orm.public.Review.where({ id: reviewRecordId }).update({
          review: JSON.stringify({ ...payload, kind: "review", headSha: reviewHeadSha, queuedAt: new Date().toISOString() }),
        });
      });
      await step.run("post-review-status", async () => {
        try {
          return await upsertReviewStatusComment(githubToken, owner, repo, prNumber, "in_progress", reviewHeadSha);
        } catch (error) {
          console.warn("Could not update review status comment; continuing review:", error);
          return null;
        }
      });
      const { diff, title, description, baseSha, headSha, labels, sandboxConfig } = await step.run(
      "fetch-pr-data",
      async () => {
        const data = await getPullRequestDiff(
          githubToken,
          owner,
          repo,
          prNumber,
        );
        let sandboxConfig = null;
        try {
          sandboxConfig = await resolveRepositorySandboxConfig(githubToken, owner, repo, data.baseSha);
        } catch (error) {
          console.warn("Ignoring invalid repository sandbox manifest; sandbox execution is fail-closed.", error);
        }
        return { ...data, sandboxConfig };
      },
    );

      const context = await step.run("build-regression-judge-context", () =>
        buildRegressionJudgeContext({ repositoryId, repoSlug: `${owner}/${repo}`, title, description, diff, explicitFullVerification: labels?.includes("full-verification") === true }),
      );

      const localSandboxConfig = await step.run("resolve-local-sandbox-fallback", () => resolveLocalSandboxConfig());
      const configuredSandbox = sandboxConfig ?? localSandboxConfig;
      // When a repository opts into a sandbox manifest, always run the base
      // and PR revisions so performanceComparison is measured rather than
      // guessed by the language model. Risk routing still controls the review
      // context, but no longer suppresses the requested differential run.
      if (configuredSandbox) {
        await step.run("request-targeted-sandbox-differential-run", () => inngest.send({
          name: "sandbox.build.requested",
          data: {
            repositoryId,
            pullRequestId: `${repositoryId}:pr:${prNumber}`,
            baseSha,
            prSha: headSha,
            fixture: configuredSandbox.fixture,
            fixtureVersion: configuredSandbox.fixtureVersion,
            scenarios: configuredSandbox.scenarios,
            replayCassette: configuredSandbox.replayCassette,
            runId: `${repositoryId}:${prNumber}:${headSha}`,
            explicitFullVerification: labels?.includes("full-verification") === true,
            owner, repo, prNumber, userId,
            judgeContext: context,
          },
        }));
      }

      const review = await step.run("generate-ai-review", async () => {
        const prompt = `You are a senior engineer reviewing a pull request. Produce a concise, high-signal review that is useful to the author and safe to act on.

Review only behavior supported by the supplied diff and repository context. Do not invent files, line numbers, APIs, requirements, vulnerabilities, test failures, or runtime behavior. Prefer a small number of specific, important findings over generic advice. Do not report style nits unless they cause a real maintainability, correctness, security, performance, or reliability concern.

PR title: ${title}
PR description: ${description || "No description provided"}

Regression Judge context (structured graph, historical failures, and semantic matches):
${JSON.stringify(context, null, 2)}

Risk routing: ${context.riskTier}. A sandbox-diff-engine tier is a regression-risk signal; do not claim a runtime failure without evidence in the diff/context.

Sandbox execution status: ${configuredSandbox ? "A differential sandbox run was requested for this pull request; measured latency will arrive in a follow-up runtime evidence comment." : "No differential sandbox run was configured or requested for this pull request; do not invent p50/p99 measurements."}

Pull request diff:
\`\`\`diff
${diff}
\`\`\`

Populate the response schema as follows:
- walkthrough: Explain the changed behavior by file, including important control or data flow. Keep it factual and brief.
- sequenceDiagram: Valid Mermaid sequenceDiagram source showing the main user, browser/client, changed server modules, data stores, and external services involved in the changed flow. Use only participants and interactions supported by the diff. Return the diagram source without Markdown fences.
- summary: State the overall intent and risk level of this change in two or three sentences.
- strengths: List only concrete, observable positives from the diff. Use an empty array when none are meaningful.
- issues: Include only actionable defects or material risks. Use severity critical/high/medium/low/info accurately. Leave empty when the change is sound.
- suggestions: Include 1-3 concrete, actionable improvements directly related to the changed code. Each suggestion must be grounded in the diff, point to an exact changed line, and include a useful implementation prompt. Do not duplicate issues. If no safe improvement exists, return an empty array and explain that in performanceComparison.
- performanceComparison: Return the literal placeholder PENDING_MEASURED_SANDBOX_COMPARISON. The application replaces this field with measured base-versus-PR sandbox p50/p99 results after the two environments finish. Never invent timings.
- masterPrompt: A single self-contained implementation prompt that combines every issue and suggestion, names exact files and line ranges, requires tests, and tells an AI coding agent how to solve the complete review. If there are no findings, provide a concise prompt to validate the change and run relevant tests.

For every issue and suggestion:
- file must be an exact path present in the diff; lineStart and lineEnd must identify changed lines, or the closest changed lines that introduce the concern.
- description must explain the observed problem, consequence, and relevant condition in plain language.
- fixPrompt must be self-contained and imperative. It must start by naming file:lineStart-lineEnd, state the problem in one sentence, then state the required code change and any validation/test to add. It must be ready to paste into an AI coding agent without this review.
- If the evidence is insufficient to specify an exact file and line range, omit the finding rather than guessing.

The response is incomplete unless it includes sequenceDiagram, performanceComparison, and masterPrompt. Do not return prose headings instead of these JSON fields.

Return only valid JSON that conforms exactly to the supplied schema. Do not use Markdown, code fences, or prose outside that JSON.`;

        const generated = await generateModelReview(prompt);
        return {
          ...generated,
          performanceComparison: configuredSandbox
            ? "Measured sandbox comparison is running for the base and PR revisions. The p50/p99 latency report will be attached when both environments complete."
            : "No repository sandbox configuration was available, so no measured performance comparison was run.",
        };
      });

      const reviewMarkdown = reviewOutputToMarkdown(review);

      await step.run("post-comment", async () => {
        await postReviewComment(githubToken, owner, repo, prNumber, reviewMarkdown);
      });

      await step.run("save-review", async () => {
        const existing = await prisma.orm.public.Review.where({
          id: reviewRecordId,
        }).first();
        if (!existing) throw new Error("Review record was not initialized");

        // The sandbox worker may finish before this AI step. Preserve its
        // measured report instead of replacing it with the initial pending
        // placeholder.
        let resolvedReview = { ...review, headSha: reviewHeadSha };
        try {
          const prior = JSON.parse(existing.review) as { performanceComparison?: unknown };
          if (
            typeof prior.performanceComparison === "string" &&
            prior.performanceComparison.trim() &&
            !prior.performanceComparison.includes("sandbox comparison is running")
          ) {
            resolvedReview = {
              ...review,
              headSha: reviewHeadSha,
              performanceComparison: prior.performanceComparison,
            };
          }
        } catch {
          // Legacy queued review payloads are replaced by the new review.
        }

        await prisma.orm.public.Review.where({ id: reviewRecordId }).update({
          prNumber,
          prTitle: title,
          prUrl: reviewUrl,
          review: JSON.stringify(resolvedReview),
          status: "completed",
        });

        return { saved: true };
      });

      await step.run("post-review-completed-status", async () => {
        try {
          return await upsertReviewStatusComment(githubToken, owner, repo, prNumber, "completed", headSha);
        } catch (error) {
          console.warn("Could not update completed review status comment:", error);
          return null;
        }
      });

      return { success: true };
    } catch (error) {
      const message = "Review generation failed. Please retry the pull request review.";
      try {
        await prisma.orm.public.Review.where({ id: reviewRecordId }).update({
          status: "failed",
          review: message,
        });
      } catch (updateError) {
        console.error("Failed to mark review as failed:", updateError);
      }

      try {
        const account = await prisma.orm.public.Account.where({ userId, providerId: "github" }).first();
        if (account?.accessToken) {
          const githubToken = await getGithubTokenForUser(userId);
          await upsertReviewStatusComment(githubToken, owner, repo, prNumber, "failed");
        }
      } catch (checkError) { console.error("Failed to update review check run:", checkError); }

      if (isPermanentModelScopeAuthError(error)) {
        console.error(
          "Review stopped without retry: ModelScope authentication failed. Replace MODELSCOPE_ACCESS_TOKEN/MODELSCOPE_API_KEY.",
        );
        throw new NonRetriableError(
          `Review stopped without retry: ${message}`,
          { cause: error },
        );
      }

      throw error;
    }
  },
);
