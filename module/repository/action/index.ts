"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/src/prisma/db";
import { createWebhook, getRepositories } from "@/module/github/lib/github";
import { inngest } from "@/inngest/client";

export async function fetchRepositories(page = 1, perPage = 10) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  const [repositories, connected] = await Promise.all([
    getRepositories(page, perPage),
    prisma.orm.public.Repository.where({ userId: session.user.id })
      .select("githubId")
      .all(),
  ]);
  const connectedIds = new Set(
    connected.map((repository) => String(repository.githubId)),
  );
  return repositories.map((repository) => ({
    id: repository.id,
    name: repository.name,
    full_name: repository.full_name,
    description: repository.description,
    html_url: repository.html_url,
    stargazers_count: repository.stargazers_count,
    language: repository.language,
    topics: repository.topics ?? [],
    isConnected: connectedIds.has(String(repository.id)),
  }));
}

export async function connectedRepo(
  owner: string,
  repo: string,
  githubId: number,
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const existing = await prisma.orm.public.Repository.where({
    githubId: BigInt(githubId),
  }).first();
  if (existing) {
    if (existing.userId !== session.user.id) {
      throw new Error(
        "This repository is already connected to another account.",
      );
    }
    return { connected: true, queued: false };
  }

  const webhook = await createWebhook(owner, repo);
  const repository = await prisma.orm.public.Repository.create({
    githubId: BigInt(githubId),
    name: repo,
    fullName: `${owner}/${repo}`,
    owner,
    url: `https://github.com/${owner}/${repo}`,
    userId: session.user.id,
  });

  let queued = false;
  try {
    await inngest.send({
      name: "repository.connected",
      data: { owner, repo, userId: session.user.id },
    });
    queued = true;
  } catch (error) {
    console.error(
      "Repository connected, but indexing could not be queued:",
      error,
    );
  }

  return {
    connected: Boolean(repository),
    queued,
    webhookCreated: Boolean(webhook),
  };
}

export const getRepositoryPage = fetchRepositories;

export async function connectRepository(input: {
  githubId: number;
  name: string;
  fullName: string;
  owner: string;
  url: string;
}) {
  const [owner, repo] = input.fullName.split("/");
  if (!owner || !repo) throw new Error("Invalid repository name.");
  return connectedRepo(owner, repo, input.githubId);
}

export async function getConnectedRepositories() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  return prisma.orm.public.Repository.where({ userId: session.user.id })
    .orderBy((repository) => repository.createdAt.desc())
    .all();
}
