import { expect, test } from "bun:test";
import { assertLocalDatabaseUrl, sandboxRequestUrl, validateArchive, validateCompose } from "./security";
import { graphProperties } from "@/module/knowledge-graph/lib/graph-writer";
import { graphLabels } from "@/module/knowledge-graph/lib/graph-writer";
import { constrainedLabels } from "@/module/knowledge-graph/schema/constraints";
import { canonicalize } from "../diff/canonicalizer";
import { shouldTriggerSandboxDiff } from "@/module/regression/judge";
import { SANDBOX_TRIGGER_SCORE } from "@/module/regression/risk-score";

test("all graph labels have uniqueness constraints", () => expect(constrainedLabels).toEqual(graphLabels));
test("nested evidence is serialized and provenance cannot be overwritten", () => expect(graphProperties({ id: "evil", confidence: 0, sourceType: "llm", evidence: { test: [1] }, names: ["a"] })).toEqual({ evidence: '{"test":[1]}', names: ["a"] }));
test("high impact alone routes to sandbox; low impact does not", () => { const input = { resurrectionDetected: false, apiEndpointAdjacent: false, confidence: .1 }; expect(shouldTriggerSandboxDiff({ ...input, impactScore: SANDBOX_TRIGGER_SCORE })).toBe(true); for (const score of [.1, NaN, Infinity]) expect(shouldTriggerSandboxDiff({ ...input, impactScore: score })).toBe(false); });
test("sandbox requests cannot escape preview origin", () => { for (const path of ["https://evil.test", "//evil.test", "/\\evil.test", "http://169.254.169.254/"]) expect(() => sandboxRequestUrl(path, "https://preview.test")).toThrow(); expect(sandboxRequestUrl("/health?ok=1", "https://preview.test")).toBe("https://preview.test/health?ok=1"); });
test("database isolation rejects external/shared hosts", () => { expect(() => assertLocalDatabaseUrl("postgresql://postgres:postgres@postgres:5432/postgres")).not.toThrow(); for (const host of ["prod.test", "127.0.0.1", "postgres.evil.test"]) expect(() => assertLocalDatabaseUrl(`postgresql://u:p@${host}/db`)).toThrow(); });
test("archive checkout requires full SHA, digest and short TTL", () => { const sha = "a".repeat(40), now = Date.now(); const value = { url: "https://artifacts.test/commit", expiresAt: new Date(now + 60_000).toISOString(), sha256: "b".repeat(64) }; expect(validateArchive(sha, { [sha]: value }, now)).toEqual(value); expect(() => validateArchive("HEAD", { [sha]: value }, now)).toThrow(); expect(() => validateArchive(sha, { [sha]: { ...value, expiresAt: new Date(now + 700_000).toISOString() } }, now)).toThrow(); });
test("unsafe Compose is rejected", () => { expect(() => validateCompose({ services: { app: { privileged: true }, postgres: {}, redis: {} } })).toThrow(); });
test("nested UUIDs and timestamps canonicalize identically", () => { expect(canonicalize({ nested: { text: "00000000-0000-4000-8000-000000000001 at 2024-01-01T00:00:00Z" } })).toEqual(canonicalize({ nested: { text: "00000000-0000-4000-8000-000000000002 at 2025-02-02T00:00:00Z" } })); });

test("Compose cannot smuggle host sockets through configs or disable no-new-privileges", () => {
  const service = { user: "1000:1000", pids_limit: 128, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"] };
  const services = { app: { ...service, environment: { CODEPOOL_EGRESS_URL: "http://host.docker.internal:8787/replay" }, extra_hosts: ["host.docker.internal:host-gateway"] }, postgres: service, redis: service };
  expect(() => validateCompose({ services })).not.toThrow();
  for (const override of [{ configs: [{ source: "socket" }] }, { secrets: [{ source: "socket" }] }, { security_opt: ["no-new-privileges:false"] }, { security_opt: ["no-new-privileges:true", "seccomp:unconfined"] }]) expect(() => validateCompose({ services: { ...services, app: { ...services.app, ...override } } })).toThrow();
});
