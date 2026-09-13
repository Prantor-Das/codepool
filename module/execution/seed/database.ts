import type { SandboxEnvironment, SandboxPair, SeedSnapshot } from "../sandbox/provisioner";

export async function applyDatabaseSeed(environment: SandboxEnvironment, snapshot: SeedSnapshot): Promise<string> {
  const seedId = await environment.seedDatabase(snapshot);
  if (seedId !== snapshot.seedId) throw new Error(`Database seed mismatch in ${environment.id}: expected ${snapshot.seedId}, got ${seedId}`);
  return seedId;
}

export async function seedDatabases(pair: SandboxPair, snapshot: SeedSnapshot): Promise<{ baseSeedId: string; prSeedId: string }> {
  const [baseSeedId, prSeedId] = await Promise.all([applyDatabaseSeed(pair.baseEnv, snapshot), applyDatabaseSeed(pair.prEnv, snapshot)]);
  return { baseSeedId, prSeedId };
}
