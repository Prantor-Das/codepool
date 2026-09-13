import {
  getPullRequestDiff,
  postReviewComment,
  updateReviewCheckRun,
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
    triggers: [{ event: "pr.review.requested" }],
  },
  // jbnj

  async ({ event, step }) => {
    const { owner, repo, prNumber, userId, repositoryId, checkRunId } = event.data;

    const reviewUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
    const reviewRecordId = await step.run("initialize-review", async () => {
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
          review: JSON.stringify({ kind: "check-run", checkRunId, queuedAt: new Date().toISOString() }),
        status: "pending",
      });
      return created.id;
    });

    try {
      const account = await step.run("load-github-account-for-check", () => prisma.orm.public.Account.where({ userId, providerId: "github" }).first());
      if (!account?.accessToken) throw new Error("No GitHub access token found");
      if (typeof checkRunId === "number") await step.run("mark-check-in-progress", () => updateReviewCheckRun(account.accessToken!, owner, repo, checkRunId, "in_progress"));
      const { diff, title, description, token, baseSha, headSha, labels, sandboxConfig } = await step.run(
      "fetch-pr-data",
      async () => {
        const account = await prisma.orm.public.Account.where({
          userId,
          providerId: "github",
        }).first();

        if (!account?.accessToken) {
          throw new Error("No GitHub access token found");
        }

        const data = await getPullRequestDiff(
          account.accessToken,
          owner,
          repo,
          prNumber,
        );
        let sandboxConfig = null;
        try {
          sandboxConfig = await resolveRepositorySandboxConfig(account.accessToken, owner, repo, data.baseSha);
        } catch (error) {
          console.warn("Ignoring invalid repository sandbox manifest; sandbox execution is fail-closed.", error);
        }
        return { ...data, token: account.accessToken, sandboxConfig };
      },
    );

      const context = await step.run("build-regression-judge-context", () =>
        buildRegressionJudgeContext({ repositoryId, repoSlug: `${owner}/${repo}`, title, description, diff, explicitFullVerification: labels?.includes("full-verification") === true }),
      );

      const localSandboxConfig = await step.run("resolve-local-sandbox-fallback", () => resolveLocalSandboxConfig());
      const configuredSandbox = sandboxConfig ?? localSandboxConfig;
      if (context.riskTier === "sandbox-diff-engine" && configuredSandbox) {
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

Pull request diff:
\`\`\`diff
${diff}
\`\`\`

Populate the response schema as follows:
- walkthrough: Explain the changed behavior by file, including important control or data flow. Keep it factual and brief.
- summary: State the overall intent and risk level of this change in two or three sentences.
- strengths: List only concrete, observable positives from the diff. Use an empty array when none are meaningful.
- issues: Include only actionable defects or material risks. Use severity critical/high/medium/low/info accurately. Leave empty when the change is sound.
- suggestions: Include lower-risk, actionable improvements that are directly related to the changed code. Do not duplicate issues.

For every issue and suggestion:
- file must be an exact path present in the diff; lineStart and lineEnd must identify changed lines, or the closest changed lines that introduce the concern.
- description must explain the observed problem, consequence, and relevant condition in plain language.
- fixPrompt must be self-contained and imperative. It must start by naming file:lineStart-lineEnd, state the problem in one sentence, then state the required code change and any validation/test to add. It must be ready to paste into an AI coding agent without this review.
- If the evidence is insufficient to specify an exact file and line range, omit the finding rather than guessing.

Return only valid JSON that conforms exactly to the supplied schema. Do not use Markdown, code fences, or prose outside that JSON.`;

        return await generateModelReview(prompt);
      });

      const reviewMarkdown = reviewOutputToMarkdown(review);

      await step.run("post-comment", async () => {
        await postReviewComment(token, owner, repo, prNumber, reviewMarkdown);
      });

      await step.run("save-review", async () => {
        const existing = await prisma.orm.public.Review.where({
          id: reviewRecordId,
        }).first();
        if (!existing) throw new Error("Review record was not initialized");

        await prisma.orm.public.Review.where({ id: reviewRecordId }).update({
          prNumber,
          prTitle: title,
          prUrl: reviewUrl,
          review: JSON.stringify(review),
          status: "completed",
        });

        return { saved: true };
      });

      if (typeof checkRunId === "number") await step.run("mark-check-completed", () => updateReviewCheckRun(account.accessToken!, owner, repo, checkRunId, "completed", "success", "The AI review was generated successfully."));

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
        if (account?.accessToken && typeof checkRunId === "number") await updateReviewCheckRun(account.accessToken, owner, repo, checkRunId, "completed", "failure", message);
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
