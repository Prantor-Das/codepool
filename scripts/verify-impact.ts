import "dotenv/config";
import { shouldTriggerSandboxDiff, changedIdentifiersFromDiff } from "../module/regression/judge";
import { getBlastRadius } from "../module/knowledge-graph/impact/blast-radius";
import { getHistoricalImpact } from "../module/knowledge-graph/impact/historical-impact";
import { computeImpactScore, SANDBOX_TRIGGER_SCORE } from "../module/regression/risk-score";
import { initializeGraphSchema } from "../module/knowledge-graph/schema/constraints";
import { runQuery, closeGraphDriver } from "../module/knowledge-graph/lib/graph-client";
import { writeNode, writeRelationship } from "../module/knowledge-graph/lib/graph-writer";

const repositoryId = `verify-impact-${Date.now()}`;
const ids = { changed: `${repositoryId}:symbol:entry`, middle: `${repositoryId}:symbol:middle`, watched: `${repositoryId}:symbol:watched`, endpoint: `${repositoryId}:endpoint:orders`, antibody: `${repositoryId}:antibody`, invariant: `${repositoryId}:invariant`, pr: `${repositoryId}:pr:7`, bug: `${repositoryId}:bug:7`, issue: `${repositoryId}:issue:7`, scenario: `${repositoryId}:scenario:orders` };
const ast = { sourceType: "ast" as const, confidence: 1 };
const git = { sourceType: "git" as const, confidence: 1 };
let failures = 0;
function assert(label: string, condition: boolean) { console.log(`${condition ? "PASS" : "FAIL"}: ${label}`); if (!condition) failures += 1; }

assert("high impact alone triggers sandbox execution", shouldTriggerSandboxDiff({ impactScore: SANDBOX_TRIGGER_SCORE, confidence: .1, resurrectionDetected: false, apiEndpointAdjacent: false }));
assert("low risk does not trigger sandbox execution", !shouldTriggerSandboxDiff({ impactScore: .1, confidence: .1, resurrectionDetected: false, apiEndpointAdjacent: false }));
try {
  await initializeGraphSchema();
  for (const [id, name] of [[ids.changed, "entry"], [ids.middle, "middle"], [ids.watched, "watched"]] as const) await writeNode("Symbol", id, { name, repositoryId }, ast);
  await writeNode("Endpoint", ids.endpoint, { path: "/orders", method: "POST" }, ast);
  await writeNode("Scenario", ids.scenario, { name: "order submission" }, git);
  await writeNode("Antibody", ids.antibody, { problem: "duplicate charge" }, { sourceType: "llm", confidence: 1 });
  await writeNode("Invariant", ids.invariant, { statement: "orders are charged once" }, { sourceType: "llm", confidence: 1 });
  await writeNode("PullRequest", ids.pr, { title: "Fix duplicate order charge" }, git);
  await writeNode("Bug", ids.bug, { title: "duplicate charge" }, git);
  await writeNode("Issue", ids.issue, { title: "charge incident" }, git);
  await writeRelationship({ label: "Symbol", id: ids.changed }, "CALLS", { label: "Symbol", id: ids.middle }, ast);
  await writeRelationship({ label: "Symbol", id: ids.middle }, "CALLS", { label: "Symbol", id: ids.watched }, ast);
  await writeRelationship({ label: "Symbol", id: ids.watched }, "SERVES", { label: "Endpoint", id: ids.endpoint }, ast);
  await writeRelationship({ label: "Scenario", id: ids.scenario }, "TOUCHES", { label: "Symbol", id: ids.watched }, git);
  await writeRelationship({ label: "Antibody", id: ids.antibody }, "WATCHES", { label: "Symbol", id: ids.watched }, ast);
  await writeRelationship({ label: "Antibody", id: ids.antibody }, "PROTECTS", { label: "Invariant", id: ids.invariant }, ast);
  await writeRelationship({ label: "Antibody", id: ids.antibody }, "DERIVED_FROM", { label: "PullRequest", id: ids.pr }, ast);
  await writeRelationship({ label: "PullRequest", id: ids.pr }, "FIXED", { label: "Bug", id: ids.bug }, git);
  await writeRelationship({ label: "Bug", id: ids.bug }, "REPORTED_IN", { label: "Issue", id: ids.issue }, git);

  const blast = await getBlastRadius(repositoryId, [ids.changed]);
  const bodyOnly = changedIdentifiersFromDiff("+++ b/src/entry.ts\n@@ -2 +2 @@\n- return 1;\n+ return 0;");
  await runQuery("MATCH (s:Symbol {id: $id}) SET s.filePath = 'src/entry.ts'", { id: ids.changed });
  const fileImpact = await getBlastRadius(repositoryId, bodyOnly);
  assert("body-only edits still resolve their changed file's symbols", fileImpact.changedSymbols.some(symbol => symbol.id === ids.changed));
  const historical = await getHistoricalImpact(repositoryId, [ids.changed]);
  const score = computeImpactScore({ ...blast, historical, changeMagnitude: .7 });
  assert("antibody found two CALLS hops away", blast.antibodies.some((antibody) => antibody.id === ids.antibody && antibody.distance === 2));
  assert("affected Endpoint found", blast.endpoints.some((endpoint) => endpoint.id === ids.endpoint));
  assert(`ImpactScore (${score.toFixed(2)}) exceeds sandbox threshold (${SANDBOX_TRIGGER_SCORE})`, score >= SANDBOX_TRIGGER_SCORE);
} catch (error) { failures += 1; console.error("FAIL: impact verification could not complete.", error); }
finally { if (process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD) { try { await runQuery("MATCH (n) WHERE n.id STARTS WITH $prefix DETACH DELETE n", { prefix: repositoryId }); } catch (error) { failures += 1; console.error("FAIL: cleanup.", error); } } }
if (failures) process.exitCode = 1;

await closeGraphDriver();
