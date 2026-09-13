/**
 * Provider-neutral contract for a pair of isolated, managed sandboxes.
 *
 * A concrete provider MUST provision separate compute, network, database and
 * volume resources for the two environments. The rest of the execution
 * pipeline deliberately knows nothing about how that isolation is achieved.
 */
export interface SandboxRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface SandboxResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  elapsedMs: number;
}

export interface SeedSnapshot {
  seedId: string;
  fixture: string;
  version: string;
}

export interface SandboxEnvironment {
  id: string;
  baseSha: string;
  request(request: SandboxRequest): Promise<SandboxResponse>;
  seedDatabase(snapshot: SeedSnapshot): Promise<string>;
  seedRedis(snapshot: SeedSnapshot): Promise<string>;
  auditEgress?(): Promise<{ policy: "block-all"; replayed: number; misses: number; verified: true }>;
}

export interface SandboxPair {
  pairId: string;
  baseEnv: SandboxEnvironment;
  prEnv: SandboxEnvironment;
}

export interface SandboxProvisioner {
  provisionPair(baseSha: string, prSha: string): Promise<SandboxPair>;
  teardown(pairId: string): Promise<void>;
}

/** Explicit default until a managed provider is wired in a follow-up. */
export class NotImplementedProvisioner implements SandboxProvisioner {
  async provisionPair(baseSha: string, prSha: string): Promise<SandboxPair> {
    void baseSha; void prSha;
    throw new Error("No managed sandbox provider is configured yet.");
  }

  async teardown(pairId: string): Promise<void> {
    void pairId;
    throw new Error("No managed sandbox provider is configured yet.");
  }
}

export function getSandboxProvisioner(): SandboxProvisioner {
  if (process.env.SANDBOX_PROVIDER === "daytona") {
    return new DaytonaSandboxProvisioner();
  }
  return new NotImplementedProvisioner();
}
import { DaytonaSandboxProvisioner } from "./daytona-provisioner";
