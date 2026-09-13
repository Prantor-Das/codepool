import "dotenv/config";
import { Daytona } from "@daytonaio/sdk";
import { DaytonaSandboxProvisioner } from "../module/execution/sandbox/daytona-provisioner";
import { snapshotFromFixture } from "../module/execution/seed/fixtures";

if (!process.env.DAYTONA_API_KEY || !process.env.DAYTONA_TEMPLATE_SNAPSHOT) {
  console.log("SKIP: Daytona verification requires an API key and a prepared template snapshot.");
  process.exit(0);
}
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, apiUrl: process.env.DAYTONA_API_URL, target: process.env.DAYTONA_TARGET, requestTimeoutMs: 30_000 });
const provisioner = new DaytonaSandboxProvisioner(daytona);
let pairId: string | undefined;
try {
  const snapshot = await daytona.snapshot.get(process.env.DAYTONA_TEMPLATE_SNAPSHOT);
  if (snapshot.cpu > 2 || snapshot.mem > 4 || snapshot.disk > 20) throw new Error("Template exceeds the approved 2 CPU / 4 GiB / 20 GiB budget.");
  console.log("PASS: configured Daytona template exists and meets resource ceilings.");
  if (!process.env.DAYTONA_REPO_ARCHIVES_JSON || !process.env.DAYTONA_VERIFY_BASE_SHA || !process.env.DAYTONA_VERIFY_PR_SHA || !process.env.SANDBOX_FIXTURE_SNAPSHOT) {
    console.log("SKIP: live pair verification needs DAYTONA_REPO_ARCHIVES_JSON, full base/PR verification SHAs, and SANDBOX_FIXTURE_SNAPSHOT. Production workers download commit archives on the control plane using the repository owner's GitHub account.");
  } else {
    const pair = await provisioner.provisionPair(process.env.DAYTONA_VERIFY_BASE_SHA, process.env.DAYTONA_VERIFY_PR_SHA);
    pairId = pair.pairId;
    if (pair.baseEnv.id === pair.prEnv.id) throw new Error("Sandbox IDs must differ.");
    const seed = snapshotFromFixture({ version: "verify", format: "sql", fixture: process.env.SANDBOX_FIXTURE_SNAPSHOT });
    await Promise.all([pair.baseEnv.seedDatabase(seed), pair.prEnv.seedDatabase(seed), pair.baseEnv.seedRedis(seed), pair.prEnv.seedRedis(seed)]);
    console.log("PASS: separate VMs accepted the same database and Redis seed.");
    for (const environment of [pair.baseEnv, pair.prEnv]) {
      const health = await environment.request({ method: "GET", path: "/health" });
      if (health.status >= 400) throw new Error("Sandbox health check failed.");
      await environment.auditEgress!();
    }
    console.log("PASS: both apps respond and provider block-all/offline replay assertions hold.");
    await provisioner.teardown(pair.pairId); pairId = undefined;
    console.log("PASS: provider confirms sandbox pair deletion.");
  }
} catch (error) {
  console.error("FAIL: Daytona verification could not complete:", error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[provider URL]") : "provider unavailable");
  process.exitCode = 1;
} finally {
  if (pairId) await provisioner.teardown(pairId);
  await daytona[Symbol.asyncDispose]();
}
