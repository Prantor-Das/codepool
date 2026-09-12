"use server";

import { inngest } from "@/inngest/client";
import { prisma } from "@/src/prisma/db";
import { getPullRequestDiff } from "@/module/github/lib/github";

export async function reviewPullRequest(
  owner: string,
  repo: string,
  prNumber: number,
) {
  try {
    const repository = await prisma.orm.public.Repository.where({
      owner,
      name: repo,
    }).first();

    if (!repository) {
      throw new Error("Repository not found");
    }

    const githubAccount = await prisma.orm.public.Account.where({
      userId: repository.userId,
      providerId: "github",
    }).first();

    if (!githubAccount?.accessToken) {
      throw new Error("GitHub access token missing");
    }

    const token = githubAccount.accessToken;

    // Fetch PR metadata (used for validation / future UI)
    await getPullRequestDiff(token, owner, repo, prNumber);

    // Send async job to Inngest
    await inngest.send({
      name: "pr.review.requested",
      data: {
        owner,
        repo,
        prNumber,
        userId: repository.userId,
      },
    });

    return {
      success: true,
      message: "Review queued",
    };
  } catch (error) {
    try {
      const repository = await prisma.orm.public.Repository.where({
        owner,
        name: repo,
      }).first();

      if (repository) {
        await prisma.orm.public.Review.create({
          repositoryId: repository.id,
          prNumber,
          prTitle: "Failed to fetch PR",
          prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
          review:
            error instanceof Error
              ? error.message
              : "Unknown error occurred while fetching PR",
          status: "failed",
        });
      }
    } catch (dbError) {
      console.error("Failed to store failed review:", dbError);
    }

    return {
      success: false,
      message: "Failed to queue review",
    };
  }
}
