import { runQuery } from "../lib/graph-client";

export type HistoricalImpact = { antibodyId: string; historicalPullRequestId: string; historicalBug?: string; issue?: string; invariant?: string; historicalFix?: string; watchedSymbolId: string };

/** Finds past bug-fix antibodies reachable through bounded CALLS/IMPORTS paths. */
export async function getHistoricalImpact(repositoryId: string, changed: string[]): Promise<HistoricalImpact[]> {
  if (!changed.length) return [];
  const result = await runQuery(
    `MATCH (start:Symbol)
     WHERE start.repositoryId = $repositoryId AND (start.id IN $changed OR start.name IN $changed)
     CALL {
       WITH start MATCH (start)-[:CALLS*0..4]-(reachable:Symbol) RETURN DISTINCT reachable
       UNION WITH start MATCH (start)-[:IMPORTS*1..3]-(reachable:Symbol) RETURN DISTINCT reachable
     }
     MATCH (antibody:Antibody)-[:WATCHES]->(reachable)
     MATCH (antibody)-[:DERIVED_FROM]->(pr:PullRequest)-[:FIXED]->(bug:Bug)
     OPTIONAL MATCH (bug)-[:REPORTED_IN]->(issue:Issue)
     OPTIONAL MATCH (antibody)-[:PROTECTS]->(invariant:Invariant)
     RETURN DISTINCT antibody.id AS antibodyId, pr.id AS historicalPullRequestId, bug.title AS historicalBug,
       issue.title AS issue, invariant.statement AS invariant, pr.title AS historicalFix, reachable.id AS watchedSymbolId`,
    { repositoryId, changed },
  );
  return result.records.map((record) => ({
    antibodyId: record.get("antibodyId") as string, historicalPullRequestId: record.get("historicalPullRequestId") as string,
    historicalBug: record.get("historicalBug") as string | undefined, issue: record.get("issue") as string | undefined,
    invariant: record.get("invariant") as string | undefined, historicalFix: record.get("historicalFix") as string | undefined,
    watchedSymbolId: record.get("watchedSymbolId") as string,
  }));
}
