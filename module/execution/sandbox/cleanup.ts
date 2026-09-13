import type { SandboxPair, SandboxProvisioner } from "./provisioner";

/** Always tears down both sides through the provider contract. */
export async function cleanupSandboxPair(provisioner: SandboxProvisioner, pair: SandboxPair): Promise<void> {
  await provisioner.teardown(pair.pairId);
}

export async function withSandboxCleanup<T>(
  provisioner: SandboxProvisioner,
  pair: SandboxPair,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } finally {
    await cleanupSandboxPair(provisioner, pair);
  }
}
