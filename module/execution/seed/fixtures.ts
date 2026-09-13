import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SeedSnapshot } from "../sandbox/provisioner";

export type FixtureFormat = "sql" | "mongo" | "redis";

export interface FixtureSource {
  version: string;
  format: FixtureFormat;
  fixture: string;
}

export function snapshotFromFixture(source: FixtureSource): SeedSnapshot {
  if (!source.fixture.trim()) throw new Error("A frozen fixture snapshot cannot be empty.");
  return {
    version: source.version,
    fixture: source.fixture,
    seedId: createHash("sha256").update(source.fixture, "utf8").digest("hex"),
  };
}

export async function loadFixtureSnapshot(filePath: string, version: string, format: FixtureFormat = "sql"): Promise<SeedSnapshot> {
  const fixture = await readFile(resolve(filePath), "utf8");
  return snapshotFromFixture({ version, format, fixture });
}

/** Faker/random data is intentionally not supported: replay requires a frozen snapshot. */
export function rejectFreshSeed(strategy: string): never {
  throw new Error(`Non-deterministic seed strategy rejected: ${strategy}. Use a versioned frozen fixture snapshot.`);
}
