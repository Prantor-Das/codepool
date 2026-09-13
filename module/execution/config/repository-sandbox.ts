import { getGitHubFileContents } from "@/module/github/lib/github";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Scenario } from "@/module/execution/traffic/scenario-runner";
import type { CassetteEntry } from "@/module/execution/traffic/replay-proxy";

export const REPOSITORY_SANDBOX_CONFIG_PATH = ".codepool/sandbox.json";

export interface RepositorySandboxManifest {
  healthEndpoint?: string;
  fixturePath: string;
  fixtureVersion?: string;
  replayCassettePath?: string;
  scenarios: Scenario[];
}

export interface ResolvedRepositorySandboxConfig {
  fixture: string;
  fixtureVersion: string;
  replayCassette: CassetteEntry[];
  scenarios: Scenario[];
}

function safeRelativePath(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error(`${field} must be a non-empty repository-relative path.`);
  }
  return value;
}

function parseManifest(raw: string): RepositorySandboxManifest {
  const manifest = JSON.parse(raw) as Partial<RepositorySandboxManifest>;
  const scenarios = Array.isArray(manifest.scenarios) ? manifest.scenarios : [];
  if (!scenarios.length) throw new Error("Repository sandbox manifest must define at least one scenario.");
  if (manifest.healthEndpoint && typeof manifest.healthEndpoint !== "string") throw new Error("healthEndpoint must be a string.");
  const normalizedScenarios = scenarios as Scenario[];
  if (manifest.healthEndpoint && !normalizedScenarios.some((scenario) => scenario.path === manifest.healthEndpoint)) {
    normalizedScenarios.unshift({ id: "health-check", method: "GET", path: manifest.healthEndpoint, iterations: 3 });
  }
  return {
    healthEndpoint: manifest.healthEndpoint,
    fixturePath: safeRelativePath(manifest.fixturePath, "fixturePath"),
    fixtureVersion: typeof manifest.fixtureVersion === "string" && manifest.fixtureVersion.trim() ? manifest.fixtureVersion : "v1",
    replayCassettePath: manifest.replayCassettePath ? safeRelativePath(manifest.replayCassettePath, "replayCassettePath") : undefined,
    scenarios: normalizedScenarios,
  };
}

export async function resolveLocalSandboxConfig(): Promise<ResolvedRepositorySandboxConfig | null> {
  const fixtureSource = process.env.SANDBOX_FIXTURE_SNAPSHOT?.trim();
  if (!fixtureSource) return null;
  const fixture = await readFile(resolve(fixtureSource), "utf8").catch(() => fixtureSource);
  const scenarios = JSON.parse(process.env.SANDBOX_SCENARIOS_JSON ?? "[]") as Scenario[];
  if (!scenarios.length) return null;
  const cassettePath = process.env.DAYTONA_REPLAY_CASSETTE?.trim();
  const replayCassette = cassettePath ? JSON.parse(await readFile(resolve(cassettePath), "utf8")) as CassetteEntry[] : [];
  return { fixture, fixtureVersion: process.env.SANDBOX_FIXTURE_VERSION ?? "v1", replayCassette, scenarios };
}

export async function resolveRepositorySandboxConfig(
  token: string,
  owner: string,
  repo: string,
  ref: string,
): Promise<ResolvedRepositorySandboxConfig | null> {
  const rawManifest = await getGitHubFileContents(token, owner, repo, REPOSITORY_SANDBOX_CONFIG_PATH, ref);
  if (!rawManifest) return null;
  const manifest = parseManifest(rawManifest);
  const fixture = await getGitHubFileContents(token, owner, repo, manifest.fixturePath, ref);
  if (!fixture?.trim()) throw new Error(`Sandbox fixture ${manifest.fixturePath} is missing or empty.`);
  const cassetteRaw = manifest.replayCassettePath
    ? await getGitHubFileContents(token, owner, repo, manifest.replayCassettePath, ref)
    : "[]";
  const replayCassette = JSON.parse(cassetteRaw || "[]") as CassetteEntry[];
  if (!Array.isArray(replayCassette)) throw new Error("replayCassettePath must contain a JSON array.");
  return { fixture, fixtureVersion: manifest.fixtureVersion ?? "v1", replayCassette, scenarios: manifest.scenarios };
}
