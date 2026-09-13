import { inngest } from "@/inngest/client";
import { getSandboxProvisioner } from "@/module/execution/sandbox/provisioner";
import { runDifferentialPipeline } from "@/module/execution/pipeline";
import { snapshotFromFixture } from "@/module/execution/seed/fixtures";
import type { Scenario } from "@/module/execution/traffic/scenario-runner";
import { explainRuntimeDiff, type RuntimeDiffEvidenceBundle } from "@/module/ai/explain-runtime-diff";
import { formatRuntimeDiffComment } from "@/module/github/runtime-diff-comment";
import { postRuntimeDiffComment } from "@/module/github/lib/github";
import { prisma } from "@/src/prisma/db";

type SandboxBuildEvent = { repositoryId: string; pullRequestId: string; baseSha: string; prSha: string; fixture: string; fixtureVersion: string; scenarios?: Scenario[]; runId: string; owner?: string; repo?: string; prNumber?: number; userId?: string; judgeContext?: Record<string, unknown> };

export const buildSandbox = inngest.createFunction(
  { id: "build-sandbox-pair", triggers: [{ event: "sandbox.build.requested" }] },
  async ({ event, step }) => {
    const data = event.data as SandboxBuildEvent;
    const provisioner = getSandboxProvisioner();
    const pair = await step.run("provision-isolated-sandbox-pair", () => provisioner.provisionPair(data.baseSha, data.prSha));
    await provisioner.teardown(pair.pairId);
    await inngest.send({ name: "sandbox.ready", data: { ...data, pairId: pair.pairId } });
    return { pairId: pair.pairId };
  },
);

export const requestDifferentialRun = inngest.createFunction(
  { id: "request-differential-run", triggers: [{ event: "sandbox.ready" }] },
  async ({ event }) => {
    await inngest.send({ name: "differential-run.requested", data: event.data });
    return { requested: true };
  },
);

export const runDifferential = inngest.createFunction(
  { id: "run-differential-sandbox-diff", triggers: [{ event: "differential-run.requested" }] },
  async ({ event, step }) => {
    const data = event.data as SandboxBuildEvent;
    const seed = snapshotFromFixture({ version: data.fixtureVersion, format: "sql", fixture: data.fixture });
    const result = await step.run("run-identical-traffic-against-both-branches", () => runDifferentialPipeline({
      repositoryId: data.repositoryId, pullRequestId: data.pullRequestId, baseSha: data.baseSha, prSha: data.prSha,
      seed, scenarios: data.scenarios, runId: data.runId,
    }));
    await inngest.send({ name: "differential-run.completed", data: { ...data, pairId: result.pairId, evidence: result.evidence } });
    return result;
  },
);

export const publishDifferentialEvidenceComment = inngest.createFunction(
  { id: "publish-differential-evidence-comment", triggers: [{ event: "differential-run.completed" }] },
  async ({ event, step }) => {
    const data = event.data as SandboxBuildEvent & { evidence: RuntimeDiffEvidenceBundle["evidence"] };
    if (!data.owner || !data.repo || typeof data.prNumber !== "number" || !data.userId) return { posted: false, reason: "missing GitHub context" };
    const account = await step.run("load-github-account-for-runtime-evidence", () => prisma.orm.public.Account.where({ userId: data.userId, providerId: "github" }).first());
    if (!account?.accessToken) throw new Error("No GitHub access token found for runtime evidence comment.");
    const context = data.judgeContext ?? {};
    const bundle: RuntimeDiffEvidenceBundle = {
      changedSymbols: (context.changedSymbols as unknown[]) ?? [],
      graphNeighborhood: context,
      historical: (context.historical as RuntimeDiffEvidenceBundle["historical"]) ?? [],
      semanticMatches: (context.semanticContext as unknown[]) ?? [],
      evidence: data.evidence,
      commitSha: data.prSha,
    };
    const explanation = await step.run("explain-runtime-diff-with-evidence", () => explainRuntimeDiff(bundle));
    const comment = formatRuntimeDiffComment(bundle, explanation);
    await step.run("post-runtime-diff-comment", () => postRuntimeDiffComment(account.accessToken!, data.owner!, data.repo!, data.prNumber!, comment));
    return { posted: true, evidenceLevel: explanation.findings[0]?.evidenceLevel };
  },
);
