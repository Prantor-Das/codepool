import type { SandboxEnvironment, SandboxPair, SeedSnapshot } from "../sandbox/provisioner";

export async function applyRedisSeed(environment: SandboxEnvironment, snapshot: SeedSnapshot): Promise<string> {
  const seedId = await environment.seedRedis(snapshot);
  if (seedId !== snapshot.seedId) throw new Error(`Redis seed mismatch in ${environment.id}: expected ${snapshot.seedId}, got ${seedId}`);
  return seedId;
}

export async function seedRedisInstances(pair: SandboxPair, snapshot: SeedSnapshot): Promise<{ baseSeedId: string; prSeedId: string }> {
  const [baseSeedId, prSeedId] = await Promise.all([applyRedisSeed(pair.baseEnv, snapshot), applyRedisSeed(pair.prEnv, snapshot)]);
  return { baseSeedId, prSeedId };
}
