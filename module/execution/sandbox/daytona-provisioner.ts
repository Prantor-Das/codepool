import { readBoundedBody } from "@/lib/http-body";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Daytona, type CreateSandboxFromSnapshotParams } from "@daytonaio/sdk";
import type { SandboxEnvironment, SandboxPair, SandboxProvisioner, SandboxRequest, SandboxResponse, SeedSnapshot } from "./provisioner";
import { assertLocalDatabaseUrl, sandboxRequestUrl, validateArchive, validateCompose, type ArchiveDescriptor } from "./security";
import { replayServiceScript, type CassetteEntry } from "../traffic/replay-proxy";

type Sandbox = Awaited<ReturnType<Daytona["create"]>>;
type Config = { snapshot: string; compose: string; databaseUrl: string; appPort: number; timeout: number; archives: Record<string, ArchiveDescriptor>; cassette: CassetteEntry[] };
const required = (name: string) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`Daytona requires ${name}.`); return value; };
const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
const isNotFound = (error: unknown) => { const e = error as { status?: number; statusCode?: number }; return e?.status === 404 || e?.statusCode === 404; };
function client() { return new Daytona({ apiKey: required("DAYTONA_API_KEY"), apiUrl: process.env.DAYTONA_API_URL, target: process.env.DAYTONA_TARGET }); }
async function config(): Promise<Config> {
  if (process.env.DAYTONA_NETWORK_BLOCK_ALL === "false" || process.env.DAYTONA_DOMAIN_ALLOW_LIST) throw new Error("Differential runs require block-all egress; live allow lists are not supported.");
  const databaseUrl = process.env.DAYTONA_DATABASE_URL ?? "postgresql://postgres:postgres@postgres:5432/postgres";
  assertLocalDatabaseUrl(databaseUrl);
  if (databaseUrl === process.env.DATABASE_URL || (process.env.NEO4J_PASSWORD && databaseUrl.includes(process.env.NEO4J_PASSWORD))) throw new Error("Sandbox database must not reuse production credentials.");
  const compose = required("DAYTONA_COMPOSE_TEMPLATE");
  if (!/^[a-zA-Z0-9_./-]+$/.test(compose) || compose.startsWith("/") || compose.split("/").includes("..")) throw new Error("Compose path must be repository-relative.");
  return { snapshot: required("DAYTONA_TEMPLATE_SNAPSHOT"), compose, databaseUrl, appPort: Number(process.env.DAYTONA_APP_PORT ?? 3000), timeout: 120,
    archives: JSON.parse(process.env.DAYTONA_REPO_ARCHIVES_JSON ?? "{}"), cassette: process.env.DAYTONA_REPLAY_CASSETTE ? JSON.parse(await readFile(process.env.DAYTONA_REPLAY_CASSETTE, "utf8")) : [] };
}
async function exec(sandbox: Sandbox, script: string, cfg: Config) {
  const result = await sandbox.process.executeCommand(`set -eu; ${script}`, undefined, {}, cfg.timeout);
  // Do not include attacker-controlled stdout or credentials in server errors.
  if (result.exitCode !== 0) throw new Error(`Sandbox command failed (exit ${result.exitCode}).`);
  return result.artifacts?.stdout ?? result.result ?? "";
}
function composeCommand(cfg: Config) { return `cd /workspace/codepool && docker compose --env-file /tmp/codepool-sandbox.env -f ${quote(cfg.compose)}`; }
async function archiveBytes(sha: string, cfg: Config): Promise<Buffer> {
  const descriptor = validateArchive(sha, cfg.archives);
  // Fetch on the trusted control plane; neither URL nor checkout token enters the VM.
  const response = await fetch(descriptor.url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error("Signed archive download failed.");
  const bytes = await readBoundedBody(response, 100 * 1024 * 1024);
  if (createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256.toLowerCase()) throw new Error("Archive digest mismatch.");
  return bytes;
}
async function prepare(sandbox: Sandbox, bytes: Buffer, sha: string, cfg: Config) {
  await sandbox.fs.uploadFile(bytes, "/tmp/codepool.tgz");
  await exec(sandbox, "mkdir -p /workspace/codepool && tar --no-same-owner --no-same-permissions -xzf /tmp/codepool.tgz --strip-components=1 -C /workspace/codepool && rm /tmp/codepool.tgz", cfg);
  const envFile = `NODE_ENV=production\nDATABASE_URL=${cfg.databaseUrl}\nREDIS_URL=redis://redis:6379\nCODEPOOL_TARGET_SHA=${sha}\nCODEPOOL_EGRESS_URL=http://host.docker.internal:8787/replay\n`;
  await sandbox.fs.uploadFile(Buffer.from(envFile), "/tmp/codepool-sandbox.env");
  const resolved = JSON.parse(await exec(sandbox, `${composeCommand(cfg)} config --format json`, cfg));
  validateCompose(resolved);
  await sandbox.fs.uploadFile(Buffer.from(replayServiceScript(cfg.cassette)), "/tmp/codepool-replay.cjs");
  await exec(sandbox, "nohup node /tmp/codepool-replay.cjs >/tmp/codepool-replay.log 2>&1 < /dev/null &", cfg);
  // Snapshot must have dependency/image caches: no live package downloads are permitted.
  await exec(sandbox, `${composeCommand(cfg)} up -d --build --pull never`, cfg);
  await sandbox.refreshData();
  if (sandbox.networkBlockAll !== true) throw new Error("Provider did not enforce block-all egress.");
}
class Environment implements SandboxEnvironment {
  private preview?: { url: string; token?: string };
  constructor(private sandbox: Sandbox, private cfg: Config, public baseSha: string) {}
  get id() { return this.sandbox.id; }
  async request(request: SandboxRequest): Promise<SandboxResponse> {
    const preview = this.preview ??= await this.sandbox.getPreviewLink(this.cfg.appPort);
    if (Object.keys(request.headers ?? {}).some(key => ["host", "connection", "x-daytona-preview-token"].includes(key.toLowerCase()))) throw new Error("Scenario cannot override preview routing headers.");
    const url = sandboxRequestUrl(request.path, preview.url);
    const started = performance.now();
    const response = await fetch(url, { method: request.method, redirect: "manual", signal: AbortSignal.timeout(30_000), headers: { ...request.headers, ...(preview.token ? { "x-daytona-preview-token": preview.token } : {}) }, body: request.body === undefined ? undefined : typeof request.body === "string" ? request.body : JSON.stringify(request.body) });
    if (!response.body) return { status: response.status, headers: Object.fromEntries(response.headers), body: "", elapsedMs: performance.now() - started };
    const raw = (await readBoundedBody(response, 2 * 1024 * 1024)).toString(); let body: unknown = raw;
    if (response.headers.get("content-type")?.includes("json")) { try { body = JSON.parse(raw); } catch { /* retain text */ } }
    return { status: response.status, headers: Object.fromEntries(response.headers), body, elapsedMs: performance.now() - started };
  }
  async seedDatabase(seed: SeedSnapshot) {
    await this.sandbox.fs.uploadFile(Buffer.from(seed.fixture), "/tmp/codepool-fixture.sql");
    await exec(this.sandbox, `${composeCommand(this.cfg)} exec -T postgres psql ${quote(this.cfg.databaseUrl)} --set ON_ERROR_STOP=1 < /tmp/codepool-fixture.sql`, this.cfg);
    return seed.seedId;
  }
  async seedRedis(seed: SeedSnapshot) {
    await exec(this.sandbox, `${composeCommand(this.cfg)} exec -T redis redis-cli FLUSHDB`, this.cfg);
    await exec(this.sandbox, `${composeCommand(this.cfg)} exec -T redis redis-cli SET __codepool_seed_id ${quote(seed.seedId)}`, this.cfg);
    return seed.seedId;
  }
  async auditEgress() {
    await this.sandbox.refreshData();
    if (!this.sandbox.networkBlockAll) throw new Error("Sandbox firewall was disabled during execution.");
    const audit = JSON.parse(await exec(this.sandbox, "curl --fail --silent http://127.0.0.1:8787/audit", this.cfg));
    if (audit.mode !== "offline-replay" || audit.misses !== 0) throw new Error("Run contains missing external API cassettes.");
    return { policy: "block-all" as const, replayed: Number(audit.replayed), misses: 0, verified: true as const };
  }
}
export class DaytonaSandboxProvisioner implements SandboxProvisioner {
  constructor(private daytona = client(), private downloadArchive?: (sha: string) => Promise<Buffer>) {}
  async provisionPair(baseSha: string, prSha: string): Promise<SandboxPair> {
    const cfg = await config();
    const bytes = await Promise.all([baseSha, prSha].map(sha => this.downloadArchive ? this.downloadArchive(sha) : archiveBytes(sha, cfg)));
    const pairId = `codepool-${randomUUID()}`;
    const created: Sandbox[] = [];
    try {
      for (const [role, sha] of [["base", baseSha], ["pr", prSha]]) {
        const params: CreateSandboxFromSnapshotParams = { snapshot: cfg.snapshot, public: false, networkBlockAll: true, ephemeral: true, autoDeleteInterval: 0, autoStopInterval: 15, ttlMinutes: 45, labels: { "codepool-provider": "daytona", "codepool-pair": pairId, "codepool-role": role, "codepool-sha": sha } };
        const sandbox = await this.daytona.create(params, { timeout: 300 });
        created.push(sandbox);
        // Snapshot allocations are authoritative; SDK snapshot params do not accept resources.
        await sandbox.refreshData();
        if (!sandbox.networkBlockAll || sandbox.cpu > 2 || sandbox.memory > 4 || sandbox.disk > 20) throw new Error("Snapshot exceeds approved resources or firewall policy is not enforced.");
      }
      const prepared = await Promise.allSettled(created.map((sandbox, i) => prepare(sandbox, bytes[i], i === 0 ? baseSha : prSha, cfg)));
      const failure = prepared.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      return { pairId, baseEnv: new Environment(created[0], cfg, baseSha), prEnv: new Environment(created[1], cfg, prSha) };
    } catch (error) {
      const cleanup = await Promise.allSettled(created.map(sandbox => this.daytona.delete(sandbox, 120, true)));
      if (cleanup.some(r => r.status === "rejected")) throw new AggregateError([error], `Sandbox provisioning failed; cleanup incomplete for pair ${pairId}. TTL remains active.`);
      throw error;
    }
  }
  async teardown(pairId: string) {
    if (!/^codepool-[a-f0-9-]{36}$/.test(pairId)) throw new Error("Invalid sandbox pair id.");
    const failures: unknown[] = [];
    // Durable provider labels work across Inngest workers and process restarts.
    for await (const sandbox of this.daytona.list({ labels: { "codepool-provider": "daytona", "codepool-pair": pairId } })) {
      try { await this.daytona.delete(sandbox, 120, true); } catch (error) { if (!isNotFound(error)) failures.push(error); }
    }
    for await (const sandbox of this.daytona.list({ labels: { "codepool-provider": "daytona", "codepool-pair": pairId } })) failures.push(sandbox.id);
    if (failures.length) throw new Error(`Sandbox cleanup incomplete for ${pairId}.`);
  }
}
export function listDaytonaManagedSandboxes(daytona = client()) { return daytona.list({ labels: { "codepool-provider": "daytona" } }); }
