import { readFile } from "node:fs/promises";
import { loadFixtureSnapshot } from "../module/execution/seed/fixtures";
import { runDifferentialPipeline } from "../module/execution/pipeline";
import type { SandboxEnvironment, SandboxPair, SandboxProvisioner, SandboxRequest, SandboxResponse, SeedSnapshot } from "../module/execution/sandbox/provisioner";

class FakeEnvironment implements SandboxEnvironment {
  readonly receivedSeeds: string[] = [];
  constructor(public readonly id: string, public readonly baseSha: string, private readonly regression: boolean, private readonly latencyRegression: boolean) {}
  async seedDatabase(snapshot: SeedSnapshot) { this.receivedSeeds.push(`database:${snapshot.seedId}`); return snapshot.seedId; }
  async seedRedis(snapshot: SeedSnapshot) { this.receivedSeeds.push(`redis:${snapshot.seedId}`); return snapshot.seedId; }
  async request(request: SandboxRequest): Promise<SandboxResponse> {
    void request;
    const isPr = this.baseSha === "pr";
    return {
      status: this.regression && isPr ? 422 : 200,
      headers: { "content-type": "application/json", "x-result": this.regression && isPr ? "rejected" : "ok" },
      body: this.regression && isPr ? { balance: 90 } : { balance: 100, refundId: "00000000-0000-4000-8000-000000000000", timestamp: "2026-09-13T00:00:00Z" },
      elapsedMs: this.latencyRegression && isPr ? 120 : 100,
    };
  }
}

class FakeProvisioner implements SandboxProvisioner {
  pair!: SandboxPair;
  teardownCount = 0;
  constructor(private readonly regression: boolean, private readonly latencyRegression: boolean) {}
  async provisionPair(baseSha: string, prSha: string): Promise<SandboxPair> {
    const baseEnv = new FakeEnvironment("base-isolated", baseSha, this.regression, this.latencyRegression);
    const prEnv = new FakeEnvironment("pr-isolated", prSha, this.regression, this.latencyRegression);
    this.pair = { pairId: `pair-${Date.now()}`, baseEnv, prEnv };
    return this.pair;
  }
  async teardown(pairId: string) { void pairId; this.teardownCount += 1; }
}

let failures = 0;
function assert(label: string, condition: boolean) { console.log(`${condition ? "PASS" : "FAIL"}: ${label}`); if (!condition) failures += 1; }

const fixture = await loadFixtureSnapshot("module/execution/seed/fixtures/transfer-money-v1.sql", "verify-v1", "sql");
const scenario = { id: "transfer-money", method: "POST", path: "/transfer", body: { from: "alice", to: "bob", amount: 10 } };

async function runCase(regression: boolean, latencyRegression: boolean) {
  const provisioner = new FakeProvisioner(regression, latencyRegression);
  const result = await runDifferentialPipeline({ repositoryId: "verify-sandbox", pullRequestId: "verify-pr", baseSha: "base", prSha: "pr", seed: fixture, scenarios: [scenario], runId: `verify-${regression}-${latencyRegression}`, provisioner, persistEvidence: false });
  return { ...result, provisioner };
}

try {
  const regression = await runCase(true, true);
  const base = regression.provisioner.pair.baseEnv as FakeEnvironment;
  const pr = regression.provisioner.pair.prEnv as FakeEnvironment;
  assert("both sandboxes received identical seedId", base.receivedSeeds.every((seed) => seed.endsWith(fixture.seedId)) && pr.receivedSeeds.every((seed) => seed.endsWith(fixture.seedId)));
  assert("fake provider kept base and PR environments isolated", base.id !== pr.id);
  assert("structural/status diff flags the reintroduced transfer bug", regression.evidence.json.some((diff) => diff.path === "$.balance" || diff.kind === "removed") && regression.evidence.statuses.some((diff) => diff.base === 200 && diff.pr === 422));
  assert("latency diff fires above the 15% threshold", regression.evidence.latency[0]?.flagged === true && (regression.evidence.latency[0]?.deltas.p50 ?? 0) > .15);
  assert("provider cleanup runs after the differential pipeline", regression.provisioner.teardownCount === 1);

  const noOp = await runCase(false, false);
  assert("latency diff does not flag a no-op PR", noOp.evidence.latency.every((diff) => diff.flagged === false));
  assert("no-op PR has no status or body diff", noOp.evidence.statuses.length === 0 && noOp.evidence.json.length === 0);

  const { readdir } = await import("node:fs/promises");
  const executionEntries = await readdir("module/execution", { recursive: true });
  const files = executionEntries.filter((entry) => entry.endsWith(".ts") && !entry.endsWith("sandbox/daytona-provisioner.ts")).map((entry) => `module/execution/${entry}`);
  const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const vendorReference = /from\s+["']@daytonaio\/sdk/i.test(contents.join("\n"));
  assert("no execution layer imports a concrete sandbox vendor SDK", !vendorReference);
} catch (error) {
  failures += 1;
  console.error("FAIL: sandbox differential verification could not complete.", error);
}

if (failures) process.exitCode = 1;
