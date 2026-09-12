import { generateAIJson } from "@/module/ai/lib/generate-json";
import type { HistoricalPullRequest } from "./bug-classifier";

export type InvariantExtraction = {
  statement: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
};

export async function extractInvariant(
  pr: HistoricalPullRequest,
): Promise<InvariantExtraction> {
  const result = await generateAIJson<Partial<InvariantExtraction>>(`
Extract the behavioral invariant restored by this merged bug-fix pull request.
Return JSON only with: statement, category, severity, confidence.
statement must be one concise, plain-English rule that should remain true in the system,
not an implementation detail. category should be a short stable label such as financial,
authorization, data-integrity, reliability, or validation. severity must be low, medium,
high, or critical. confidence must be between 0 and 1.

Title: ${pr.title}
Body: ${pr.body || "No body"}
Diff:
${pr.diff.slice(0, 30000)}
`);

  if (!result.statement?.trim() || !result.category?.trim()) throw new Error("Invariant extractor returned incomplete data.");
  if (!result.severity || !["low", "medium", "high", "critical"].includes(result.severity)) {
    throw new Error("Invariant extractor returned an invalid severity.");
  }
  const confidence = Number(result.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Invariant extractor returned invalid confidence.");
  return {
    statement: result.statement.trim(), category: result.category.trim(),
    severity: result.severity, confidence,
  };
}

