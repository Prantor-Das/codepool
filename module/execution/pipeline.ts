import { cleanupSandboxPair, withSandboxCleanup } from "./sandbox/cleanup";
import { getSandboxProvisioner, type SandboxProvisioner, type SandboxPair, type SeedSnapshot } from "./sandbox/provisioner";
import { seedDatabases } from "./seed/database";
import { seedRedisInstances } from "./seed/redis";
import { buildEvidenceObject, type EvidenceObject } from "./diff/evidence-builder";
import { persistEvidenceObject } from "./diff/persist-evidence";
import { runScenarioPair, selectScenarios, type Scenario } from "./traffic/scenario-runner";

export interface DifferentialRunInput {
  repositoryId: string;
  pullRequestId: string;
  baseSha: string;
  prSha: string;
  seed: SeedSnapshot;
  scenarios?: Scenario[];
  scenarioSources?: Parameters<typeof selectScenarios>[0];
  runId: string;
  provisioner?: SandboxProvisioner;
  firstTimeSeen?: boolean;
  persistEvidence?: boolean;
}

export async function runDifferentialPipeline(input: DifferentialRunInput): Promise<{ evidence: EvidenceObject; pairId: string }> {
  const provisioner = input.provisioner ?? getSandboxProvisioner();
  const pair = await provisioner.provisionPair(input.baseSha, input.prSha);
  return withSandboxCleanup(provisioner, pair, async () => {
    const [databaseSeeds, redisSeeds] = await Promise.all([seedDatabases(pair, input.seed), seedRedisInstances(pair, input.seed)]);
    if (databaseSeeds.baseSeedId !== databaseSeeds.prSeedId || redisSeeds.baseSeedId !== redisSeeds.prSeedId) throw new Error("Base and PR sandboxes did not receive identical seed IDs.");
    const selected = input.scenarios ? { source: "integration-test" as const, scenarios: input.scenarios } : selectScenarios(input.scenarioSources ?? {});
    const runs = await runScenarioPair(pair, selected.scenarios);
    const evidence = buildEvidenceObject({ runId: input.runId, pairId: pair.pairId, seedId: input.seed.seedId, baseSha: input.baseSha, prSha: input.prSha, scenarioSource: selected.source, base: runs.base, pr: runs.pr, firstTimeSeen: input.firstTimeSeen });
    if (input.persistEvidence !== false) await persistEvidenceObject({ repositoryId: input.repositoryId, pullRequestId: input.pullRequestId, evidence, antibodyId: undefined });
    return { evidence, pairId: pair.pairId };
  });
}

export async function cleanupAfterDifferentialRun(provisioner: SandboxProvisioner, pair: SandboxPair): Promise<void> {
  await cleanupSandboxPair(provisioner, pair);
}
