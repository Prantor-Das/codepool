import { runQuery } from "../lib/graph-client";

const constrainedLabels = [
  "Repository", "Commit", "File", "Symbol", "SymbolVersion", "PullRequest",
  "Issue", "Invariant", "Antibody", "Scenario", "ExecutionRun", "Observation", "IncidentObservation",
] as const;

const constraintStatements = constrainedLabels.map(
  (label) => `CREATE CONSTRAINT ${label.toLowerCase()}_id_unique IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`,
);

/** Applies the graph's idempotent uniqueness constraints. */
export async function initializeGraphSchema(): Promise<void> {
  for (const statement of constraintStatements) await runQuery(statement);
}

export { constrainedLabels, constraintStatements };
