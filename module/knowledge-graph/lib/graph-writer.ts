import { runQuery } from "./graph-client";

export const graphLabels = [
  "Repository", "Branch", "Commit", "PullRequest", "Issue", "File", "Symbol",
  "SymbolVersion", "Endpoint", "DatabaseEntity", "ExternalService", "Test", "Bug",
  "Invariant", "Antibody", "Scenario", "ExecutionRun", "Observation", "Finding",
  "IncidentObservation", "Feedback",
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

/** Neo4j properties cannot contain maps or nested arrays. Preserve these as JSON. */
export function graphProperties(properties: GraphProperties): GraphProperties {
  return Object.fromEntries(Object.entries(properties).filter(([key, value]) => !["id", "sourceType", "confidence"].includes(key) && value !== undefined).map(([key, value]) => [key,
    value !== null && typeof value === "object" && (!Array.isArray(value) || value.some(item => item === null || typeof item === "object") || new Set(value.map(item => typeof item)).size > 1) ? JSON.stringify(value) : value,
  ]));
}

export async function writeNode(label: GraphLabel, id: string, properties: GraphProperties, provenance: Provenance) {
  assertSafeIdentifier(label, "label");
  assertProvenance(provenance);
  return runQuery(
    `MERGE (n:${label} {id: $id})
     WITH n, CASE WHEN $lifecycle AND n.lastFeedback IS NOT NULL THEN true ELSE false END AS protected,
          n.status AS previousStatus, n.confidence AS previousConfidence, n.sourceType AS previousSource
     SET n += $properties
     SET n.status = CASE WHEN protected THEN previousStatus ELSE n.status END,
         n.sourceType = CASE WHEN protected OR coalesce(previousConfidence, -1) > $confidence THEN previousSource ELSE $sourceType END,
         n.confidence = CASE WHEN protected OR coalesce(previousConfidence, -1) > $confidence THEN previousConfidence ELSE $confidence END
     RETURN n`,
    { id, properties: graphProperties(properties), lifecycle: label === "Antibody" || label === "Invariant", sourceType: provenance.sourceType, confidence: provenance.confidence },
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
     WITH r, r.confidence AS previousConfidence, r.sourceType AS previousSource
     SET r += $properties,
         r.sourceType = CASE WHEN coalesce(previousConfidence, -1) > $confidence THEN previousSource ELSE $sourceType END,
         r.confidence = CASE WHEN coalesce(previousConfidence, -1) > $confidence THEN previousConfidence ELSE $confidence END
     RETURN r`,
    {
      fromId: from.id, toId: to.id, properties: graphProperties(properties),
      sourceType: provenance.sourceType, confidence: provenance.confidence,
    },
  );
}
