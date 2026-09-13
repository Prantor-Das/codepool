import { readBoundedBody } from "@/lib/http-body";

/** GitHub auth stays on api.github.com; the sandbox receives only archive bytes. */
export async function downloadGitHubArchive(owner: string, repo: string, sha: string, token: string): Promise<Buffer> {
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error("Archive checkout requires a full commit SHA.");
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${sha}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, redirect: "manual", signal: AbortSignal.timeout(60_000),
  });
  if (response.status !== 302) throw new Error("GitHub did not issue a commit-scoped archive redirect.");
  const location = new URL(response.headers.get("location") ?? "");
  if (location.protocol !== "https:" || location.hostname !== "codeload.github.com" || location.username || location.password || !location.pathname.includes(sha)) throw new Error("Unexpected GitHub archive location.");
  const archive = await fetch(location, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!archive.ok) throw new Error("GitHub archive download failed.");
  return readBoundedBody(archive, 100 * 1024 * 1024);
}
