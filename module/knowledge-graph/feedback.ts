import { runQuery } from "./lib/graph-client";

export type FeedbackAction = "regression" | "intentional-change" | "false-positive";

export async function applyEvidenceFeedback(input: { action: FeedbackAction; antibodyId: string; invariantId?: string; newInvariantId?: string; actor?: string }) {
  const confidenceDelta = input.action === "regression" ? 0.1 : input.action === "false-positive" ? -0.1 : 0;
  const result = await runQuery(
    `MATCH (a:Antibody {id: $antibodyId})
     SET a.confidence = CASE WHEN coalesce(a.confidence, 0.0) + $delta > 1.0 THEN 1.0 WHEN coalesce(a.confidence, 0.0) + $delta < 0.0 THEN 0.0 ELSE toFloat(coalesce(a.confidence, 0.0) + $delta) END,
         a.status = CASE WHEN $action = 'regression' THEN 'verified' ELSE a.status END,
         a.sourceType = 'runtime', a.lastFeedback = $action, a.lastFeedbackActor = $actor, a.lastFeedbackAt = datetime()
     RETURN a.id AS antibodyId, a.confidence AS confidence, a.status AS status`,
    { antibodyId: input.antibodyId, delta: confidenceDelta, action: input.action, actor: input.actor ?? "unknown" },
  );
  if (!result.records.length) throw new Error(`Antibody not found: ${input.antibodyId}`);
  if (input.action === "intentional-change" && input.invariantId) {
    await runQuery(
      `MATCH (i:Invariant {id: $invariantId})
       SET i.status = 'superseded', i.sourceType = 'runtime', i.supersededBy = CASE WHEN $newInvariantId IS NULL THEN i.supersededBy ELSE $newInvariantId END,
           i.lastFeedback = 'intentional-change', i.lastFeedbackAt = datetime()
       RETURN i.id AS invariantId`,
      { invariantId: input.invariantId, newInvariantId: input.newInvariantId ?? null },
    );
  }
  return { antibodyId: result.records[0].get("antibodyId") as string, confidence: Number(result.records[0].get("confidence")), status: result.records[0].get("status") as string };
}
