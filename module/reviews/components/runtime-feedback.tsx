"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getReviewFeedbackTargets } from "../action";

export function RuntimeFeedback({ reviewId, repositoryId, prNumber }: { reviewId: string; repositoryId: string; prNumber: number }) {
  const targets = useQuery({ queryKey: ["runtime-feedback", reviewId], queryFn: () => getReviewFeedbackTargets(reviewId), retry: false });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(antibodyId: string, action: string) {
    setPending(true);
    try {
      const response = await fetch("/api/github/runtime-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryId, pullRequestId: `${repositoryId}:pr:${prNumber}`, antibodyId, action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(result.alreadyRecorded ? "Your feedback was already recorded." : `Feedback recorded. Status: ${result.status}; confidence: ${Number(result.confidence).toFixed(2)}.`);
    } catch { setMessage("Could not record feedback. Please try again."); }
    finally { setPending(false); }
  }
  if (targets.isError) return <p className="text-sm">Runtime feedback is temporarily unavailable.</p>;
  if (!targets.data?.length) return null;
  return <section className="space-y-3"><h3 className="font-semibold">Runtime evidence feedback</h3><p className="text-sm">One verdict per reviewer for each finding on this pull request.</p>{targets.data.map(target => <div key={target.antibodyId} className="space-y-2"><p>{target.problem ?? "Runtime finding"}</p><div className="flex flex-wrap gap-2">{[["regression", "Regression"], ["intentional-change", "Intentional change"], ["false-positive", "False positive"]].map(([action, label]) => <button type="button" className="rounded border px-3 py-2 text-sm" disabled={pending} key={action} onClick={() => submit(target.antibodyId, action)}>{label}</button>)}</div></div>)}<p role="status">{message}</p></section>;
}
