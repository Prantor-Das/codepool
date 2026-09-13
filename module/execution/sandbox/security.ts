/** Only sandbox-local Postgres is supported; each VM owns its own Compose network. */
export function assertLocalDatabaseUrl(value: string) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "postgres" || (url.port && url.port !== "5432") || /[\r\n]/.test(value)) throw new Error("Sandbox DATABASE_URL must address its local Compose postgres:5432 service.");
}

export function sandboxRequestUrl(path: string, preview: string): string {
  const base = new URL(preview);
  const url = new URL(path, base);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || url.origin !== base.origin || url.username || url.password) throw new Error("Scenario requests must stay on the sandbox preview origin.");
  return url.toString();
}

export type ArchiveDescriptor = { url: string; expiresAt: string; sha256: string };
export function validateArchive(sha: string, archives: Record<string, ArchiveDescriptor>, now = Date.now()): ArchiveDescriptor {
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error("Sandbox checkout requires a full commit SHA.");
  const archive = archives[sha];
  if (!archive || !/^[a-f0-9]{64}$/i.test(archive.sha256)) throw new Error("A commit-scoped signed archive and SHA-256 digest are required.");
  const url = new URL(archive.url);
  const ttl = Date.parse(archive.expiresAt) - now;
  if (url.protocol !== "https:" || url.username || url.password || !Number.isFinite(ttl) || ttl <= 0 || ttl > 600_000) throw new Error("Signed archives must use HTTPS and expire within ten minutes.");
  return archive;
}

/** Reject host access and privilege escalation before any untrusted Compose build runs. */
export function validateCompose(config: { services?: Record<string, Record<string, unknown>>; volumes?: Record<string, Record<string, unknown>> }) {
  if (!config.services?.postgres || !config.services?.redis || !config.services?.app) throw new Error("Sandbox Compose requires app, postgres and redis services.");
  for (const volume of Object.values(config.volumes ?? {})) if (volume.external || volume.driver_opts || (volume.driver && volume.driver !== "local")) throw new Error("Only sandbox-local managed volumes are allowed.");
  const app = config.services.app;
  if ((app.environment as Record<string, string>)?.CODEPOOL_EGRESS_URL !== "http://host.docker.internal:8787/replay" || !JSON.stringify(app.extra_hosts).includes("host-gateway")) throw new Error("App must receive CODEPOOL_EGRESS_URL and host.docker.internal:host-gateway.");
  for (const [name, service] of Object.entries(config.services)) {
    const user = String(service.user ?? "");
    if (!/^[1-9][0-9]*(?::[1-9][0-9]*)?$/.test(user)) throw new Error(`Service ${name} requires an explicit non-root numeric user.`);
    if (!Number.isInteger(service.pids_limit) || Number(service.pids_limit) <= 0 || Number(service.pids_limit) > 512) throw new Error(`Service ${name} requires pids_limit between 1 and 512.`);
    if (service.privileged || service.network_mode || service.pid || service.ipc || service.devices || service.cap_add || service.volumes_from || service.develop || service.use_api_socket || service.configs || service.secrets) throw new Error(`Unsafe privileges in service ${name}.`);
    if (!Array.isArray(service.cap_drop) || !service.cap_drop.includes("ALL") || !Array.isArray(service.security_opt) || !service.security_opt.length || !service.security_opt.every(v => ["no-new-privileges", "no-new-privileges:true"].includes(String(v)))) throw new Error(`Service ${name} must drop ALL capabilities and set no-new-privileges.`);
    for (const volume of (service.volumes ?? []) as Array<{ type?: string }>) if (volume.type !== "volume" && volume.type !== "tmpfs") throw new Error(`Host mounts are forbidden in ${name}.`);
    const build = service.build as Record<string, unknown> | undefined;
    if (build && (build.privileged || build.entitlements || build.ssh || build.secrets || build.network === "host")) throw new Error(`Unsafe build configuration in ${name}.`);
  }
}
