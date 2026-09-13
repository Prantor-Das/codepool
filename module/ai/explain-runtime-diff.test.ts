import { expect, test } from "bun:test";
import { highestEvidenceLevel, explainRuntimeDiff, type RuntimeDiffEvidenceBundle } from "./explain-runtime-diff";
import { buildEvidenceObject } from "@/module/execution/diff/evidence-builder";
const observation = { scenarioId: "test", iteration: 1, method: "GET", path: "/", status: 200, headers: {}, body: { ok: true }, elapsedMs: 1 };
function bundle(): RuntimeDiffEvidenceBundle {
  return { changedSymbols: [], graphNeighborhood: {}, historical: [], evidence: buildEvidenceObject({ runId: "test", pairId: "pair", seedId: "seed", baseSha: "base", prSha: "pr", scenarioSource: "integration-test", base: { branch: "base", observations: [observation] }, pr: { branch: "pr", observations: [{ ...observation, status: 500 }] } }) };
}
test("runtime evidence cannot claim E5 without verified egress", () => { const input = bundle(); expect(highestEvidenceLevel(input)).toBe("E0"); input.evidence.egress = { policy: "block-all", verified: true, baseReplayed: 0, prReplayed: 0, misses: 0 }; expect(highestEvidenceLevel(input)).toBe("E5"); });
test("model overclaims are clamped and malformed findings rejected", async () => {
  const input = bundle();
  const output = { observedChanges: "Changed", historicalRelevance: "None", likelyCausalExplanation: "Unknown", recommendedReviewerAction: "Inspect", findings: [{ title: "Change", explanation: "Status changed", evidenceLevel: "E5", evidenceRefs: ["evidence.statuses"] }] };
  expect((await explainRuntimeDiff(input, { generate: async () => JSON.stringify(output) })).findings[0].evidenceLevel).toBe("E0");
  await expect(explainRuntimeDiff(input, { generate: async () => JSON.stringify({ ...output, findings: [{ evidenceLevel: "E5" }] }) })).rejects.toThrow("Invalid runtime finding");
});
