import { createHash } from "node:crypto";
import { getPineconeIndex, ANTIBODY_NAMESPACE } from "@/lib/pinecone";
import { runQuery } from "../lib/graph-client";
import { writeNode, writeRelationship, type Provenance } from "../lib/graph-writer";
import { classifyBugFix, type BugClassification, type HistoricalPullRequest } from "./bug-classifier";
import { extractAntibody, type AntibodyExtraction } from "./antibody-extractor";
import { extractInvariant, type InvariantExtraction } from "./invariant-extractor";


const PINECONE_TEXT_FIELD = process.env.PINECONE_TEXT_FIELD ?? "text";

export type BugFixPipelineDependencies = {
  classify: (pr: HistoricalPullRequest) => Promise<BugClassification>;
  extractAntibody: (pr: HistoricalPullRequest) => Promise<AntibodyExtraction>;
  extractInvariant: (pr: HistoricalPullRequest) => Promise<InvariantExtraction>;
};
export type BugFixKnowledgeIds = { pullRequestId: string; bugId: string; invariantId: string; antibodyId: string };

const productionDependencies: BugFixPipelineDependencies = { classify: classifyBugFix, extractAntibody, extractInvariant };
function invariantId(repositoryId: string, statement: string): string {
  const digest = createHash("sha256").update(statement.trim().toLowerCase()).digest("hex").slice(0, 24);
  return `${repositoryId}:invariant:${digest}`;
}
export function pullRequestId(pr: HistoricalPullRequest): string { return `${pr.repositoryId}:pr:${pr.prNumber}`; }

export async function writeBugFixKnowledge(pr: HistoricalPullRequest, classification: BugClassification, antibody: AntibodyExtraction, invariant: InvariantExtraction): Promise<BugFixKnowledgeIds> {
  const pullRequest = pullRequestId(pr), bug = `${pullRequest}:bug`, invariantNode = invariantId(pr.repositoryId, invariant.statement), antibodyNode = `${pullRequest}:antibody`;
  const provenance: Provenance = { sourceType: "llm", confidence: classification.confidence };
  const extractionProvenance: Provenance = { sourceType: "llm", confidence: Math.min(classification.confidence, antibody.confidence, invariant.confidence) };
  await writeNode("PullRequest", pullRequest, { repositoryId: pr.repositoryId, number: pr.prNumber, title: pr.title }, provenance);
  await writeNode("Bug", bug, { title: pr.title, status: "candidate" }, provenance);
  await writeNode("Invariant", invariantNode, { statement: invariant.statement, category: invariant.category, severity: invariant.severity, status: "candidate", validFrom: new Date().toISOString(), validUntil: null, supersededBy: null }, extractionProvenance);
  await writeNode("Antibody", antibodyNode, { problem: antibody.problem, rootCause: antibody.rootCause, status: "candidate" }, extractionProvenance);
  await writeRelationship({ label: "Bug", id: bug }, "VIOLATED", { label: "Invariant", id: invariantNode }, provenance);
  await writeRelationship({ label: "PullRequest", id: pullRequest }, "FIXED", { label: "Bug", id: bug }, provenance);
  await writeRelationship({ label: "PullRequest", id: pullRequest }, "RESTORED", { label: "Invariant", id: invariantNode }, provenance);
  await writeRelationship({ label: "Antibody", id: antibodyNode }, "PROTECTS", { label: "Invariant", id: invariantNode }, extractionProvenance);
  await writeRelationship({ label: "Antibody", id: antibodyNode }, "DERIVED_FROM", { label: "PullRequest", id: pullRequest }, extractionProvenance);
  if (pr.linkedIssue) {
    const issue = `${pr.repositoryId}:issue:${pr.linkedIssue.number}`;
    await writeNode("Issue", issue, { number: pr.linkedIssue.number, title: pr.linkedIssue.title ?? "" }, provenance);
    await writeRelationship({ label: "Bug", id: bug }, "REPORTED_IN", { label: "Issue", id: issue }, provenance);
  }
  for (const symbolId of pr.symbolIds) await writeRelationship({ label: "Antibody", id: antibodyNode }, "WATCHES", { label: "Symbol", id: symbolId }, provenance);
  for (const test of pr.regressionTests ?? []) await writeRelationship({ label: "Antibody", id: antibodyNode }, "VERIFIED_BY", { label: "Test", id: test.id }, provenance);
  const antibodyText = `Problem: ${antibody.problem}\nRoot cause: ${antibody.rootCause}`;
  await getPineconeIndex().namespace(ANTIBODY_NAMESPACE).upsertRecords({ records: [{ _id: antibodyNode, [PINECONE_TEXT_FIELD]: antibodyText, neo4jId: antibodyNode, repositoryId: pr.repositoryId, status: "candidate" }] });
  return { pullRequestId: pullRequest, bugId: bug, invariantId: invariantNode, antibodyId: antibodyNode };
}

export async function runBugFixPipeline(pr: HistoricalPullRequest, dependencies: BugFixPipelineDependencies = productionDependencies) {
  const classification = await dependencies.classify(pr);
  if (!classification.isBugFix) return { classified: false, classification };
  const antibody = await dependencies.extractAntibody(pr), invariant = await dependencies.extractInvariant(pr);
  return { classified: true, classification, ids: await writeBugFixKnowledge(pr, classification, antibody, invariant) };
}

export async function deleteBugFixKnowledge(ids: BugFixKnowledgeIds) {
  // Invariants and PRs are shared knowledge; delete an invariant only when orphaned.
  await runQuery("MATCH (n) WHERE n.id IN $ids DETACH DELETE n", { ids: [ids.antibodyId, ids.bugId] });
  await runQuery("MATCH (i:Invariant {id: $id}) WHERE NOT (i)--() DELETE i", { id: ids.invariantId });
  try { await getPineconeIndex().namespace(ANTIBODY_NAMESPACE).deleteOne({ id: ids.antibodyId }); } catch (error) { console.warn("Could not clean up antibody vector:", error); }
}
