import "dotenv/config";
import { Daytona } from "@daytonaio/sdk";
import { DaytonaSandboxProvisioner } from "../module/execution/sandbox/daytona-provisioner";
import type { SandboxPair } from "../module/execution/sandbox/provisioner";

const required = ["DAYTONA_API_KEY", "DAYTONA_REPO_URL", "DAYTONA_REPO_SLUG", "DAYTONA_COMPOSE_TEMPLATE", "DAYTONA_UPSTASH_REDIS_REST_URL_BASE", "DAYTONA_UPSTASH_REDIS_REST_URL_PR", "DAYTONA_UPSTASH_REDIS_REST_TOKEN_BASE", "DAYTONA_UPSTASH_REDIS_REST_TOKEN_PR"];
let failures = 0;
function assert(label: string, condition: boolean) { console.log(`${condition ? "PASS" : "FAIL"}: ${label}`); if (!condition) failures += 1; }

if (required.some((name) => !process.env[name]?.trim())) {
  console.log("SKIP: Daytona verification requires Daytona credentials, repository/compose settings, and separate base/PR Upstash Redis settings.");
  process.exit(0);
}

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, apiUrl: process.env.DAYTONA_API_URL, target: process.env.DAYTONA_TARGET });
const provisioner = new DaytonaSandboxProvisioner(daytona);
const baseSha = process.env.DAYTONA_VERIFY_BASE_SHA ?? "HEAD";
const prSha = process.env.DAYTONA_VERIFY_PR_SHA ?? baseSha;
const createdPairs: SandboxPair[] = [];

async function managedSandboxIds(pairId: string): Promise<string[]> {
  const ids: string[] = [];
  for await (const sandbox of daytona.list({ labels: { "codepool-pair": pairId } })) ids.push(sandbox.id);
  return ids;
}

async function runIsolationCheck(pair: SandboxPair): Promise<boolean> {
  const base = await daytona.get(pair.baseEnv.id);
  const pr = await daytona.get(pair.prEnv.id);
  const composeFile = process.env.DAYTONA_COMPOSE_TEMPLATE!;
  const envFile = "/tmp/codepool-sandbox.env";
  const normalizedBaseId = pair.baseEnv.id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "sandbox";
  const project = `codepool_base_${normalizedBaseId}`;
  const insert = `docker compose --env-file ${envFile} -f /workspace/codepool/${composeFile} -p ${project} exec -T postgres psql postgresql://postgres:postgres@postgres:5432/postgres -v ON_ERROR_STOP=1 -c \"CREATE TABLE IF NOT EXISTS daytona_isolation_probe (id text primary key); INSERT INTO daytona_isolation_probe VALUES ('base-only') ON CONFLICT DO NOTHING;\"`;
  const query = `docker compose --env-file ${envFile} -f /workspace/codepool/${composeFile} -p ${project} exec -T postgres psql postgresql://postgres:postgres@postgres:5432/postgres -tAc \"SELECT count(*) FROM daytona_isolation_probe WHERE id='base-only'\"`;
  const baseResult = await base.process.executeCommand(insert, undefined, {}, 60);
  const baseRead = await base.process.executeCommand(query, undefined, {}, 60);
  const normalizedPrId = pair.prEnv.id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "sandbox";
  const prProject = `codepool_pr_${normalizedPrId}`;
  const prQuery = `docker compose --env-file ${envFile} -f /workspace/codepool/${composeFile} -p ${prProject} exec -T postgres psql postgresql://postgres:postgres@postgres:5432/postgres -tAc \"SELECT count(*) FROM daytona_isolation_probe WHERE id='base-only'\"`;
  const prRead = await pr.process.executeCommand(prQuery, undefined, {}, 60);
  return baseResult.exitCode === 0 && String(baseRead.artifacts?.stdout ?? baseRead.result ?? "").trim() === "1" && String(prRead.artifacts?.stdout ?? prRead.result ?? "").trim() === "0";
}

try {
  const firstStarted = performance.now();
  const first = await provisioner.provisionPair(baseSha, prSha);
  createdPairs.push(first);
  const firstElapsed = performance.now() - firstStarted;
  const firstBaseSnapshot = (await daytona.get(first.baseEnv.id)).snapshot;
  assert("base and PR sandboxes are distinct", first.baseEnv.id !== first.prEnv.id);
  assert("base and PR report the requested SHAs", first.baseEnv.baseSha === baseSha && first.prEnv.baseSha === prSha);
  const healthBase = await first.baseEnv.request({ method: "GET", path: "/health" }).catch(() => null);
  const healthPr = await first.prEnv.request({ method: "GET", path: "/health" }).catch(() => null);
  assert("both sandboxes are reachable", healthBase !== null && healthPr !== null);
  assert("Postgres state is isolated between sandboxes", await runIsolationCheck(first));

  await provisioner.teardown(first.pairId);
  const afterTeardown = await managedSandboxIds(first.pairId);
  assert("teardown removes both sandboxes and list confirms they are gone", afterTeardown.length === 0);
  createdPairs.splice(createdPairs.indexOf(first), 1);

  const secondStarted = performance.now();
  const second = await provisioner.provisionPair(baseSha, prSha);
  createdPairs.push(second);
  const secondElapsed = performance.now() - secondStarted;
  const secondBaseSnapshot = (await daytona.get(second.baseEnv.id)).snapshot;
  assert("base template reuse hits the same Daytona snapshot on the second run", Boolean(firstBaseSnapshot && secondBaseSnapshot && firstBaseSnapshot === secondBaseSnapshot));
  assert("base template reuse makes the second provision meaningfully faster", secondElapsed < firstElapsed * 0.8 || secondElapsed < 30_000);
  await provisioner.teardown(second.pairId);
  assert("second teardown removes both sandboxes", (await managedSandboxIds(second.pairId)).length === 0);
  createdPairs.splice(createdPairs.indexOf(second), 1);
} catch (error) {
  failures += 1;
  console.error("FAIL: Daytona verification could not complete.", error);
} finally {
  for (const pair of createdPairs) {
    try { await provisioner.teardown(pair.pairId); } catch (error) { console.error(`FAIL: cleanup for ${pair.pairId}`, error); failures += 1; }
  }
  await daytona[Symbol.asyncDispose]().catch(() => undefined);
}

if (failures) process.exitCode = 1;
