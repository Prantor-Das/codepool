import type { EvidenceObject } from "@/module/execution/diff/evidence-builder";
import type { BranchRun } from "@/module/execution/traffic/scenario-runner";
import { EVIDENCE_LEVEL_DESCRIPTIONS, type EvidenceLevel, type RuntimeDiffExplanation, type RuntimeDiffEvidenceBundle, highestEvidenceLevel } from "@/module/ai/explain-runtime-diff";

function heading(level: EvidenceLevel): string {
  if (level === "E5") return "🚨 Confirmed Behavioral Regression";
  if (level === "E4") return "⚠️ Confirmed Regression Test Failure";
  if (level === "E3") return "⚠️ Historical Regression Risk";
  return "🔎 Runtime Differential Evidence";
}

function bodyText(body: unknown): string {
  if (body && typeof body === "object") return Object.keys(body as object).join(", ") || "none";
  return String(body ?? "empty");
}

function statsFor(branch: BranchRun | undefined, scenarioId: string) {
  const values = branch?.observations.filter((item) => item.scenarioId === scenarioId).map((item) => item.elapsedMs).sort((a, b) => a - b) ?? [];
  const pick = (fraction: number) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)] : 0;
  return { p50: pick(.5), p99: pick(.99) };
}

function comparisonTable(bundle: RuntimeDiffEvidenceBundle): string {
  const ids = [...new Set([...(bundle.baseRun?.observations ?? []), ...(bundle.prRun?.observations ?? [])].map((item) => item.scenarioId))];
  const rows = ids.map((id) => {
    const base = bundle.baseRun?.observations.find((item) => item.scenarioId === id);
    const pr = bundle.prRun?.observations.find((item) => item.scenarioId === id);
    const baseStats = statsFor(bundle.baseRun, id), prStats = statsFor(bundle.prRun, id);
    return `| ${id} | ${base?.status ?? "—"} | ${pr?.status ?? "—"} | ${bodyText(base?.body)} | ${bodyText(pr?.body)} | ${baseStats.p50.toFixed(1)} / ${prStats.p50.toFixed(1)} ms | ${baseStats.p99.toFixed(1)} / ${prStats.p99.toFixed(1)} ms |`;
  });
  if (rows.length) return ["| Scenario | Base status | PR status | Base key fields | PR key fields | p50 base / PR | p99 base / PR |", "|---|---:|---:|---|---|---:|---:|", ...rows].join("\n");
  const statuses = bundle.evidence.statuses.map((item) => `| runtime request ${item.scenarioId} | ${item.base} | ${item.pr} | — | — | — | — |`);
  const latency = bundle.evidence.latency.map((item) => `| ${item.scenarioId} | — | — | — | — | ${item.base.p50.toFixed(1)} / ${item.pr.p50.toFixed(1)} ms | ${item.base.p99.toFixed(1)} / ${item.pr.p99.toFixed(1)} ms |`);
  return ["| Scenario | Base status | PR status | Base key fields | PR key fields | p50 base / PR | p99 base / PR |", "|---|---:|---:|---|---|---:|---:|", ...statuses, ...latency].join("\n");
}

export function formatRuntimeDiffComment(bundle: RuntimeDiffEvidenceBundle, explanation: RuntimeDiffExplanation): string {
  const level = highestEvidenceLevel(bundle);
  const historical = bundle.historical[0];
  const trail = [`Issue #${bundle.issueNumber ?? "unknown"}`, `PR #${bundle.historicalPrNumber ?? historical?.historicalPullRequestId ?? "unknown"}`, `commit ${bundle.commitSha ?? "unknown"}`].join(" · ");
  const findings = explanation.findings.map((finding) => `- **${finding.title}** — ${finding.explanation} *(Evidence ${finding.evidenceLevel}: ${EVIDENCE_LEVEL_DESCRIPTIONS[finding.evidenceLevel]})*`).join("\n");
  const raw = JSON.stringify(bundle.evidence, null, 2);
  return [
    `## ${heading(level)}`,
    `**Evidence level: ${level} — ${EVIDENCE_LEVEL_DESCRIPTIONS[level]}**`,
    `### Historical context`, historical ? `Issue ${bundle.issueNumber ? `#${bundle.issueNumber}` : "(unresolved)"} → historical PR ${bundle.historicalPrNumber ? `#${bundle.historicalPrNumber}` : historical.historicalFix ?? historical.historicalPullRequestId} → invariant: **${historical.invariant ?? "not recorded"}**. Historical bug: ${historical.historicalBug ?? "not recorded"}.` : "No historical invariant chain was matched.",
    "### This PR", explanation.observedChanges,
    "### Likely explanation", explanation.likelyCausalExplanation,
    "### Base vs PR", comparisonTable(bundle),
    `### Affected historical invariant\n${historical?.invariant ?? "No invariant statement was available in the evidence."}`,
    "### Reviewer action", explanation.recommendedReviewerAction,
    "### Evidence trail", trail,
    "### Findings", findings || "No finding was generated from the supplied evidence.",
    `<details><summary>Raw canonical JSON diff</summary>\n\n\`\`\`json\n${raw}\n\`\`\`\n</details>`,
    "---",
    "Was CodePool correct? React to this comment with ✅ Regression, 🚀 Intentional Change, or ❌ False Positive.",
  ].join("\n\n");
}

export type RuntimeDiffCommentInput = { evidence: EvidenceObject; explanation: RuntimeDiffExplanation; bundle: RuntimeDiffEvidenceBundle };
