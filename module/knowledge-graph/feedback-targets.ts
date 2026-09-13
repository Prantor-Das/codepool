import { runQuery } from "./lib/graph-client";

export async function getFeedbackTargets(repositoryId: string, pullRequestId: string) {
  const result = await runQuery(
    `MATCH (o:IncidentObservation {repositoryId: $repositoryId})-[:OBSERVED_ON]->(p:PullRequest {id: $pullRequestId, repositoryId: $repositoryId})
     MATCH (o)-[:CONFIRMS]->(a:Antibody)
     OPTIONAL MATCH (a)-[:PROTECTS]->(i:Invariant)
     RETURN DISTINCT a.id AS antibodyId, a.problem AS problem, i.id AS invariantId`,
    { repositoryId, pullRequestId },
  );
  return result.records.map(r => ({ antibodyId: r.get("antibodyId") as string, problem: r.get("problem") as string | null, invariantId: r.get("invariantId") as string | null }));
}
