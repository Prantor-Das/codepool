import "dotenv/config";
import { buildEvidenceObject } from "../module/execution/diff/evidence-builder";
import { explainRuntimeDiff } from "../module/ai/explain-runtime-diff";
import { formatRuntimeDiffComment } from "../module/github/runtime-diff-comment";
import { applyEvidenceFeedback } from "../module/knowledge-graph/feedback";
import { getCodePoolSuggestionSelfAudit } from "../module/knowledge-graph/queries/self-audit";
import { initializeGraphSchema } from "../module/knowledge-graph/schema/constraints";
import { runQuery } from "../module/knowledge-graph/lib/graph-client";
import { writeNode, writeRelationship } from "../module/knowledge-graph/lib/graph-writer";

if (!process.env.NEO4J_URI || !process.env.NEO4J_USER || !process.env.NEO4J_PASSWORD) {
  console.log("SKIP: evidence-loop verification requires NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD.");
  process.exit(0);
}

let failures = 0;
function assert(label: string, condition: boolean) { console.log(`${condition ? "PASS" : "FAIL"}: ${label}`); if (!condition) failures += 1; }

const repositoryId = `verify-evidence-${Date.now()}`;
const ids = {
  suggested: `${repositoryId}:pr:suggested`, issue: `${repositoryId}:issue:17`, historicalPr: `${repositoryId}:pr:historical`, bug: `${repositoryId}:bug`, invariant: `${repositoryId}:invariant`, antibody: `${repositoryId}:antibody`, observation: `${repositoryId}:incident-observation`,
};
const provenance = { sourceType: "runtime" as const, confidence: 1 };
const antibodyProvenance = { sourceType: "runtime" as const, confidence: .5 };

try {
  await initializeGraphSchema();
  await writeNode("PullRequest", ids.suggested, { repositoryId, number: 99, title: "Suggested transfer fix", origin: "codepool-suggested" }, provenance);
  await writeNode("Issue", ids.issue, { repositoryId, number: 17, title: "Refund restores balance" }, provenance);
  await writeNode("PullRequest", ids.historicalPr, { repositoryId, number: 42, title: "Fix refund balance" }, provenance);
  await writeNode("Bug", ids.bug, { repositoryId, title: "Refund loses balance" }, provenance);
  await writeNode("Invariant", ids.invariant, { repositoryId, statement: "A refund must restore the transferred balance", status: "candidate" }, provenance);
  await writeNode("Antibody", ids.antibody, { repositoryId, status: "candidate", problem: "Refund balance regression" }, antibodyProvenance);
  await writeNode("IncidentObservation", ids.observation, { repositoryId, evidenceRunId: "verify-run" }, provenance);
  await writeRelationship({ label: "PullRequest", id: ids.historicalPr }, "FIXED", { label: "Bug", id: ids.bug }, provenance);
  await writeRelationship({ label: "Bug", id: ids.bug }, "VIOLATED", { label: "Invariant", id: ids.invariant }, provenance);
  await writeRelationship({ label: "Antibody", id: ids.antibody }, "PROTECTS", { label: "Invariant", id: ids.invariant }, provenance);
  await writeRelationship({ label: "Antibody", id: ids.antibody }, "DERIVED_FROM", { label: "PullRequest", id: ids.historicalPr }, provenance);
  await writeRelationship({ label: "IncidentObservation", id: ids.observation }, "OBSERVED_ON", { label: "PullRequest", id: ids.suggested }, provenance);
  await writeRelationship({ label: "IncidentObservation", id: ids.observation }, "CONFIRMS", { label: "Antibody", id: ids.antibody }, provenance);

  const base = { branch: "base" as const, observations: [{ scenarioId: "refund", iteration: 1, method: "POST", path: "/refund", status: 200, headers: { "content-type": "application/json" }, body: { balance: 100, refundId: "base" }, elapsedMs: 100 }] };
  const pr = { branch: "pr" as const, observations: [{ scenarioId: "refund", iteration: 1, method: "POST", path: "/refund", status: 422, headers: { "content-type": "application/json" }, body: { balance: 90 }, elapsedMs: 130 }] };
  const evidence = buildEvidenceObject({ runId: "verify-run", pairId: "verify-pair", seedId: "verify-seed", baseSha: "base-sha", prSha: "pr-sha", scenarioSource: "integration-test", base, pr });
  const bundle = { changedSymbols: [{ id: "transferMoney", name: "transferMoney" }], graphNeighborhood: { endpoints: ["/refund"] }, historical: [{ antibodyId: ids.antibody, historicalPullRequestId: ids.historicalPr, historicalBug: "Refund loses balance", invariant: "A refund must restore the transferred balance", historicalFix: "Fix refund balance" }], evidence, baseRun: base, prRun: pr, issueNumber: 17, historicalPrNumber: 42, commitSha: "pr-sha" };
  const explanation = await explainRuntimeDiff(bundle, { generate: async () => JSON.stringify({ observedChanges: "PR returns 422 and balance 90; base returns 200 and balance 100.", historicalRelevance: "The result matches the historical refund invariant.", likelyCausalExplanation: "The demonstrated response difference is consistent with the balance restoration path failing.", recommendedReviewerAction: "Review the refund balance update and preserve the invariant.", findings: [{ title: "Refund balance regressed", explanation: "The PR response changes status and balance compared with base.", evidenceLevel: "E5", evidenceRefs: ["evidence.statuses[0]", "evidence.json[0]"] }] }) });
  const comment = formatRuntimeDiffComment(bundle, explanation);
  assert("formatted comment has confirmed-regression header", comment.includes("🚨 Confirmed Behavioral Regression"));
  assert("formatted comment surfaces Evidence E5", comment.includes("Evidence level: E5") && comment.includes("Evidence E5"));
  assert("formatted comment includes comparison table, invariant, and raw diff", comment.includes("Base status") && comment.includes("A refund must restore") && comment.includes("Raw canonical JSON diff"));

  const before = await runQuery("MATCH (a:Antibody {id: $id}) RETURN a.confidence AS confidence, a.status AS status", { id: ids.antibody });
  const update = await applyEvidenceFeedback({ action: "regression", antibodyId: ids.antibody, actor: "verify-user" });
  const after = await runQuery("MATCH (a:Antibody {id: $id}) RETURN a.confidence AS confidence, a.status AS status", { id: ids.antibody });
  assert("Regression feedback increases Antibody confidence", Number(after.records[0].get("confidence")) > Number(before.records[0].get("confidence")));
  assert("Regression feedback verifies the Antibody", update.status === "verified" && after.records[0].get("status") === "verified");
  const audit = await getCodePoolSuggestionSelfAudit(repositoryId);
  assert("self-audit reports the CodePool suggestion that triggered an antibody match", audit.some((item) => item.suggestedPullRequestId === ids.suggested && item.matchedAntibodyId === ids.antibody));
} catch (error) {
  failures += 1;
  console.error("FAIL: evidence-loop verification could not complete.", error);
} finally {
  try { await runQuery("MATCH (n) WHERE n.id STARTS WITH $prefix DETACH DELETE n", { prefix: repositoryId }); } catch (error) { failures += 1; console.error("FAIL: evidence-loop cleanup", error); }
}

if (failures) process.exitCode = 1;
