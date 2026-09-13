import { runQuery } from "../lib/graph-client";

export type SelfAuditObservation = { suggestedPullRequestId: string; suggestedNumber?: number; suggestedTitle?: string; matchedAntibodyId?: string; observationId?: string; revertedByPullRequestId?: string; revertedByNumber?: number };

/** Reports whether CodePool-authored suggestions later matched an antibody or were reverted. */
export async function getCodePoolSuggestionSelfAudit(repositoryId?: string): Promise<SelfAuditObservation[]> {
  const result = await runQuery(
    `MATCH (suggested:PullRequest {origin: 'codepool-suggested'})
     WHERE $repositoryId IS NULL OR suggested.repositoryId = $repositoryId OR (suggested.repositoryId IS NULL AND suggested.id STARTS WITH $repositoryId + ":pr:")
     OPTIONAL MATCH (observation:IncidentObservation)-[:OBSERVED_ON]->(suggested)
     OPTIONAL MATCH (observation)-[:CONFIRMS]->(matched:Antibody)
     OPTIONAL MATCH (reverter:PullRequest)-[:REVERTED|REVERTS]->(suggested)
     RETURN DISTINCT suggested.id AS suggestedPullRequestId, suggested.number AS suggestedNumber,
       suggested.title AS suggestedTitle, matched.id AS matchedAntibodyId, observation.id AS observationId,
       reverter.id AS revertedByPullRequestId, reverter.number AS revertedByNumber
     ORDER BY suggestedNumber`,
    { repositoryId: repositoryId ?? null },
  );
  return result.records.map((record) => ({
    suggestedPullRequestId: record.get("suggestedPullRequestId") as string,
    suggestedNumber: record.get("suggestedNumber") as number | undefined,
    suggestedTitle: record.get("suggestedTitle") as string | undefined,
    matchedAntibodyId: record.get("matchedAntibodyId") as string | undefined,
    observationId: record.get("observationId") as string | undefined,
    revertedByPullRequestId: record.get("revertedByPullRequestId") as string | undefined,
    revertedByNumber: record.get("revertedByNumber") as number | undefined,
  }));
}
