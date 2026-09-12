"use server";

import { inngest } from "@/inngest/client";
import { prisma } from "@/src/prisma/db";

const MAX_PENDING_REVIEWS_PER_USER = 5;

export async function reviewPullRequest(
  owner: string,
  repo: string,
  prNumber: number,
) {
  const repository = await prisma.orm.public.Repository.where({
    owner,
    name: repo,
  }).first();

  if (!repository) {
    throw new Error("Repository not found");
  }

  const userRepositories = await prisma.orm.public.Repository.where({
    userId: repository.userId,
  })
    .select("id")
    .all();
  const userRepositoryIds = new Set(
    userRepositories.map((userRepository) => userRepository.id),
  );
  const pendingReviews = await prisma.orm.public.Review.where({
    status: "pending",
  })
    .select("repositoryId")
    .all();
  const pendingReviewCount = pendingReviews.filter((review) =>
    userRepositoryIds.has(review.repositoryId),
  ).length;

  if (pendingReviewCount >= MAX_PENDING_REVIEWS_PER_USER) {
    throw new Error(
      `Review queue is full. You can have up to ${MAX_PENDING_REVIEWS_PER_USER} reviews in progress at once.`,
    );
  }

  try {
    const githubAccount = await prisma.orm.public.Account.where({
      userId: repository.userId,
      providerId: "github",
    }).first();

    if (!githubAccount?.accessToken) {
      throw new Error("GitHub access token missing");
    }

    // Queue first. The Inngest worker fetches the diff and records any
    // GitHub/API failure on the Review row. Fetching the diff here as a
    // preflight could prevent the event from ever reaching Inngest.
    await inngest.send({
      name: "pr.review.requested",
      data: {
        repositoryId: repository.id,
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
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(
      `Failed to enqueue review for ${owner}/${repo}#${prNumber}:`,
      error,
    );

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
          review: message,
          status: "failed",
        });
      }
    } catch (dbError) {
      console.error("Failed to store failed review:", dbError);
    }

    return {
      success: false,
      message,
    };
  }
}
