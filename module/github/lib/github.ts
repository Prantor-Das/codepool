import { Octokit } from "octokit";
import { auth } from "@/lib/auth";
import { prisma } from "@/src/prisma/db";
import { headers } from "next/headers";
import { reviewCheckRunPayload } from "@/lib/review-check";

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
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new Error(
      "GITHUB_WEBHOOK_SECRET must be configured before connecting a repository.",
    );
  }

  const { data: hooks } = await octokit.rest.repos.listWebhooks({
    owner,
    repo,
  });

  const existinghook = hooks.find((hook) => hook.config.url === webhookUrl);
  if (existinghook) {
    const { data } = await octokit.rest.repos.updateWebhook({
      owner,
      repo,
      hook_id: existinghook.id,
      config: {
        url: webhookUrl,
        content_type: "json",
        secret: webhookSecret,
      },
      events: ["pull_request"],
      active: true,
    });
    return data;
  }

  const { data } = await octokit.rest.repos.createWebhook({
    owner,
    repo,
    config: {
      url: webhookUrl,
      content_type: "json",
      secret: webhookSecret,
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
const MAX_REPOSITORY_FILES = 1000;
const MAX_REPOSITORY_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024;
const IGNORED_DIRECTORY_NAMES = new Set([".git", "node_modules", "dist"]);
const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
]);
const BINARY_EXTENSIONS = new Set([
  "7z",
  "apk",
  "avi",
  "bin",
  "bz2",
  "class",
  "dmg",
  "dll",
  "doc",
  "docx",
  "eot",
  "exe",
  "flac",
  "gif",
  "gz",
  "ico",
  "ipa",
  "iso",
  "jar",
  "jpeg",
  "jpg",
  "mov",
  "mp3",
  "mp4",
  "ogg",
  "otf",
  "pdf",
  "png",
  "psd",
  "rar",
  "so",
  "svg",
  "tar",
  "tgz",
  "tif",
  "tiff",
  "ttf",
  "wav",
  "webm",
  "webp",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "xz",
  "zip",
]);
const IMPORTANT_FILE_NAMES = new Set([
  "dockerfile",
  "makefile",
  "readme",
  "readme.md",
  "license",
  "tsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "vite.config.js",
  "vite.config.ts",
]);
const IMPORTANT_SOURCE_EXTENSIONS = new Set([
  "astro",
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "dart",
  "go",
  "graphql",
  "gql",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "json",
  "kt",
  "kts",
  "less",
  "md",
  "mdx",
  "mjs",
  "mts",
  "php",
  "prisma",
  "py",
  "rb",
  "rs",
  "scss",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
]);

function shouldSkipRepositoryPath(filePath: string) {
  const segments = filePath.split("/").filter(Boolean);
  const fileName = segments.at(-1)?.toLowerCase() ?? "";
  const extension = fileName.split(".").at(-1) ?? "";

  return (
    segments.some((segment) =>
      IGNORED_DIRECTORY_NAMES.has(segment.toLowerCase()),
    ) ||
    LOCKFILE_NAMES.has(fileName) ||
    BINARY_EXTENSIONS.has(extension)
  );
}

function isImportantRepositoryPath(filePath: string) {
  if (shouldSkipRepositoryPath(filePath)) return false;

  const fileName = filePath.split("/").at(-1)?.toLowerCase() ?? "";
  const extension = fileName.split(".").at(-1) ?? "";
  return (
    IMPORTANT_FILE_NAMES.has(fileName) ||
    IMPORTANT_SOURCE_EXTENSIONS.has(extension)
  );
}

export async function getRepoFileContents(
  token: string,
  owner: string,
  repo: string,
  path: string = "",
): Promise<{ path: string; content: string }[]> {
  const octokit = new Octokit({ auth: token });
  const files: { path: string; content: string }[] = [];
  let totalBytes = 0;

  const walk = async (currentPath: string): Promise<void> => {
    if (
      files.length >= MAX_REPOSITORY_FILES ||
      totalBytes >= MAX_REPOSITORY_BYTES
    ) {
      return;
    }

    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: currentPath,
    });

    if (!Array.isArray(data)) {
      if (
        data.type !== "file" ||
        !data.content ||
        !isImportantRepositoryPath(data.path)
      ) {
        return;
      }

      const contentBuffer = Buffer.from(data.content, "base64");
      if (
        contentBuffer.byteLength > MAX_FILE_BYTES ||
        totalBytes + contentBuffer.byteLength > MAX_REPOSITORY_BYTES
      ) {
        return;
      }

      files.push({
        path: data.path,
        content: contentBuffer.toString("utf-8"),
      });
      totalBytes += contentBuffer.byteLength;
      return;
    }

    for (const item of data) {
      if (
        files.length >= MAX_REPOSITORY_FILES ||
        totalBytes >= MAX_REPOSITORY_BYTES
      ) {
        break;
      }
      if (!isImportantRepositoryPath(item.path)) {
        // Directories are allowed through so their children can be inspected.
        if (item.type !== "dir" || shouldSkipRepositoryPath(item.path)) {
          continue;
        }
      }

      if (item.type === "dir") {
        await walk(item.path);
        continue;
      }
      if (item.type !== "file") continue;

      // GitHub includes the size in directory listings, so avoid fetching a
      // file that would exceed the remaining budget.
      if (
        typeof item.size === "number" &&
        (item.size > MAX_FILE_BYTES ||
          totalBytes + item.size > MAX_REPOSITORY_BYTES)
      ) {
        continue;
      }

      await walk(item.path);
    }
  };

  await walk(path);
  return files;
}

