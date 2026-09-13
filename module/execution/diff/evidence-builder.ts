import type { BranchRun } from "../traffic/scenario-runner";
import { diffJson, type JsonDiff } from "./json-diff";
import { diffStatuses, type StatusDiff } from "./status-diff";
import { diffHeaders, type HeaderDiff } from "./header-diff";
import { diffLatency, type LatencyDiff } from "./latency-diff";
import { diffDatabase, type DatabaseDiff, type DatabaseSnapshot } from "./database-diff";

export interface EvidenceObject {
  kind: "sandbox-differential-evidence";
  runId: string;
  pairId: string;
  seedId: string;
  baseSha: string;
  prSha: string;
  scenarioSource: string;
  json: JsonDiff[];
  statuses: StatusDiff[];
  headers: HeaderDiff[];
  latency: LatencyDiff[];
  database?: DatabaseDiff;
  firstTimeSeen: boolean;
  createdAt: string;
}

export function buildEvidenceObject(input: {
  runId: string; pairId: string; seedId: string; baseSha: string; prSha: string; scenarioSource: string;
  base: BranchRun; pr: BranchRun; latencyThreshold?: number; database?: { base: DatabaseSnapshot; pr: DatabaseSnapshot };
  firstTimeSeen?: boolean;
}): EvidenceObject {
  const baseBodies = input.base.observations.map((item) => item.body);
  const prBodies = input.pr.observations.map((item) => item.body);
  return {
    kind: "sandbox-differential-evidence", runId: input.runId, pairId: input.pairId, seedId: input.seedId,
    baseSha: input.baseSha, prSha: input.prSha, scenarioSource: input.scenarioSource,
    json: baseBodies.flatMap((body, index) => diffJson(body, prBodies[index])),
    statuses: diffStatuses(input.base.observations, input.pr.observations),
    headers: diffHeaders(input.base.observations, input.pr.observations),
    latency: diffLatency(input.base.observations, input.pr.observations, input.latencyThreshold),
    database: input.database ? diffDatabase(input.database.base, input.database.pr) : undefined,
    firstTimeSeen: input.firstTimeSeen ?? true, createdAt: new Date().toISOString(),
  };
}
