"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/src/prisma/db";
import { deleteWebhook } from "@/module/github/lib/github";

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

export async function getUserProfile() {
  const session = await getSession();
  return prisma.orm.public.User.select("id", "name", "email", "image")
    .where({ id: session.user.id })
    .first();
}

export async function updateUserProfile(data: { name: string; email: string }) {
  const session = await getSession();
  const name = data.name.trim();
  const email = data.email.trim().toLowerCase();
  if (name.length < 2) throw new Error("Name must be at least 2 characters.");
  if (!/^\S+@\S+\.\S+$/.test(email))
    throw new Error("Enter a valid email address.");

  const user = await prisma.orm.public.User.where({ id: session.user.id })
    .select("id", "name", "email", "image")
    .update({ name, email });

  revalidatePath("/dashboard/settings");
  return { success: true, user };
}

export async function getConnectedRep() {
  const session = await getSession();
  const repositories = await prisma.orm.public.Repository.where({
    userId: session.user.id,
  })
    .select("id", "name", "fullName", "owner", "url", "createdAt")
    .orderBy((repository) => repository.createdAt.desc())
    .all();

  return repositories.map((repository) => ({
    ...repository,
    createdAt: repository.createdAt.toString(),
  }));
}

export async function disconnetRepo(repositoryId: string) {
  const session = await getSession();
  const repository = await prisma.orm.public.Repository.where({
    id: repositoryId,
    userId: session.user.id,
  })
    .select("id", "owner", "name")
    .first();
  if (!repository) throw new Error("Repository not found.");

  try {
    await deleteWebhook(repository.owner, repository.name);
  } catch (error) {
    console.warn("Failed to delete GitHub webhook during disconnect:", error);
  }

  await prisma.orm.public.Repository.where({ id: repository.id }).delete();
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/repository");
  return { success: true };
}

export async function disconnectAllRepos() {
  const session = await getSession();
  const repositories = await prisma.orm.public.Repository.where({
    userId: session.user.id,
  })
    .select("id", "owner", "name")
    .all();

  for (const repository of repositories) {
    try {
      await deleteWebhook(repository.owner, repository.name);
    } catch (error) {
      console.warn(
        `Failed to delete webhook for ${repository.owner}/${repository.name}:`,
        error,
      );
    }
  }

  for (const repository of repositories) {
    await prisma.orm.public.Repository.where({ id: repository.id }).delete();
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/repository");
  return { success: true };
}
