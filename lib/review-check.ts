export function reviewCheckRunPayload(state: "queued" | "in_progress" | "completed", conclusion?: "success" | "failure" | "timed_out", summary?: string) {
  return {
    status: state,
    ...(state === "completed" ? { conclusion: conclusion ?? "failure", completed_at: new Date().toISOString() } : state === "in_progress" ? { started_at: new Date().toISOString() } : {}),
    output: { title: state === "queued" ? "AI review queued" : state === "in_progress" ? "AI review in progress" : conclusion === "success" ? "AI review completed" : "AI review failed", summary: summary ?? "Codepool is processing this pull request." },
  };
}
