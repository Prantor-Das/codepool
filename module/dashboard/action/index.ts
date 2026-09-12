"use server";

import { headers } from "next/headers";
import { Octokit } from "octokit";
import { auth } from "@/lib/auth";
import {
  getGithubToken,
  fetchUserContribution,
} from "@/module/github/lib/github";
import { prisma } from "@/src/prisma/db";

export async function getDashboardStats() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      throw new Error("Unauthorized");
    }

    const token = await getGithubToken();
    const octokit = new Octokit({ auth: token });

    const { data: user } = await octokit.rest.users.getAuthenticated();

    const userRepositories = await prisma.orm.public.Repository.where({
      userId: session.user.id,
    })
      .select("id")
      .all();
    const repositoryIds = new Set(
      userRepositories.map((repository) => repository.id),
    );
    // Dashboard review totals represent successful reviews, not pending or failed attempts.
    const allReviews = await prisma.orm.public.Review.where({
      status: "completed",
    })
      .select("repositoryId")
      .all();
    const totalRepos = userRepositories.length;
    const totalReviews = allReviews.filter((review) =>
      repositoryIds.has(review.repositoryId),
    ).length;

    const calendar = await fetchUserContribution(token, user.login);
    const totalCommits = calendar?.totalContributions ?? 0;

    const { data: prs } = await octokit.rest.search.issuesAndPullRequests({
      q: `author:${user.login} type:pr`,
      per_page: 1,
    });

    const totalPRs = prs.total_count;

    return {
      totalCommits,
      totalPRs,
      totalRepos,
      totalReviews,
      heatmapWeeks: calendar?.weeks ?? [],
    };
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);

    return {
      totalCommits: 0,
      totalPRs: 0,
      totalRepos: 0,
      totalReviews: 0,
    };
  }
}

/* ================================
   Monthly Activity
================================ */

export async function getMonthlyActivity() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      throw new Error("Unauthorized");
    }

    const token = await getGithubToken();
    const octokit = new Octokit({ auth: token });

    const { data: user } = await octokit.rest.users.getAuthenticated();

    const calendar = await fetchUserContribution(token, user.login);
    if (!calendar) return [];

    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const monthlyData: Record<
      string,
      { commits: number; prs: number; reviews: number }
    > = {};

    // Initialize last 6 months
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthNames[date.getMonth()];
      monthlyData[key] = { commits: 0, prs: 0, reviews: 0 };
    }

    // Commits
    calendar.weeks.forEach((week) => {
      week.contributionDays.forEach((day) => {
        const date = new Date(day.date);
        const key = monthNames[date.getMonth()];
        if (monthlyData[key]) {
          monthlyData[key].commits += day.contributionCount;
        }
      });
    });

    const userRepositories = await prisma.orm.public.Repository.where({
      userId: session.user.id,
    })
      .select("id")
      .all();
    const repositoryIds = new Set(
      userRepositories.map((repository) => repository.id),
    );
    // Keep the monthly chart consistent with the headline total: completed reviews only.
    const reviews = await prisma.orm.public.Review.where({
      status: "completed",
    })
      .select("repositoryId", "createdAt")
      .all();
    reviews.forEach((review) => {
      if (!repositoryIds.has(review.repositoryId)) return;
      const key =
        monthNames[
          new Date(Number(review.createdAt.epochMilliseconds)).getMonth()
        ];
      if (monthlyData[key]) {
        monthlyData[key].reviews += 1;
      }
    });

    // PRs (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const { data: prs } = await octokit.rest.search.issuesAndPullRequests({
      q: `author:${user.login} type:pr created:>${
        sixMonthsAgo.toISOString().split("T")[0]
      }`,
      per_page: 100,
    });

    prs.items.forEach((pr) => {
      const date = new Date(pr.created_at ?? "");
      const key = monthNames[date.getMonth()];
      if (monthlyData[key]) monthlyData[key].prs += 1;
    });

    return Object.keys(monthlyData).map((name) => ({
      name,
      ...monthlyData[name],
    }));
  } catch (error) {
    console.error("Error fetching monthly activity:", error);
    return [];
  }
}
