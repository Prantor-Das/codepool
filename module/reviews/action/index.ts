"use server";

import { getFeedbackTargets } from "@/module/knowledge-graph/feedback-targets";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/src/prisma/db";

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

function serializeReview(review: {
  id: string;
  repositoryId: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  review: string;
  status: string;
  createdAt: { toString(): string };
  updatedAt: { toString(): string };
}, repositoryFullName: string) {
  return {
    ...review,
    repositoryFullName,
    createdAt: review.createdAt.toString(),
    updatedAt: review.updatedAt.toString(),
  };
}

export async function getReviews(repositoryId?: string) {
  const session = await getSession();
  const repositories = await prisma.orm.public.Repository.where({
    userId: session.user.id,
  })
    .select("id", "fullName")
    .all();

  const ownedRepositories = repositoryId
    ? repositories.filter((repository) => repository.id === repositoryId)
    : repositories;

  if (repositoryId && ownedRepositories.length === 0) {
    throw new Error("Unauthorized");
  }

  const repositoryNames = new Map(
    ownedRepositories.map((repository) => [repository.id, repository.fullName]),
  );
  if (!ownedRepositories.length) return [];
  const reviews = await prisma.orm.public.Review.where(review => review.repositoryId.in(ownedRepositories.map(repository => repository.id))).select(
    "id",
    "repositoryId",
    "prNumber",
    "prTitle",
    "prUrl",
    "review",
    "status",
    "createdAt",
    "updatedAt",
  )
    .orderBy((review) => review.createdAt.desc())
    .all();

  return reviews
    .filter((review) => repositoryNames.has(review.repositoryId))
    .map((review) =>
      serializeReview(review, repositoryNames.get(review.repositoryId)!),
    );
}

export async function getReviewById(reviewId: string) {
  const session = await getSession();
  const review = await prisma.orm.public.Review.where({ id: reviewId })
    .select(
      "id",
      "repositoryId",
      "prNumber",
      "prTitle",
      "prUrl",
      "review",
      "status",
      "createdAt",
      "updatedAt",
    )
    .first();

  if (!review) throw new Error("Review not found");

  const repository = await prisma.orm.public.Repository.where({
    id: review.repositoryId,
    userId: session.user.id,
  })
    .select("fullName")
    .first();

  if (!repository) throw new Error("Unauthorized");
  return serializeReview(review, repository.fullName);
}

export async function getReviewFeedbackTargets(reviewId: string) {
  const review = await getReviewById(reviewId);
  return getFeedbackTargets(review.repositoryId, `${review.repositoryId}:pr:${review.prNumber}`);
}
