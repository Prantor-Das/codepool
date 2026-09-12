import "dotenv/config";
import { runQuery } from "../module/knowledge-graph/lib/graph-client";
import { writeNode, writeRelationship } from "../module/knowledge-graph/lib/graph-writer";
import { initializeGraphSchema } from "../module/knowledge-graph/schema/constraints";

const suffix = `verify-${Date.now()}`;
const repository = `repository-${suffix}`;
const commit = `commit-${suffix}`;
const symbol = `symbol-${suffix}`;
const versionOne = `symbol-version-1-${suffix}`;
const versionTwo = `symbol-version-2-${suffix}`;
const provenance = { sourceType: "runtime" as const, confidence: 1 };
const ids = [repository, commit, symbol, versionOne, versionTwo];

try {
  await initializeGraphSchema();
  await writeNode("Repository", repository, { name: "Neo4j setup verification" }, provenance);
  await writeNode("Commit", commit, { sha: `${suffix}-sha` }, provenance);
  await writeNode("Symbol", symbol, { name: "verify" }, provenance);
  await writeNode("SymbolVersion", versionOne, { contentHash: "hash-1" }, provenance);
  await writeNode("SymbolVersion", versionTwo, { contentHash: "hash-2" }, provenance);
  await writeRelationship({ label: "Repository", id: repository }, "HAS_COMMIT", { label: "Commit", id: commit }, provenance);
  await writeRelationship({ label: "Repository", id: repository }, "HAS_SYMBOL", { label: "Symbol", id: symbol }, provenance);
  await writeRelationship({ label: "Commit", id: commit }, "MODIFIED", { label: "SymbolVersion", id: versionTwo }, provenance);
  await writeRelationship({ label: "SymbolVersion", id: versionOne }, "VERSION_OF", { label: "Symbol", id: symbol }, provenance);
  await writeRelationship({ label: "SymbolVersion", id: versionTwo }, "VERSION_OF", { label: "Symbol", id: symbol }, provenance);
  await writeRelationship({ label: "SymbolVersion", id: versionTwo }, "PREVIOUS_VERSION", { label: "SymbolVersion", id: versionOne }, provenance);

  const result = await runQuery(
    `MATCH (r:Repository {id: $repository})-[:HAS_COMMIT]->(c:Commit {id: $commit})
     MATCH (c)-[:MODIFIED]->(v:SymbolVersion)-[:PREVIOUS_VERSION]->(previous:SymbolVersion)
     MATCH (v)-[:VERSION_OF]->(s:Symbol {id: $symbol})
     RETURN r.id AS repository, c.id AS commit, s.id AS symbol,
            v.contentHash AS currentHash, previous.contentHash AS previousHash`,
    { repository, commit, symbol },
  );
  const record = result.records[0];
  if (!record || record.get("currentHash") !== "hash-2" || record.get("previousHash") !== "hash-1") {
    throw new Error("Verification query returned an unexpected SymbolVersion chain.");
  }
  console.log("PASS: Neo4j graph schema and Repository/Commit/Symbol/SymbolVersion chain verified.");
} catch (error) {
  console.error("FAIL: Neo4j graph setup verification failed.", error);
  process.exitCode = 1;
} finally {
  if (process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD) {
    try {
      await runQuery("MATCH (n) WHERE n.id IN $ids DETACH DELETE n", { ids });
    } catch (cleanupError) {
      console.error("FAIL: Neo4j verification cleanup failed.", cleanupError);
      process.exitCode = 1;
    }
  }
}
