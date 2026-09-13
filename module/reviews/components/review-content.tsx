import { parseReview } from "@/lib/review-output";
import ReactMarkdown from "react-markdown";
import { reviewOutputToMarkdown, type ReviewOutput } from "@/lib/modelscope";

export function ReviewContent({ review }: { review: ReviewOutput }) {
  return <div className="max-w-none space-y-4 text-sm leading-6 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:text-xs"><ReactMarkdown disallowedElements={["img"]}>{reviewOutputToMarkdown(review)}</ReactMarkdown></div>;
}
export const parseReviewOutput = parseReview;
