import { runQuery } from "../lib/graph-client";

import { graphLabels } from "../lib/graph-writer";

// Every writable node has a deterministic id, including Bug and Endpoint.
const constrainedLabels = graphLabels;

const constraintStatements = constrainedLabels.map(
  (label) => `CREATE CONSTRAINT ${label.toLowerCase()}_id_unique IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`,
);

/** Applies the graph's idempotent uniqueness constraints. */
export async function initializeGraphSchema(): Promise<void> {
  for (const statement of constraintStatements) await runQuery(statement);
}

export { constrainedLabels, constraintStatements };
