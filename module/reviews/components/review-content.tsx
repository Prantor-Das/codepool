import { parseReview } from "@/lib/review-output";
import ReactMarkdown from "react-markdown";
import type { ReviewFinding, ReviewOutput } from "@/lib/modelscope";

const fallbackFixPrompt = (finding: ReviewFinding) => `Inspect ${finding.file}:${finding.lineStart}-${finding.lineEnd} and implement the change described above.`;

export function ReviewContent({ review }: { review: ReviewOutput }) {
  const findings = [...review.issues, ...review.suggestions];
  return <div className="max-w-none space-y-4 text-sm leading-6 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:text-xs"><ReactMarkdown disallowedElements={["img"]}>{`## Walkthrough\n\n${review.walkthrough}\n\n## Summary\n\n${review.summary}`}</ReactMarkdown>{findings.map((finding, index) => <Finding key={`${finding.file}-${finding.lineStart}-${index}`} finding={finding} />)}</div>;
}
function Finding({ finding }: { finding: ReviewFinding }) { return <section><h3 className="font-semibold">{finding.title}</h3><p>{finding.file}:{finding.lineStart}-{finding.lineEnd} — {finding.description}</p><h4 className="mt-3 font-medium">Prompt for AI Agents</h4><ReactMarkdown disallowedElements={["img"]}>{`\`\`\`text\n${finding.fixPrompt?.trim() || fallbackFixPrompt(finding)}\n\`\`\``}</ReactMarkdown></section>; }
export const parseReviewOutput = parseReview;
