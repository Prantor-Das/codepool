import { Octokit } from "octokit";
import { auth } from "@/lib/auth";
import { prisma } from "@/src/prisma/db";
import { headers } from "next/headers";

export const getGithubToken = async (): Promise<string> => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const account = await prisma.orm.public.Account.where({
    userId: session.user.id,
    providerId: "github",
  }).first();

  if (!account || !account.accessToken) {
    throw new Error("No GitHub access token found");
  }

  return account.accessToken;
};

interface ContributionDay {
  contributionCount: number;
  date: string;
  color: string;
}

interface ContributionWeek {
  contributionDays: ContributionDay[];
}

export interface ContributionCalendar {
  totalContributions: number;
  weeks: ContributionWeek[];
}

interface ContributionData {
  user: {
    contributionsCollection: {
      contributionCalendar: ContributionCalendar;
    };
  };
}

export async function fetchUserContribution(
  token: string,
  username: string,
): Promise<ContributionCalendar | null> {
  const octokit = new Octokit({ auth: token });

  const query = `
    query ($username: String!) {
      user(login: $username) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
                color
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await octokit.graphql<ContributionData>(query, {
      username,
    });

    return response.user.contributionsCollection.contributionCalendar;
  } catch (error) {
    console.error("Error fetching GitHub contributions:", error);
    return null;
  }
}

export const getRepositories = async (page: number = 1, perPage = 10) => {
  const token = await getGithubToken();
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    sort: "updated",
    direction: "desc",
    visibility: "all",
    per_page: perPage,
    page: page,
  });
  return data;
};

export const getOpenPullRequests = async (
  token: string,
  owner: string,
  repo: string,
) => {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "open",
    sort: "updated",
    direction: "desc",
    per_page: 20,
  });
  return data;
};

export const createWebhook = async (owner: string, repo: string) => {
  const token = await getGithubToken();
  const octokit = new Octokit({ auth: token });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "NEXT_PUBLIC_BASE_URL must be configured with the public app URL before connecting a repository.",
      );
    }
    console.warn(
      "Skipping GitHub webhook creation because NEXT_PUBLIC_BASE_URL is not configured in development.",
    );
    return null;
  }
  const parsedBaseUrl = new URL(baseUrl);
  if (["localhost", "127.0.0.1", "::1"].includes(parsedBaseUrl.hostname)) {
    console.warn(
      "Skipping GitHub webhook creation because NEXT_PUBLIC_BASE_URL is local. Use a public tunnel or deployed URL for webhook-driven reviews.",
    );
    return null;
  }
  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/webhook/github`;

  const { data: hooks } = await octokit.rest.repos.listWebhooks({
    owner,
    repo,
  });

  const existinghook = hooks.find((hook) => hook.config.url === webhookUrl);
  if (existinghook) {
    return existinghook;
  }

  const { data } = await octokit.rest.repos.createWebhook({
    owner,
    repo,
    config: {
      url: webhookUrl,
      content_type: "json",
    },
    events: ["pull_request"],
  });

  return data;
};
export const deleteWebhook = async (owner: string, repo: string) => {
  const token = await getGithubToken();
  const octokit = new Octokit({ auth: token });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) return false;
  const parsedBaseUrl = new URL(baseUrl);
  if (["localhost", "127.0.0.1", "::1"].includes(parsedBaseUrl.hostname)) {
    return false;
  }
  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/webhook/github`;

  try {
    const { data: hooks } = await octokit.rest.repos.listWebhooks({
      owner,
      repo,
    });

    const hookDelete = hooks.find((hook) => hook.config.url === webhookUrl);

    if (hookDelete) {
      await octokit.rest.repos.deleteWebhook({
        owner,
        repo,
        hook_id: hookDelete.id,
      });
      return true;
    }

    return false;
  } catch (error) {
    console.error("Failed to delete webhook:", error);
    return false;
  }
};
export async function getRepoFileContents(
  token: string,
  owner: string,
  repo: string,
  path: string = "",
): Promise<{ path: string; content: string }[]> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
  });

  if (!Array.isArray(data)) {
    // It's a file
    if (data.type === "file" && data.content) {
      return [
        {
          path: data.path,
          content: Buffer.from(data.content, "base64").toString("utf-8"),
        },
      ];
    }
    return [];
  }

  let files: { path: string; content: string }[] = [];

  for (const item of data) {
    if (item.type === "file") {
      const { data: fileData } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: item.path,
      });
      if (
        !Array.isArray(fileData) &&
        fileData.type === "file" &&
        fileData.content
      ) {
        // Filter out non-code / binary files
        if (
          !fileData.path.match(/\.(png|jpg|jpeg|gif|svg|ico|pdf|zip|tar|gz)$/i)
        ) {
          files.push({
            path: fileData.path,
            content: Buffer.from(fileData.content, "base64").toString("utf-8"),
          });
        }
      }
    } else if (item.type === "dir") {
      const subfiles = await getRepoFileContents(token, owner, repo, item.path);

      files = files.concat(subfiles);
    }
  }

  return files;
}

export async function getPullRequestDiff(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
) {
  const octokit = new Octokit({ auth: token });

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  const { data: diff } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: {
      format: "diff",
    },
  });

  return {
    diff: diff as unknown as string,
    title: pr.title,
    description: pr.body,
  };
}

export async function postReviewComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  review: string,
) {
  const octokit = new Octokit({ auth: token });

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: `## AI code review\n\n${review}\n\n*Powered by Codepool*`,
  });
}
