import { retrieveContext, retrieveAntibodyContext } from "@/module/ai/lib/rag";
import { getBlastRadius, type ImpactSubgraph } from "@/module/knowledge-graph/impact/blast-radius";
import { getHistoricalImpact, type HistoricalImpact } from "@/module/knowledge-graph/impact/historical-impact";
import { computeImpactScore, SANDBOX_TRIGGER_SCORE } from "./risk-score";

export type RegressionJudgeContext = ImpactSubgraph & {
  historical: HistoricalImpact[];
  semanticContext: string[];
  changedIdentifiers: string[];
  impactScore: number;
  riskTier: "standard-review" | "sandbox-diff-engine";
  resurrectionDetected: boolean;
  apiEndpointAdjacent: boolean;
  judgeConfidence?: number;
};

export function shouldTriggerSandboxDiff(input: Pick<RegressionJudgeContext, "resurrectionDetected" | "apiEndpointAdjacent"> & { confidence?: number; explicitFullVerification?: boolean; impactScore?: number }): boolean {
  return (Number.isFinite(input.impactScore) && input.impactScore! >= SANDBOX_TRIGGER_SCORE) || input.resurrectionDetected || input.apiEndpointAdjacent || input.explicitFullVerification === true || (typeof input.confidence === "number" && input.confidence >= .4 && input.confidence <= .9);
}

/** Best-effort changed declaration names from a unified diff; graph lookup accepts names or ids. */
export function changedIdentifiersFromDiff(diff: string) {
  const names = new Set<string>();
  for (const line of diff.split("\n")) {
    const file = line.match(/^\+\+\+ b\/(.+)$/)?.[1];
    if (file) names.add(file); // Body-only edits still select declarations in the changed file.
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const match = line.match(/(?:function|class)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (match?.[1] || match?.[2]) names.add(match[1] ?? match[2]);
  }
  return [...names];
}

export async function buildRegressionJudgeContext(input: { repositoryId: string; repoSlug: string; title: string; description?: string | null; diff: string; judgeConfidence?: number; explicitFullVerification?: boolean }): Promise<RegressionJudgeContext> {
  const changedIdentifiers = changedIdentifiersFromDiff(input.diff);
  const semanticPromise = retrieveContext(`${input.title}\n${input.description ?? ""}\n${changedIdentifiers.join(" ")}`, input.repoSlug);
  // Graph availability is an enhancement: a missing Neo4j configuration must not block ordinary review.
  const graph = await Promise.all([getBlastRadius(input.repositoryId, changedIdentifiers), getHistoricalImpact(input.repositoryId, changedIdentifiers)]).catch(() => [
    { changedSymbols: [], callers: [], reachableSymbols: [], antibodies: [], endpoints: [], scenarios: [], dataDependencies: [] } as ImpactSubgraph,
    [] as HistoricalImpact[],
  ] as const);
  const semanticContext = [...await semanticPromise.catch(() => [] as string[]), ...await retrieveAntibodyContext(`${input.title}\n${changedIdentifiers.join(" ")}`, input.repositoryId).catch(() => [] as string[])];
  const changeMagnitude = Math.min(1, input.diff.split("\n").filter((line) => line.startsWith("+") || line.startsWith("-")).length / 100);
  const impactScore = computeImpactScore({ ...graph[0], historical: graph[1], changeMagnitude });
  const resurrectionDetected = graph[1].length > 0;
  const apiEndpointAdjacent = graph[0].endpoints.length > 0;
  return { ...graph[0], historical: graph[1], semanticContext, changedIdentifiers, impactScore, resurrectionDetected, apiEndpointAdjacent, judgeConfidence: input.judgeConfidence, riskTier: shouldTriggerSandboxDiff({ impactScore, confidence: input.judgeConfidence, explicitFullVerification: input.explicitFullVerification, resurrectionDetected, apiEndpointAdjacent }) ? "sandbox-diff-engine" : "standard-review" };
}