/** Read one text file at an exact repository ref. A missing file is a valid
 * result because sandbox execution is opt-in per repository. */
export async function getGitHubFileContents(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const octokit = new Octokit({ auth: token });
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data) || data.type !== "file" || !data.content) return null;
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404) return null;
    throw error;
  }
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
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    labels: pr.labels.map((label) => typeof label === "string" ? label : label.name).filter((label): label is string => Boolean(label)),
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

export type ReviewCheckRun = { id: number; headSha: string };

export async function createReviewCheckRun(token: string, owner: string, repo: string, headSha: string): Promise<ReviewCheckRun> {
  const octokit = new Octokit({ auth: token });
  const externalId = `codepool-review:${owner}/${repo}:${headSha}`;
  const { data: existing } = await octokit.rest.checks.listForRef({ owner, repo, ref: headSha, per_page: 100 });
  const prior = existing.check_runs.find((check) => check.external_id === externalId);
  if (prior) {
    await octokit.rest.checks.update({ owner, repo, check_run_id: prior.id, ...reviewCheckRunPayload("queued", undefined, "Codepool is waiting for a worker.") });
    return { id: prior.id, headSha };
  }
  const { data } = await octokit.rest.checks.create({
    owner, repo, head_sha: headSha, name: "Codepool AI Review", status: "queued",
    external_id: externalId,
    output: { title: "AI review queued", summary: "Codepool received this pull request and is waiting for a worker." },
  });
  return { id: data.id, headSha };
}

export async function updateReviewCheckRun(token: string, owner: string, repo: string, checkRunId: number, state: "in_progress" | "completed", conclusion?: "success" | "failure" | "timed_out", summary?: string) {
  const octokit = new Octokit({ auth: token });
  await octokit.rest.checks.update({ owner, repo, check_run_id: checkRunId, ...reviewCheckRunPayload(state, conclusion, summary) });
}

export async function postRuntimeDiffComment(token: string, owner: string, repo: string, prNumber: number, body: string) {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body: `${body}\n\n*Powered by Codepool*` });
  return data;
}

export async function addRuntimeFeedbackReaction(token: string, owner: string, repo: string, commentId: number, content: "+1" | "rocket" | "-1") {
  const octokit = new Octokit({ auth: token });
  return octokit.rest.reactions.createForIssueComment({ owner, repo, comment_id: commentId, content });
}
