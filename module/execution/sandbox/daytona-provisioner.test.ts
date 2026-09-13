import { expect, test } from "bun:test";
import type { Daytona } from "@daytonaio/sdk";
import { DaytonaSandboxProvisioner } from "./daytona-provisioner";

const safeService = { user: "1000:1000", pids_limit: 128, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"] };
const compose = { services: { app: { ...safeService, environment: { CODEPOOL_EGRESS_URL: "http://host.docker.internal:8787/replay" }, extra_hosts: ["host.docker.internal:host-gateway"] }, postgres: safeService, redis: safeService } };

test("Daytona enforces firewall, uploads only bytes, audits replay, and cleans up across instances", async () => {
  const saved = { ...process.env };
  process.env.DAYTONA_TEMPLATE_SNAPSHOT = "test-snapshot"; process.env.DAYTONA_COMPOSE_TEMPLATE = "docker-compose.yml";
  delete process.env.DAYTONA_NETWORK_BLOCK_ALL; delete process.env.DAYTONA_DOMAIN_ALLOW_LIST; delete process.env.DAYTONA_REPLAY_CASSETTE;
  const creations: Record<string, unknown>[] = [], uploads: string[] = [], deleted: string[] = [];
  const sandboxes: Array<Record<string, unknown>> = [];
  const sdk = {
    create: async (params: Record<string, unknown>) => {
      creations.push(params);
      const sandbox = { id: `sandbox-${creations.length}`, labels: params.labels, networkBlockAll: true, cpu: 2, memory: 4, disk: 20, refreshData: async () => {}, fs: { uploadFile: async (bytes: Buffer) => { uploads.push(bytes.toString()); } }, process: { executeCommand: async (cmd: string) => ({ exitCode: 0, result: cmd.includes("config --format") ? JSON.stringify(compose) : cmd.includes("/audit") ? '{"mode":"offline-replay","replayed":2,"misses":0}' : "" }) } };
      sandboxes.push(sandbox); return sandbox;
    },
    delete: async (sandbox: { id: string }) => { deleted.push(sandbox.id); },
    list: async function* () { for (const sandbox of sandboxes) if (!deleted.includes(String(sandbox.id))) yield sandbox; },
  } as unknown as Daytona;
  try {
    const provider = new DaytonaSandboxProvisioner(sdk, async () => Buffer.from("archive bytes"));
    const pair = await provider.provisionPair("a".repeat(40), "b".repeat(40));
    expect(creations).toHaveLength(2);
    expect(creations.every(p => p.networkBlockAll === true && p.public === false && p.ttlMinutes === 45)).toBe(true);
    expect(uploads.some(value => value.includes("CHECKOUT_TOKEN"))).toBe(false);
    expect(await pair.baseEnv.auditEgress!()).toEqual({ policy: "block-all", verified: true, replayed: 2, misses: 0 });
    await new DaytonaSandboxProvisioner(sdk).teardown(pair.pairId);
    expect(deleted).toHaveLength(2);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
