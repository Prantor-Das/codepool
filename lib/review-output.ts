import type { ReviewFinding, ReviewOutput } from "./modelscope";

export function parseReview(value: string): ReviewOutput | null {
  try {
    const output = JSON.parse(value);
    const validFinding = (item: ReviewFinding) => item && typeof item.title === "string" && typeof item.file === "string" && typeof item.description === "string" && Number.isSafeInteger(item.lineStart) && item.lineStart > 0 && Number.isSafeInteger(item.lineEnd) && item.lineEnd >= item.lineStart && ["critical", "high", "medium", "low", "info"].includes(item.severity) && (item.fixPrompt === undefined || typeof item.fixPrompt === "string");
    return output && typeof output.walkthrough === "string" && typeof output.summary === "string" && Array.isArray(output.strengths) && output.strengths.every((value: unknown) => typeof value === "string") && Array.isArray(output.issues) && output.issues.every(validFinding) && Array.isArray(output.suggestions) && output.suggestions.every(validFinding) ? output : null;
  } catch { return null; }
}
