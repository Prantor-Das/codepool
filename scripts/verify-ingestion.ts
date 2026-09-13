import "dotenv/config";
import { ingestExtractedCommit } from "../module/knowledge-graph/history/commit-miner";
import { runQuery, closeGraphDriver } from "../module/knowledge-graph/lib/graph-client";
import { initializeGraphSchema } from "../module/knowledge-graph/schema/constraints";

const suffix = `ingestion-fixture-${Date.now()}`;
const repositoryId = suffix;
const files = [
  { path: "src/math.ts", content: "export function add(a: number, b: number) { return a + b; }\nexport function total(x: number) { return add(x, 1); }\n" },
];
const commits = [
  { sha: `${suffix}-one`, committedAt: "2024-01-01T00:00:00.000Z", files },
  // Identical symbols in a second commit must not create a version.
  { sha: `${suffix}-two`, committedAt: "2024-01-02T00:00:00.000Z", files },
  { sha: `${suffix}-three`, committedAt: "2024-01-03T00:00:00.000Z", files: [{ path: "src/math.ts", content: "export function add(a: number, b: number) { return a + b + 0; }\nexport function total(x: number) { return add(x, 1); }\n" }] },
];

let failures = 0;
function assert(label: string, condition: boolean, detail: string) {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

try {
  await initializeGraphSchema();
  for (const commit of commits) await ingestExtractedCommit(repositoryId, commit);
  const symbols = await runQuery("MATCH (s:Symbol {repositoryId: $repositoryId}) WHERE s.kind = 'function' RETURN count(s) AS count", { repositoryId });
  assert("known function symbols", Number(symbols.records[0]?.get("count")) === 2, "expected add and total");

  const versions = await runQuery("MATCH (v:SymbolVersion)-[:VERSION_OF]->(:Symbol {repositoryId: $repositoryId}) RETURN count(v) AS count", { repositoryId });
  assert("distinct content versions", Number(versions.records[0]?.get("count")) === 3, "add changes once; total does not");

  const calls = await runQuery("MATCH (:Symbol {repositoryId: $repositoryId, name: 'total'})-[:CALLS]->(:Symbol {repositoryId: $repositoryId, name: 'add'}) RETURN count(*) AS count", { repositoryId });
  assert("CALLS relationship", Number(calls.records[0]?.get("count")) === 1, "total calls add");
} catch (error) {
  failures += 1;
  console.error("FAIL: ingestion verification could not complete.", error);
} finally {
  if (process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD) {
    try { await runQuery("MATCH (n) WHERE n.id STARTS WITH $repositoryId DETACH DELETE n", { repositoryId }); } catch (error) { failures += 1; console.error("FAIL: cleanup.", error); }
  }
}
if (failures) process.exitCode = 1;

await closeGraphDriver();
