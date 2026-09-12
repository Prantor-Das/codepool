import { inngest } from "@/inngest/client";

type ConnectedRepository = {
  id: string;
  owner: string;
  name: string;
  userId: string;
};

type OpenPullRequest = {
  number: number;
  updated_at: string;
};
import { prisma } from "@/src/prisma/db";
import { indexCodeBase } from "@/module/ai/lib/rag";
import {
  getOpenPullRequests,
  getRepoFileContents,
  updateReviewCheckRun,
} from "@/module/github/lib/github";

export const helloWorld = inngest.createFunction(
  { id: "code-horse", triggers: [{ event: "test/hello.world" }] },
  async ({ event, step }) => {
    await step.sleep("wait-a-moment", "1s");
    return { message: `Heljhblo ${event.data.email}!` };
  },
);

export const indexRepo = inngest.createFunction(
  {
    id: "index-repo",
    triggers: [{ event: "repository.connected" }],
  },
  async ({ event, step }) => {
    const { owner, repo, userId } = event.data;
    // fetch all the files

    const indexingResult = await step.run("fetch-and-index-codebase", async () => {
      const account = await prisma.orm.public.Account.where({
        userId,
        providerId: "github",
      }).first();

      if (!account?.accessToken) {
        throw new Error("No github acces token found");
      }

      const files = await getRepoFileContents(account.accessToken, owner, repo);
      const result = await indexCodeBase(`${owner}/${repo}`, files);

      return result;
    });

    return {
      success: true,
      indexedFiles: indexingResult.indexedFiles,
      failedFiles: indexingResult.failedFiles,
    };
  },
);

export const pollRepositories = inngest.createFunction(
  {
    id: "poll-repositories-for-reviews",
    // Webhooks are the primary trigger; this catches missed deliveries.
    triggers: [{ cron: "*/2 * * * *" }],
  },
  async ({ step }) => {
    const repositories = (await step.run("load-connected-repositories", () =>
      prisma.orm.public.Repository.select(
        "id",
        "owner",
        "name",
        "userId",
      ).all(),
    )) as unknown as ConnectedRepository[];

    let queued = 0;
    for (const repository of repositories) {
      const account = await step.run(
        `load-github-account-${repository.id}`,
        () =>
          prisma.orm.public.Account.where({
            userId: repository.userId,
            providerId: "github",
          }).first(),
      );
      if (!account?.accessToken) continue;

      const pullRequests = (await step.run(
        `load-open-pull-requests-${repository.id}`,
        () =>
          getOpenPullRequests(
            account.accessToken!,
            repository.owner,
            repository.name,
          ),
      )) as unknown as OpenPullRequest[];

      for (const pullRequest of pullRequests) {
        const existingReviews = await prisma.orm.public.Review.where({
          repositoryId: repository.id,
          prNumber: pullRequest.number,
        })
          .select("status", "updatedAt")
          .all();
        const latestReview = existingReviews
          .slice()
          .sort(
            (left, right) =>
              right.updatedAt.epochMilliseconds - left.updatedAt.epochMilliseconds,
          )[0];

        // Re-queue the same PR when GitHub reports a newer commit/update.
        if (
          latestReview &&
          latestReview.updatedAt.epochMilliseconds >=
            new Date(pullRequest.updated_at).getTime()
        ) {
          continue;
        }

        await inngest.send({
          name: "pr.review.requested",
          data: {
            repositoryId: repository.id,
            owner: repository.owner,
            repo: repository.name,
            prNumber: pullRequest.number,
            userId: repository.userId,
          },
        });
        queued += 1;
      }
    }

    return { success: true, queued };
  },
);

const STALE_REVIEW_MS = 30 * 60 * 1000;
export const expireStaleReviewChecks = inngest.createFunction(
  { id: "expire-stale-review-checks", triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }) => {
    const reviews = await step.run("load-pending-reviews", () => prisma.orm.public.Review.where({ status: "pending" }).all()) as unknown as Array<{ id: string; repositoryId: string; review: string }>;
    let expired = 0;
    for (const review of reviews) {
      let marker: { kind?: string; checkRunId?: number; queuedAt?: string } | null = null;
      try { marker = JSON.parse(review.review); } catch { continue; }
      if (marker?.kind !== "check-run" || typeof marker.checkRunId !== "number" || !marker.queuedAt || Date.now() - new Date(marker.queuedAt).getTime() < STALE_REVIEW_MS) continue;
      const repository = await prisma.orm.public.Repository.where({ id: review.repositoryId }).first();
      const account = repository && await prisma.orm.public.Account.where({ userId: repository.userId, providerId: "github" }).first();
      if (!repository || !account?.accessToken) continue;
      await step.run(`mark-stale-check-${review.id}`, async () => {
        await updateReviewCheckRun(account.accessToken!, repository.owner, repository.name, marker!.checkRunId!, "completed", "timed_out", "Review processing exceeded 30 minutes. Please retry the review.");
        await prisma.orm.public.Review.where({ id: review.id }).update({ status: "failed", review: "Review processing timed out. Please retry the pull request review." });
      });
      expired += 1;
    }
    return { expired };
  },
);
