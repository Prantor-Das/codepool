import { generateAIJson } from "@/module/ai/lib/generate-json";
import type { HistoricalPullRequest } from "./bug-classifier";

export type AntibodyExtraction = {
  problem: string;
  rootCause: string;
  confidence: number;
};

export async function extractAntibody(
  pr: HistoricalPullRequest,
): Promise<AntibodyExtraction> {
  const result = await generateAIJson<Partial<AntibodyExtraction>>(`
Extract the reusable fix pattern (antibody) from this merged bug-fix pull request.
Return JSON only with: problem, rootCause, confidence.
problem should explain the failure prevented by the fix. rootCause should explain why it
happened. Keep both concise and factual, grounded only in the supplied PR. confidence must
be between 0 and 1.

Title: ${pr.title}
Body: ${pr.body || "No body"}
Diff:
${pr.diff.slice(0, 30000)}
`);

  if (!result.problem?.trim() || !result.rootCause?.trim()) throw new Error("Antibody extractor returned incomplete data.");
  const confidence = Number(result.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Antibody extractor returned invalid confidence.");
  return { problem: result.problem.trim(), rootCause: result.rootCause.trim(), confidence };
}

