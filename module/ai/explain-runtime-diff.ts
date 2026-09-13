import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import type { EvidenceObject } from "@/module/execution/diff/evidence-builder";
import type { BranchRun } from "@/module/execution/traffic/scenario-runner";

export type EvidenceLevel = "E0" | "E1" | "E2" | "E3" | "E4" | "E5";
export const EVIDENCE_LEVEL_DESCRIPTIONS: Record<EvidenceLevel, string> = {
  E0: "LLM hypothesis",
  E1: "semantic similarity",
  E2: "graph/static evidence",
  E3: "historical causal evidence",
  E4: "regression test failure",
  E5: "differential runtime reproduction",
};

export interface RuntimeDiffEvidenceBundle {
  changedSymbols: unknown[];
  graphNeighborhood: unknown;
  historical: Array<{ antibodyId?: string; historicalPullRequestId?: string; historicalBug?: string; issue?: string; invariant?: string; historicalFix?: string }>;
  semanticMatches?: unknown[];
  regressionTests?: Array<{ name?: string; passed: boolean; details?: string }>;
  baseRun?: BranchRun;
  prRun?: BranchRun;
  evidence: EvidenceObject;
  issueNumber?: number;
  historicalPrNumber?: number;
  commitSha?: string;
}

export interface RuntimeDiffFinding {
  title: string;
  explanation: string;
  evidenceLevel: EvidenceLevel;
  evidenceRefs: string[];
}

export interface RuntimeDiffExplanation {
  observedChanges: string;
  historicalRelevance: string;
  likelyCausalExplanation: string;
  recommendedReviewerAction: string;
  findings: RuntimeDiffFinding[];
}

const model = google("gemini-3.6-flash");

export function highestEvidenceLevel(bundle: RuntimeDiffEvidenceBundle): EvidenceLevel {
  if (bundle.evidence.statuses.length || bundle.evidence.json.length || bundle.evidence.headers.length || bundle.evidence.latency.some((item) => item.flagged) || Boolean(bundle.evidence.database && (Object.keys(bundle.evidence.database.rowCountChanges).length || bundle.evidence.database.criticalFieldChanges.length || bundle.evidence.database.eventChanges || bundle.evidence.database.queueChanges))) return "E5";
  if (bundle.regressionTests?.some((test) => !test.passed)) return "E4";
  if (bundle.historical.length) return "E3";
  const hasGraphEvidence = Array.isArray(bundle.graphNeighborhood) ? bundle.graphNeighborhood.length > 0 : Boolean(bundle.graphNeighborhood && Object.keys(bundle.graphNeighborhood as object).length);
  if (bundle.changedSymbols.length || hasGraphEvidence) return "E2";
  if (bundle.semanticMatches?.length) return "E1";
  return "E0";
}

function promptFor(bundle: RuntimeDiffEvidenceBundle): string {
  return `You are CodePool's evidence interpreter. Explain only the runtime regression demonstrated by the supplied evidence bundle.

NON-NEGOTIABLE RULE: Do not infer behavior not demonstrated by evidence. Do not invent files, requests, values, database effects, historical links, causal mechanisms, or test results. If evidence is insufficient, say so explicitly. Distinguish exactly:
1. observed changes
2. historical relevance
3. likely causal explanation
4. recommended reviewer action

Assign each finding one Evidence Level using only this hierarchy: E0 (LLM hypothesis), E1 (semantic similarity), E2 (graph/static evidence), E3 (historical causal evidence), E4 (regression test failure), E5 (differential runtime reproduction). Evidence level must not exceed what the bundle demonstrates.

Return JSON only with this shape:
{"observedChanges":"...","historicalRelevance":"...","likelyCausalExplanation":"...","recommendedReviewerAction":"...","findings":[{"title":"...","explanation":"...","evidenceLevel":"E0|E1|E2|E3|E4|E5","evidenceRefs":["exact evidence field/path"]}]}

EVIDENCE BUNDLE:
${JSON.stringify(bundle, null, 2)}`;
}

export async function explainRuntimeDiff(bundle: RuntimeDiffEvidenceBundle, dependencies: { generate?: (prompt: string) => Promise<string> } = {}): Promise<RuntimeDiffExplanation> {
  const text = dependencies.generate ? await dependencies.generate(promptFor(bundle)) : (await generateText({ model, prompt: promptFor(bundle), maxOutputTokens: 4096, temperature: 0.1, abortSignal: AbortSignal.timeout(60_000), providerOptions: { google: { thinkingConfig: { thinkingLevel: "minimal" }, responseMimeType: "application/json" } } })).text;
  const parsed = JSON.parse(text) as RuntimeDiffExplanation;
  const allowed = new Set<EvidenceLevel>(["E0", "E1", "E2", "E3", "E4", "E5"]);
  if (!parsed.observedChanges || !parsed.historicalRelevance || !parsed.likelyCausalExplanation || !parsed.recommendedReviewerAction || !Array.isArray(parsed.findings)) throw new Error("Runtime explanation is incomplete.");
  const maximum = highestEvidenceLevel(bundle);
  const rank: Record<EvidenceLevel, number> = { E0: 0, E1: 1, E2: 2, E3: 3, E4: 4, E5: 5 };
  for (const finding of parsed.findings) {
    if (!allowed.has(finding.evidenceLevel)) throw new Error(`Invalid evidence level: ${finding.evidenceLevel}`);
    if (rank[finding.evidenceLevel] > rank[maximum]) finding.evidenceLevel = maximum;
  }
  return parsed;
}
