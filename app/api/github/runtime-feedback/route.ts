import { NextResponse } from "next/server";
import { getGithubToken } from "@/module/github/lib/github";
import { inngest } from "@/inngest/client";

const actions = new Set(["regression", "intentional-change", "false-positive"]);

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; repositoryId?: string; pullRequestId?: string; antibodyId?: string; invariantId?: string; newInvariantId?: string };
    if (!body.action || !actions.has(body.action) || !body.antibodyId || !body.pullRequestId || !body.repositoryId) return NextResponse.json({ error: "Invalid runtime feedback payload" }, { status: 400 });
    await getGithubToken();
    await inngest.send({ name: "pr.feedback.received", data: { ...body, action: body.action } });
    return NextResponse.json({ accepted: true });
  } catch (error) {
    console.error("Runtime feedback failed:", error);
    return NextResponse.json({ error: "Unable to record runtime feedback" }, { status: 500 });
  }
}
