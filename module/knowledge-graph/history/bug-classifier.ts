import { generateAIJson } from "@/module/ai/lib/generate-json";

export type HistoricalPullRequest = {
  repositoryId: string;
  prNumber: number;
  title: string;
  body?: string | null;
  diff: string;
  linkedIssue?: { number: number; title?: string; body?: string | null };
  symbolIds: string[];
  regressionTests?: Array<{ id: string; name: string }>;
  mergeCommitId?: string;
};

export type BugClassification = { isBugFix: boolean; confidence: number };

function clampConfidence(value: unknown): number {
  const confidence = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(confidence)) throw new Error("Bug classifier returned an invalid confidence.");
  return Math.max(0, Math.min(1, confidence));
}

export async function classifyBugFix(pr: HistoricalPullRequest): Promise<BugClassification> {
  const result = await generateAIJson<Partial<BugClassification>>(`
Classify this merged GitHub pull request as a historical bug fix.
Return JSON only with exactly: { "isBugFix": boolean, "confidence": number }.
isBugFix is true only when the change fixes an already-existing defect, incorrect behavior,
regression, outage, security issue, or data-integrity problem. Do not classify feature work,
refactors, documentation, or tests alone as bug fixes. Confidence must be between 0 and 1.

Title: ${pr.title}
Body: ${pr.body || "No body"}
Linked issue: ${pr.linkedIssue ? JSON.stringify(pr.linkedIssue) : "None"}
Diff:
${pr.diff.slice(0, 30000)}
`);

  if (typeof result.isBugFix !== "boolean") throw new Error("Bug classifier returned an invalid isBugFix value.");
  return { isBugFix: result.isBugFix, confidence: clampConfidence(result.confidence) };
}

