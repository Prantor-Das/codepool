import { DaytonaSandboxProvisioner } from "@/module/execution/sandbox/daytona-provisioner";
import { downloadGitHubArchive } from "@/module/execution/sandbox/archive";
import { inngest } from "@/inngest/client";
import { runDifferentialPipeline } from "@/module/execution/pipeline";
import { snapshotFromFixture } from "@/module/execution/seed/fixtures";
import type { Scenario } from "@/module/execution/traffic/scenario-runner";
import type { CassetteEntry } from "@/module/execution/traffic/replay-proxy";
import { explainRuntimeDiff, type RuntimeDiffEvidenceBundle } from "@/module/ai/explain-runtime-diff";
import { formatRuntimeComparison, formatRuntimeDiffComment } from "@/module/github/runtime-diff-comment";
import { getGithubTokenForUser, postRuntimeDiffComment } from "@/module/github/lib/github";
import { prisma } from "@/src/prisma/db";

type SandboxBuildEvent = { repositoryId: string; pullRequestId: string; baseSha: string; prSha: string; fixture: string; fixtureVersion: string; scenarios?: Scenario[]; replayCassette?: CassetteEntry[]; runId: string; owner?: string; repo?: string; prNumber?: number; userId?: string; judgeContext?: Record<string, unknown> };

export const buildSandbox = inngest.createFunction(
  { id: "build-sandbox-pair", triggers: [{ event: "sandbox.build.requested" }] },
  async ({ event, step }) => {
    const data = event.data as SandboxBuildEvent;
    // Provision and execute within one durable step; class instances cannot be serialized.
    await step.sendEvent("request-differential-run", { name: "differential-run.requested", data });
    return { requested: true };

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
  {
    id: "run-differential-sandbox-diff",
    triggers: [{ event: "differential-run.requested" }],
    // A differential run owns two Daytona sandboxes (base + PR). Daytona's
    // organization quota is shared by all runs, so allowing concurrent runs
    // can exceed the 10 GiB account limit even when each pair is valid.
    concurrency: 1,
  },
  async ({ event, step }) => {
    const data = event.data as SandboxBuildEvent;
    const seed = snapshotFromFixture({ version: data.fixtureVersion, format: "sql", fixture: data.fixture });
    let result: Awaited<ReturnType<typeof runDifferentialPipeline>>;
    try {
      result = await step.run("run-identical-traffic-against-both-branches", async () => {
        const repository = await prisma.orm.public.Repository.where({ id: data.repositoryId, userId: data.userId }).first();
        if (!repository || !data.userId || data.pullRequestId !== `${repository.id}:pr:${data.prNumber}`) throw new Error("Invalid sandbox repository context.");
        const account = await prisma.orm.public.Account.where({ userId: repository.userId, providerId: "github" }).first();
        if (!account?.accessToken) throw new Error("GitHub account unavailable for archive checkout.");
        const provisioner = process.env.SANDBOX_PROVIDER === "daytona" ? new DaytonaSandboxProvisioner(undefined, async sha => downloadGitHubArchive(repository.owner, repository.name, sha, await getGithubTokenForUser(repository.userId)), data.replayCassette) : undefined;
        return runDifferentialPipeline({ repositoryId: repository.id, pullRequestId: data.pullRequestId, baseSha: data.baseSha, prSha: data.prSha,
          seed, scenarios: data.scenarios, runId: data.runId, provisioner });
      });
    } catch (error) {
      await step.run("mark-sandbox-comparison-failed", async () => {
        if (typeof data.prNumber !== "number") return;
        const review = await prisma.orm.public.Review.where({ repositoryId: data.repositoryId, prNumber: data.prNumber }).first();
        if (!review) return;
        try {
          const parsed = JSON.parse(review.review) as Record<string, unknown>;
          parsed.performanceComparison = `Sandbox differential comparison failed before measurements were available: ${error instanceof Error ? error.message : "unknown sandbox error"}`;
          await prisma.orm.public.Review.where({ id: review.id }).update({ review: JSON.stringify(parsed) });
        } catch {
          // Preserve the original Inngest failure for retry diagnostics.
        }
      });
      throw error;
    }
    await step.run("save-measured-performance-comparison", async () => {
      if (typeof data.prNumber !== "number") return;
      const review = await prisma.orm.public.Review.where({
        repositoryId: data.repositoryId,
        prNumber: data.prNumber,
      }).first();
      if (!review) return;
      try {
        const parsed = JSON.parse(review.review) as Record<string, unknown>;
        parsed.performanceComparison = `Measured sandbox differential results:\n\n${formatRuntimeComparison({
          changedSymbols: [],
          graphNeighborhood: {},
          historical: [],
          evidence: result.evidence,
        })}`;
        await prisma.orm.public.Review.where({ id: review.id }).update({
          review: JSON.stringify(parsed),
        });
      } catch {
        // The GitHub runtime comment remains the fallback for legacy payloads.
      }
    });
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
    await step.run("post-runtime-diff-comment", async () => postRuntimeDiffComment(await getGithubTokenForUser(data.userId!), data.owner!, data.repo!, data.prNumber!, comment));
    await step.run("save-runtime-comparison-to-review", async () => {
      const review = await prisma.orm.public.Review.where({
        repositoryId: data.repositoryId,
        prNumber: data.prNumber,
      }).first();
      if (!review) return;
      try {
        const parsed = JSON.parse(review.review) as Record<string, unknown>;
        parsed.performanceComparison = `Measured sandbox differential results:\n\n${formatRuntimeComparison(bundle)}`;
        await prisma.orm.public.Review.where({ id: review.id }).update({
          review: JSON.stringify(parsed),
        });
      } catch {
        // A failed/legacy review payload should not prevent the runtime report
        // from being posted to GitHub.
      }
    });
    return { posted: true, evidenceLevel: explanation.findings[0]?.evidenceLevel };
  },
);
