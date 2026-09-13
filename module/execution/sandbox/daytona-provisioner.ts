import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Daytona, type CreateSandboxFromSnapshotParams, type Resources } from "@daytonaio/sdk";
import type {
  SandboxEnvironment,
  SandboxPair,
  SandboxProvisioner,
  SandboxRequest,
  SandboxResponse,
  SeedSnapshot,
} from "./provisioner";

type DaytonaConfig = {
  repoUrl: string;
  repoSlug: string;
  composeTemplate: string;
  templateSnapshot: string;
  buildConfigHash: string;
  appPort: number;
  operationTimeoutSeconds: number;
  executionTimeoutSeconds: number;
  resources: Resources;
  databaseUrl: string;
  redisRestUrlBase?: string;
  redisRestTokenBase?: string;
  redisRestUrlPr?: string;
  redisRestTokenPr?: string;
  checkoutToken?: string;
  archiveUrl?: string;
};

type ManagedPair = { baseId: string; prId: string };
type DaytonaSandbox = Awaited<ReturnType<Daytona["create"]>>;

const managedPairs = new Map<string, ManagedPair>();
const snapshotBuilds = new Map<string, Promise<string>>();

function env(name: string, fallback?: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function required(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Daytona sandbox provider requires ${name}.`);
  return value;
}

function integerEnv(name: string, fallback: number): number {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "repo";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function command(commandText: string): string {
  return `set -eu; ${commandText}`;
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { status?: number; statusCode?: number; message?: string } | undefined;
  return candidate?.status === 404 || candidate?.statusCode === 404 || /not found|404|destroyed/i.test(candidate?.message ?? String(error));
}

async function buildConfigHash(): Promise<string> {
  const composePath = env("DAYTONA_COMPOSE_TEMPLATE", "docker-compose.yml")!;
  let template = "";
  try { template = await readFile(composePath, "utf8"); } catch { template = composePath; }
  return createHash("sha256").update(JSON.stringify({
    template,
    image: env("DAYTONA_TEMPLATE_SNAPSHOT", "daytona-vm-small"),
    cpu: env("DAYTONA_CPU", "2"),
    memory: env("DAYTONA_MEMORY_GB", "4"),
    disk: env("DAYTONA_DISK_GB", "20"),
    appPort: env("DAYTONA_APP_PORT", "3000"),
  })).digest("hex").slice(0, 20);
}

async function loadConfig(): Promise<DaytonaConfig> {
  const composeTemplate = required("DAYTONA_COMPOSE_TEMPLATE");
  const repoUrl = required("DAYTONA_REPO_URL");
  const repoSlug = required("DAYTONA_REPO_SLUG");
  const buildHash = await buildConfigHash();
  const databaseUrl = env("DAYTONA_DATABASE_URL", "postgresql://postgres:postgres@postgres:5432/postgres")!;
  if (process.env.DATABASE_URL && databaseUrl === process.env.DATABASE_URL) throw new Error("DAYTONA_DATABASE_URL must not reuse CodePool's production DATABASE_URL.");
  if (process.env.NEO4J_PASSWORD && databaseUrl.includes(process.env.NEO4J_PASSWORD)) throw new Error("Daytona database configuration contains a CodePool Neo4j secret.");
  const redisBase = env("DAYTONA_UPSTASH_REDIS_REST_URL_BASE");
  const redisPr = env("DAYTONA_UPSTASH_REDIS_REST_URL_PR");
  if (redisBase && redisPr && redisBase === redisPr) throw new Error("Base and PR Daytona sandboxes must use different Upstash Redis endpoints.");
  if (!redisBase || !redisPr || !env("DAYTONA_UPSTASH_REDIS_REST_TOKEN_BASE") || !env("DAYTONA_UPSTASH_REDIS_REST_TOKEN_PR")) throw new Error("Daytona requires separate Upstash Redis REST URLs and tokens for base and PR sandboxes.");
  return {
    repoUrl,
    repoSlug,
    composeTemplate,
    templateSnapshot: env("DAYTONA_TEMPLATE_SNAPSHOT", "daytona-vm-small")!,
    buildConfigHash: buildHash,
    appPort: integerEnv("DAYTONA_APP_PORT", 3000),
    operationTimeoutSeconds: integerEnv("DAYTONA_OPERATION_TIMEOUT_SECONDS", 300),
    executionTimeoutSeconds: integerEnv("DAYTONA_EXECUTION_TIMEOUT_SECONDS", 120),
    resources: {
      cpu: integerEnv("DAYTONA_CPU", 2),
      memory: integerEnv("DAYTONA_MEMORY_GB", 4),
      disk: integerEnv("DAYTONA_DISK_GB", 20),
    },
    databaseUrl,
    redisRestUrlBase: env("DAYTONA_UPSTASH_REDIS_REST_URL_BASE"),
    redisRestTokenBase: env("DAYTONA_UPSTASH_REDIS_REST_TOKEN_BASE"),
    redisRestUrlPr: env("DAYTONA_UPSTASH_REDIS_REST_URL_PR"),
    redisRestTokenPr: env("DAYTONA_UPSTASH_REDIS_REST_TOKEN_PR"),
    checkoutToken: env("DAYTONA_CHECKOUT_TOKEN"),
    archiveUrl: env("DAYTONA_REPO_ARCHIVE_URL"),
  };
}

function getClient(): Daytona {
  const apiKey = required("DAYTONA_API_KEY");
  return new Daytona({ apiKey, apiUrl: env("DAYTONA_API_URL"), target: env("DAYTONA_TARGET"), requestTimeoutMs: integerEnv("DAYTONA_REQUEST_TIMEOUT_MS", 600_000) });
}

async function exec(sandbox: DaytonaSandbox, script: string, config: DaytonaConfig, processEnv: Record<string, string> = {}) {
  const result = await sandbox.process.executeCommand(command(script), undefined, processEnv, config.executionTimeoutSeconds);
  if (result.exitCode !== 0) throw new Error(`Daytona command failed in ${sandbox.id}: ${result.artifacts?.stdout ?? result.result ?? "unknown error"}`);
  return result.artifacts?.stdout ?? result.result ?? "";
}

async function checkout(sandbox: DaytonaSandbox, sha: string, config: DaytonaConfig): Promise<void> {
  const tokenEnv: Record<string, string> = config.checkoutToken ? { CODEPOOL_CHECKOUT_TOKEN: config.checkoutToken } : {};
  if (config.archiveUrl) {
    const archive = config.archiveUrl.replaceAll("{sha}", sha);
    await exec(sandbox, `rm -rf /workspace/codepool && mkdir -p /workspace/codepool && curl --fail --location --retry 2 ${shellQuote(archive)} -o /tmp/codepool.tgz && tar -xzf /tmp/codepool.tgz --strip-components=1 -C /workspace/codepool && git -C /workspace/codepool init && git -C /workspace/codepool checkout --orphan ${shellQuote(sha)}`, config);
    return;
  }
  const remote = config.repoUrl;
  const askPass = encode("#!/bin/sh\ncase \"$1\" in *Username*) printf '%s' 'x-access-token' ;; *) printf '%s' \"$CODEPOOL_CHECKOUT_TOKEN\" ;; esac\n");
  await exec(sandbox, `if [ -n "${"$"}{CODEPOOL_CHECKOUT_TOKEN:-}" ]; then printf %s ${shellQuote(askPass)} | base64 -d > /tmp/codepool-askpass.sh && chmod 700 /tmp/codepool-askpass.sh && export GIT_ASKPASS=/tmp/codepool-askpass.sh GIT_TERMINAL_PROMPT=0; fi; if [ ! -d /workspace/codepool/.git ]; then git clone --filter=blob:none ${shellQuote(remote)} /workspace/codepool; fi; git -C /workspace/codepool fetch --depth=1 origin ${shellQuote(sha)} && git -C /workspace/codepool checkout --detach FETCH_HEAD`, config, tokenEnv);
}

async function startCompose(sandbox: DaytonaSandbox, role: "base" | "pr", config: DaytonaConfig): Promise<void> {
  const safeProject = `codepool_${role}_${safeSlug(sandbox.id)}`;
  const redisRestUrl = role === "base" ? config.redisRestUrlBase : config.redisRestUrlPr;
  const redisRestToken = role === "base" ? config.redisRestTokenBase : config.redisRestTokenPr;
  const envFile = [
    `NODE_ENV=production`,
    `CODEPOOL_TARGET_SHA=${sandbox.labels["codepool-sha"] ?? "unknown"}`,
    `COMPOSE_PROJECT_NAME=${safeProject}`,
    `DATABASE_URL=${config.databaseUrl}`,
    `REDIS_URL=`,
    `UPSTASH_REDIS_REST_URL=${redisRestUrl ?? ""}`,
    `UPSTASH_REDIS_REST_TOKEN=${redisRestToken ?? ""}`,
  ].join("\n");
  await exec(sandbox, `cd /workspace/codepool && printf %s ${shellQuote(encode(envFile))} | base64 -d > /tmp/codepool-sandbox.env && docker compose --env-file /tmp/codepool-sandbox.env -f ${shellQuote(config.composeTemplate)} up -d --build`, config);
}

async function createBaseSnapshot(daytona: Daytona, config: DaytonaConfig, snapshotName: string, baseSha: string): Promise<string> {
  try {
    await daytona.snapshot.get(snapshotName);
    return snapshotName;
  } catch {
    const templateParams = { snapshot: config.templateSnapshot, resources: config.resources, ephemeral: true, autoDeleteInterval: 0, labels: { "codepool-template": "base", "codepool-snapshot": snapshotName }, networkBlockAll: false } as unknown as CreateSandboxFromSnapshotParams;
    const template = await daytona.create(templateParams, { timeout: config.operationTimeoutSeconds });
    try {
      await checkout(template, baseSha, config);
      await exec(template, `cd /workspace/codepool && test -f ${shellQuote(config.composeTemplate)}`, config);
      await template.createSnapshot(snapshotName, config.operationTimeoutSeconds);
      return snapshotName;
    } finally {
      await daytona.delete(template, config.operationTimeoutSeconds, true).catch((error) => console.error(`Failed to delete Daytona template builder ${template.id}:`, error));
    }
  }
}

async function getBaseSnapshot(daytona: Daytona, config: DaytonaConfig, baseSha: string): Promise<string> {
  const name = `codepool-${safeSlug(config.repoSlug)}-${baseSha.slice(0, 12)}-${config.buildConfigHash}`;
  const existing = snapshotBuilds.get(name);
  if (existing) return existing;
  const build = createBaseSnapshot(daytona, config, name, baseSha);
  snapshotBuilds.set(name, build);
  try { return await build; } finally { snapshotBuilds.delete(name); }
}

class DaytonaEnvironment implements SandboxEnvironment {
  private preview?: { url: string; token?: string };
  constructor(private readonly sandbox: DaytonaSandbox, private readonly config: DaytonaConfig, private readonly role: "base" | "pr", public readonly baseSha: string) {}
  get id(): string { return this.sandbox.id; }

  async request(request: SandboxRequest): Promise<SandboxResponse> {
    const preview = this.preview ??= await this.sandbox.getPreviewLink(this.config.appPort);
    const url = new URL(request.path, preview.url).toString();
    const started = performance.now();
    const response = await fetch(url, { method: request.method, headers: { ...(request.headers ?? {}), ...(preview.token ? { "x-daytona-preview-token": preview.token } : {}) }, body: request.body === undefined ? undefined : typeof request.body === "string" ? request.body : JSON.stringify(request.body) });
    const contentType = response.headers.get("content-type") ?? "";
    const bodyText = await response.text();
    let body: unknown = bodyText;
    if (contentType.includes("json")) { try { body = JSON.parse(bodyText); } catch { /* preserve malformed response as text */ } }
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body, elapsedMs: performance.now() - started };
  }

  async seedDatabase(snapshot: SeedSnapshot): Promise<string> {
    const fixture = encode(snapshot.fixture);
    const output = await exec(this.sandbox, `printf %s ${shellQuote(fixture)} | base64 -d > /tmp/codepool-fixture.sql && psql ${shellQuote(this.config.databaseUrl)} --set ON_ERROR_STOP=1 --file /tmp/codepool-fixture.sql && printf %s ${shellQuote(snapshot.seedId)}`, this.config);
    return output.trim();
  }

  async seedRedis(snapshot: SeedSnapshot): Promise<string> {
    const redisRestUrl = this.role === "base" ? this.config.redisRestUrlBase : this.config.redisRestUrlPr;
    const redisRestToken = this.role === "base" ? this.config.redisRestTokenBase : this.config.redisRestTokenPr;
    if (redisRestUrl && redisRestToken) {
      const payload = encode(JSON.stringify(["SET", "__codepool_seed_id", snapshot.seedId]));
      const output = await exec(this.sandbox, `printf %s ${shellQuote(payload)} | base64 -d > /tmp/codepool-redis.json && curl --fail --silent --show-error ${shellQuote(redisRestUrl)} -H 'Authorization: Bearer '"$CODEPOOL_REDIS_REST_TOKEN" -H 'Content-Type: application/json' --data-binary @/tmp/codepool-redis.json >/dev/null && printf %s ${shellQuote(snapshot.seedId)}`, this.config, { CODEPOOL_REDIS_REST_TOKEN: redisRestToken });
      return output.trim();
    }
    throw new Error(`Missing isolated Upstash Redis configuration for ${this.role} sandbox.`);
  }
}

export class DaytonaSandboxProvisioner implements SandboxProvisioner {
  private readonly daytona: Daytona;
  constructor(daytona = getClient()) { this.daytona = daytona; }

  async provisionPair(baseSha: string, prSha: string): Promise<SandboxPair> {
    const config = await loadConfig();
    const snapshot = await getBaseSnapshot(this.daytona, config, baseSha);
    const pairId = `codepool-${Date.now()}-${createHash("sha256").update(`${baseSha}:${prSha}`).digest("hex").slice(0, 12)}`;
    let base: DaytonaSandbox | undefined;
    let pr: DaytonaSandbox | undefined;
    try {
      const common = { snapshot, resources: config.resources, ephemeral: true, autoDeleteInterval: 0, autoStopInterval: integerEnv("DAYTONA_AUTO_STOP_MINUTES", 30), ttlMinutes: integerEnv("DAYTONA_TTL_MINUTES", 45), networkBlockAll: env("DAYTONA_NETWORK_BLOCK_ALL", "false") === "true", domainAllowList: env("DAYTONA_DOMAIN_ALLOW_LIST"), labels: { "codepool-pair": pairId, "codepool-provider": "daytona" } };
      const baseParams = { ...common, name: `${pairId}-base`, labels: { ...common.labels, "codepool-role": "base", "codepool-sha": baseSha } } as unknown as CreateSandboxFromSnapshotParams;
      const prParams = { ...common, name: `${pairId}-pr`, labels: { ...common.labels, "codepool-role": "pr", "codepool-sha": prSha } } as unknown as CreateSandboxFromSnapshotParams;
      [base, pr] = await Promise.all([
        this.daytona.create(baseParams, { timeout: config.operationTimeoutSeconds }),
        this.daytona.create(prParams, { timeout: config.operationTimeoutSeconds }),
      ]);
      await checkout(pr, prSha, config);
      await checkout(base, baseSha, config);
      await Promise.all([startCompose(base, "base", config), startCompose(pr, "pr", config)]);
      managedPairs.set(pairId, { baseId: base.id, prId: pr.id });
      return { pairId, baseEnv: new DaytonaEnvironment(base, config, "base", baseSha), prEnv: new DaytonaEnvironment(pr, config, "pr", prSha) };
    } catch (error) {
      await Promise.all([base && this.daytona.delete(base, config.operationTimeoutSeconds, true).catch(() => undefined), pr && this.daytona.delete(pr, config.operationTimeoutSeconds, true).catch(() => undefined)]);
      throw error;
    }
  }

  async teardown(pairId: string): Promise<void> {
    const pair = managedPairs.get(pairId);
    if (!pair) throw new Error(`Unknown Daytona sandbox pair: ${pairId}`);
    const config = await loadConfig();
    const failures: string[] = [];
    for (const sandboxId of [pair.baseId, pair.prId]) {
      try {
        const sandbox = await this.daytona.get(sandboxId);
        await this.daytona.delete(sandbox, config.operationTimeoutSeconds, true);
        try { await this.daytona.get(sandboxId); failures.push(`${sandboxId}: still visible after deletion`); } catch (error) { if (!isNotFound(error)) failures.push(`${sandboxId}: could not confirm deletion: ${String(error)}`); }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isNotFound(error)) failures.push(`${sandboxId}: ${message}`);
      }
    }
    managedPairs.delete(pairId);
    if (failures.length) throw new Error(`Daytona teardown incomplete: ${failures.join("; ")}`);
  }
}

export function listDaytonaManagedSandboxes(daytona = getClient()) {
  return daytona.list({ labels: { "codepool-provider": "daytona" } });
}
