import {
  getPullRequestDiff,
  postReviewComment,
} from "@/module/github/lib/github";
import { retrieveContext } from "@/module/ai/lib/rag";
import { generateReviewText } from "@/lib/modelscope";
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
    const { owner, repo, prNumber, userId, repositoryId } = event.data;

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
          review: "",
          status: "pending",
        });
        return existing.id;
      }

      const created = await prisma.orm.public.Review.create({
        repositoryId,
        prNumber,
        prTitle: "Review in progress…",
        prUrl: reviewUrl,
        review: "",
        status: "pending",
      });
      return created.id;
    });

    try {
      const { diff, title, description, token } = await step.run(
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
        return { ...data, token: account.accessToken };
      },
    );

      const context = await step.run("retrieve-context", async () => {
        const query = `${title}\n${description}`;

        return await retrieveContext(query, `${owner}/${repo}`);
      });

      const review = await step.run("generate-ai-review", async () => {
        const prompt = `You are an expert code reviewer. Analyze the following pull request and provide a detailed, constructive code review.

PR Title: ${title}
PR Description: ${description || "No description provided"}

Context from Codebase:
${context.join("\n\n")}

Code Changes:
\`\`\`diff
${diff}
\`\`\`

Please provide:
1. **Walkthrough**: A file-by-file explanation of the changes.
2. **Sequence Diagram**: A Mermaid JS sequence diagram visualizing the flow of the changes (if applicable). Use \`\`\`mermaid ... \`\`\` block. **IMPORTANT**: Ensure the Mermaid syntax is valid. Do not use special characters (like quotes, braces, parentheses) inside Note text or labels as it breaks rendering. Keep the diagram simple.
3. **Summary**: Brief overview.
4. **Strengths**: What's done well.
5. **Issues**: Bugs, security concerns, code smells.
6. **Suggestions**: Specific code improvements.
7. **Poem**: A short, creative poem summarizing the changes at the very end.

Format your response in markdown.`;

        return await generateReviewText(prompt);
      });

      await step.run("post-comment", async () => {
        await postReviewComment(token, owner, repo, prNumber, review);
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
          review,
          status: "completed",
        });

        return { saved: true };
      });

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      try {
        await prisma.orm.public.Review.where({ id: reviewRecordId }).update({
          status: "failed",
          review: message,
        });
      } catch (updateError) {
        console.error("Failed to mark review as failed:", updateError);
      }

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
