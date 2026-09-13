import { createHash } from "node:crypto";
import { runQuery } from "@/module/knowledge-graph/lib/graph-client";
import { writeNode, writeRelationship } from "@/module/knowledge-graph/lib/graph-writer";
import type { EvidenceObject } from "./evidence-builder";

export async function persistEvidenceObject(input: { repositoryId: string; pullRequestId: string; evidence: EvidenceObject; antibodyId?: string }): Promise<{ observationId: string; antibodyId: string; createdAntibody: boolean }> {
  const observationId = `${input.repositoryId}:incident-observation:${input.evidence.runId}`;
  let antibodyId = input.antibodyId;
  let createdAntibody = false;
  if (!antibodyId) {
    antibodyId = `${input.repositoryId}:antibody:runtime:${createHash("sha256").update(JSON.stringify({ json: input.evidence.json, statuses: input.evidence.statuses, headers: input.evidence.headers, latency: input.evidence.latency.filter(item => item.flagged).map(item => item.scenarioId), database: input.evidence.database })).digest("hex").slice(0, 24)}`;
    const existing = await runQuery("MATCH (a:Antibody {id: $id}) RETURN a.id AS id LIMIT 1", { id: antibodyId });
    if (!existing.records.length) {
      await writeNode("Antibody", antibodyId, { problem: "First-time sandbox differential failure", status: "observed", evidenceRunId: input.evidence.runId }, { sourceType: "runtime", confidence: 1 });
      createdAntibody = true;
    }
  }
  await writeNode("PullRequest", input.pullRequestId, { repositoryId: input.repositoryId }, { sourceType: "runtime", confidence: 1 });
  await writeNode("IncidentObservation", observationId, { repositoryId: input.repositoryId, runId: input.evidence.runId, evidence: input.evidence }, { sourceType: "runtime", confidence: 1 });
  await writeRelationship({ label: "IncidentObservation", id: observationId }, "OBSERVED_ON", { label: "PullRequest", id: input.pullRequestId }, { sourceType: "runtime", confidence: 1 });
  await writeRelationship({ label: "IncidentObservation", id: observationId }, "CONFIRMS", { label: "Antibody", id: antibodyId }, { sourceType: "runtime", confidence: 1 });
  return { observationId, antibodyId, createdAntibody };
}
