import { runQuery } from "./graph-client";

export const graphLabels = [
  "Repository", "Branch", "Commit", "PullRequest", "Issue", "File", "Symbol",
  "SymbolVersion", "Endpoint", "DatabaseEntity", "ExternalService", "Test", "Bug",
  "Invariant", "Antibody", "Scenario", "ExecutionRun", "Observation", "Finding",
  "IncidentObservation",
] as const;

export type GraphLabel = (typeof graphLabels)[number];
export const graphRelationshipTypes = [
  "HAS_COMMIT", "HAS_FILE", "HAS_SYMBOL", "PARENT", "PART_OF_PR", "MODIFIED", "TOUCHED",
  "VERSION_OF", "PREVIOUS_VERSION", "CALLS", "IMPORTS", "READS", "WRITES", "SERVES", "VIOLATED",
  "AFFECTED", "REPORTED_IN", "FIXED", "RESTORED", "ADDED", "WEAKENS", "PASSES",
  "PROTECTS", "DERIVED_FROM", "WATCHES", "VERIFIED_BY", "EXERCISES", "TOUCHES",
  "VERIFIES", "EXECUTED", "BASE_OBSERVATION", "PR_OBSERVATION", "OBSERVED_ON", "CONFIRMS",
] as const;
export type GraphRelationshipType = (typeof graphRelationshipTypes)[number];
export type SourceType = "ast" | "git" | "github" | "llm" | "runtime";
export type GraphProperties = Record<string, unknown>;

export interface Provenance {
  sourceType: SourceType;
  confidence: number;
}

function assertProvenance(provenance: Provenance): void {
  if (!Number.isFinite(provenance.confidence) || provenance.confidence < 0 || provenance.confidence > 1) {
    throw new Error("Graph confidence must be a number between 0.0 and 1.0.");
  }
}

function assertSafeIdentifier(value: string, kind: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) throw new Error(`Invalid graph ${kind}: ${value}`);
}

export async function writeNode(label: GraphLabel, id: string, properties: GraphProperties, provenance: Provenance) {
  assertSafeIdentifier(label, "label");
  assertProvenance(provenance);
  return runQuery(
    `MERGE (n:${label} {id: $id})
     SET n += $properties, n.sourceType = $sourceType, n.confidence = $confidence
     RETURN n`,
    { id, properties, sourceType: provenance.sourceType, confidence: provenance.confidence },
  );
}

export async function writeRelationship(
  from: { label: GraphLabel; id: string },
  relationshipType: GraphRelationshipType,
  to: { label: GraphLabel; id: string },
  provenance: Provenance,
  properties: GraphProperties = {},
) {
  assertSafeIdentifier(from.label, "label");
  assertSafeIdentifier(to.label, "label");
  assertSafeIdentifier(relationshipType, "relationship type");
  assertProvenance(provenance);
  return runQuery(
    `MATCH (from:${from.label} {id: $fromId})
     MATCH (to:${to.label} {id: $toId})
     MERGE (from)-[r:${relationshipType}]->(to)
     SET r += $properties, r.sourceType = $sourceType, r.confidence = $confidence
     RETURN r`,
    {
      fromId: from.id, toId: to.id, properties,
      sourceType: provenance.sourceType, confidence: provenance.confidence,
    },
  );
}
