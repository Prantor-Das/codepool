import "dotenv/config";
import { runQuery } from "../module/knowledge-graph/lib/graph-client";
import { writeNode } from "../module/knowledge-graph/lib/graph-writer";
import { deleteBugFixKnowledge, runBugFixPipeline, type BugFixKnowledgeIds } from "../module/knowledge-graph/history/bug-fix-pipeline";
import type { HistoricalPullRequest } from "../module/knowledge-graph/history/bug-classifier";

const repositoryId = `verify-antibodies-${Date.now()}`;
const fixtures: HistoricalPullRequest[] = [
  { repositoryId, prNumber: 101, title: "Fix refund over-credit", body: "Refunds could exceed the refundable balance.", diff: "- refund = requested\n+ refund = Math.min(requested, refundableBalance)", symbolIds: [`${repositoryId}:symbol:refund`], regressionTests: [{ id: `${repositoryId}:test:refund`, name: "caps refund" }], linkedIssue: { number: 501, title: "Refund creates excess credit" } },
  { repositoryId, prNumber: 102, title: "Prevent unauthorized admin mutation", body: "A missing authorization check allowed non-admin updates.", diff: "+ if (!user.isAdmin) throw new Error('forbidden')", symbolIds: [`${repositoryId}:symbol:admin`], regressionTests: [{ id: `${repositoryId}:test:admin`, name: "rejects non-admin" }] },
  { repositoryId, prNumber: 103, title: "Fix duplicate webhook delivery", body: "Repeated deliveries created duplicate records.", diff: "+ await idempotencyStore.claim(event.id)", symbolIds: [`${repositoryId}:symbol:webhook`] },
];
const dependencies = {
  classify: async () => ({ isBugFix: true, confidence: 0.99 }),
  extractAntibody: async (pr: HistoricalPullRequest) => ({ problem: pr.title, rootCause: pr.body ?? "fixture root cause", confidence: 0.98 }),
  extractInvariant: async (pr: HistoricalPullRequest) => ({ statement: `The behavior fixed by ${pr.title} must remain correct.`, category: "reliability", severity: "high" as const, confidence: 0.97 }),
};
const created: BugFixKnowledgeIds[] = [];

try {
  for (const pr of fixtures) {
    await writeNode("PullRequest", `${repositoryId}:pr:${pr.prNumber}`, { number: pr.prNumber, title: pr.title }, { sourceType: "github", confidence: 1 });
    for (const symbolId of pr.symbolIds) await writeNode("Symbol", symbolId, { name: symbolId.split(":").at(-1) }, { sourceType: "ast", confidence: 1 });
    for (const test of pr.regressionTests ?? []) await writeNode("Test", test.id, { name: test.name }, { sourceType: "git", confidence: 1 });
    const result = await runBugFixPipeline(pr, dependencies);
    if (!result.classified || !result.ids) throw new Error(`Fixture PR #${pr.prNumber} was not persisted.`);
    created.push(result.ids);
    const check = await runQuery(`MATCH (a:Antibody {id: $antibody})-[:PROTECTS]->(i:Invariant) MATCH (a)-[:DERIVED_FROM]->(p:PullRequest {id: $pr}) MATCH (a)-[:WATCHES]->(s:Symbol {id: $symbol}) RETURN count(a) AS antibodies, count(i) AS invariants, count(p) AS prs, count(s) AS symbols`, { antibody: result.ids.antibodyId, pr: result.ids.pullRequestId, symbol: pr.symbolIds[0] });
    const row = check.records[0];
    if (!row || Number(row.get("antibodies")) !== 1 || Number(row.get("invariants")) !== 1 || Number(row.get("prs")) !== 1 || Number(row.get("symbols")) !== 1) throw new Error(`Fixture PR #${pr.prNumber} has incorrect links.`);
  }
  console.log(`PASS: ${fixtures.length} antibody/invariant fixtures verified.`);
} catch (error) {
  console.error("FAIL: antibody verification failed.", error);
  process.exitCode = 1;
} finally {
  for (const ids of created) await deleteBugFixKnowledge(ids);
  if (process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD) await runQuery("MATCH (n) WHERE n.id STARTS WITH $prefix DETACH DELETE n", { prefix: repositoryId });
}

