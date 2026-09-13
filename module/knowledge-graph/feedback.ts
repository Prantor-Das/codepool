import { randomUUID } from "node:crypto";
import { runQuery } from "./lib/graph-client";

export type FeedbackAction = "regression" | "intentional-change" | "false-positive";

export async function applyEvidenceFeedback(input: { action: FeedbackAction; antibodyId: string; invariantId?: string; newInvariantId?: string; actor?: string; feedbackId?: string }) {
  if (!["regression", "intentional-change", "false-positive"].includes(input.action)) throw new Error("Invalid feedback action.");
  const confidenceDelta = input.action === "regression" ? 0.1 : input.action === "false-positive" ? -0.1 : 0;
  const result = await runQuery(
    `MATCH (a:Antibody {id: $antibodyId})
     MERGE (receipt:Feedback {id: $feedbackId})
     ON CREATE SET receipt.claim = $claim, receipt.sourceType = 'runtime', receipt.confidence = 1.0
     WITH a, receipt WHERE receipt.claim = $claim
     SET a.confidence = CASE WHEN coalesce(a.confidence, 0.0) + $delta > 1.0 THEN 1.0 WHEN coalesce(a.confidence, 0.0) + $delta < 0.0 THEN 0.0 ELSE toFloat(coalesce(a.confidence, 0.0) + $delta) END,
         a.status = CASE WHEN $action = 'regression' THEN 'verified' WHEN $action = 'intentional-change' THEN 'superseded' WHEN $action = 'false-positive' AND coalesce(a.confidence, 0.0) <= 0.100000001 THEN 'rejected' ELSE a.status END,
         a.sourceType = 'runtime', a.lastFeedback = $action, a.lastFeedbackActor = $actor, a.lastFeedbackAt = datetime()
     WITH a
     OPTIONAL MATCH (a)-[:PROTECTS]->(i:Invariant {id: $invariantId})
     FOREACH (_ IN CASE WHEN $action = 'intentional-change' AND i IS NOT NULL THEN [1] ELSE [] END |
       SET i.status = 'superseded', i.sourceType = 'runtime', i.lastFeedback = $action, i.lastFeedbackAt = datetime())
     RETURN a.id AS antibodyId, a.confidence AS confidence, a.status AS status`,
    { antibodyId: input.antibodyId, delta: confidenceDelta, action: input.action, actor: input.actor ?? "unknown", feedbackId: input.feedbackId ?? `${input.antibodyId}:feedback:${randomUUID()}`, claim: randomUUID(), invariantId: input.invariantId ?? null },
  );
  if (!result.records.length) return { antibodyId: input.antibodyId, alreadyRecorded: true };
  return { antibodyId: result.records[0].get("antibodyId") as string, confidence: Number(result.records[0].get("confidence")), status: result.records[0].get("status") as string };
}
