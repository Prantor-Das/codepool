import { inngest } from "@/inngest/client";

type ConnectedRepository = {
  id: string;
  owner: string;
  name: string;
  userId: string;
};

type OpenPullRequest = {
  number: number;
};
import { prisma } from "@/src/prisma/db";
import { indexCodeBase } from "@/module/ai/lib/rag";
import {
  getOpenPullRequests,
  getRepoFileContents,
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

    const files = await step.run("fetch-files", async () => {
      const account = await prisma.orm.public.Account.where({
        userId,
        providerId: "github",
      }).first();

      if (!account?.accessToken) {
        throw new Error("No github acces token found");
      }

      return await getRepoFileContents(account.accessToken, owner, repo);
    });

    await step.run("index-codebase", async () => {
      await indexCodeBase(`${owner}/${repo}`, files);
    });

    return { success: true, indexedFiles: files.length };
  },
);

export const pollRepositories = inngest.createFunction(
  {
    id: "poll-repositories-for-reviews",
    triggers: [{ cron: "*/5 * * * *" }],
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
        const existingReview = await prisma.orm.public.Review.where({
          repositoryId: repository.id,
          prNumber: pullRequest.number,
        }).first();
        if (existingReview) continue;

        await inngest.send({
          name: "pr.review.requested",
          data: {
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
