import { readBoundedBody, BodyTooLargeError } from "@/lib/http-body";
import { createHash } from "node:crypto";
import type { FeedbackAction } from "./feedback";
export interface FeedbackDependencies {
  getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
  findRepository(id: string, userId: string): Promise<{ id: string } | null>;
  getTargets(repositoryId: string, pullRequestId: string): Promise<Array<{ antibodyId: string; invariantId: string | null }>>;
  apply(input: { action: FeedbackAction; antibodyId: string; invariantId?: string; actor: string; feedbackId: string }): Promise<unknown>;
}

const actions = new Set(["regression", "intentional-change", "false-positive"]);
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;

export function createFeedbackHandler(deps: FeedbackDependencies) {
return async function POST(request: Request) {
  try {
    const session = await deps.getSession(request.headers);
    if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid origin" }, { status: 403 });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Expected JSON" }, { status: 415 });
    const raw = (await readBoundedBody(request, 4096)).toString();
    let body;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
    if (!body || typeof body.action !== "string" || !actions.has(body.action) || !identifier(body.antibodyId) || !identifier(body.pullRequestId) || !identifier(body.repositoryId)) return Response.json({ error: "Invalid runtime feedback payload" }, { status: 400 });
    const repository = await deps.findRepository(body.repositoryId, session.user.id);
    if (!repository) return Response.json({ error: "Forbidden" }, { status: 403 });
    const targets = await deps.getTargets(repository.id, body.pullRequestId);
    const target = targets.find(t => t.antibodyId === body.antibodyId);
    if (!target) return Response.json({ error: "Feedback target not found" }, { status: 404 });
    // One immutable vote per reviewer, antibody and PR prevents retry/repeated-click inflation.
    const feedbackId = createHash("sha256").update(JSON.stringify([session.user.id, body.pullRequestId, target.antibodyId])).digest("hex");
    const result = await deps.apply({ action: body.action as FeedbackAction, antibodyId: target.antibodyId, invariantId: target.invariantId ?? undefined, actor: session.user.id, feedbackId });
    return Response.json({ accepted: true, ...(result as object) });
  } catch (error) {
    if (error instanceof BodyTooLargeError) return Response.json({ error: "Payload too large" }, { status: 413 });
    return Response.json({ error: "Unable to record runtime feedback" }, { status: 503 });
  }
}

}
