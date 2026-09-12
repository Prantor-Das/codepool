import { createHmac, timingSafeEqual } from "node:crypto";
import { inngest } from "@/inngest/client";
import { prisma } from "@/src/prisma/db";
import { NextResponse, NextRequest } from "next/server";

function verifySignature(rawBody: Buffer, signature: string | null) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;

  const received = signature.slice("sha256=".length);
  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const receivedBuffer = Buffer.from(received, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function isUniqueConstraintError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === "P2002" ||
    candidate.code === "23505" ||
    /unique constraint|duplicate key/i.test(candidate.message ?? "")
  );
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = Buffer.from(await req.arrayBuffer());
    if (!verifySignature(rawBody, req.headers.get("x-hub-signature-256"))) {
      return NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 401 },
      );
    }

    const deliveryId = req.headers.get("x-github-delivery");
    if (!deliveryId) {
      return NextResponse.json(
        { error: "Missing GitHub delivery ID" },
        { status: 400 },
      );
    }

    const body = JSON.parse(rawBody.toString("utf8"));
    const event = req.headers.get("x-github-event");
    console.log(
      `[github-webhook] received event=${event} delivery=${deliveryId}`,
    );

    try {
      await prisma.orm.public.WebhookDelivery.create({ deliveryId });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        console.log(
          `[github-webhook] duplicate delivery=${deliveryId}; skipping`,
        );
        return NextResponse.json(
          { message: "Duplicate delivery" },
          { status: 200 },
        );
      }
      throw error;
    }

    if (event === "ping") {
      return NextResponse.json({ message: "Pong" }, { status: 200 });
    }

    if (event === "pull_request") {
      const action = body.action;
      const repo = body.repository.full_name;
      const prNumber = body.number;

      const [owner, repoName] = repo.split("/");

      if (
        action === "opened" ||
        action === "synchronize" ||
        action === "reopened" ||
        action === "ready_for_review"
      ) {
        const repository = await prisma.orm.public.Repository.where({
          owner,
          name: repoName,
        }).first();

        if (!repository) {
          throw new Error(`Repository is not connected: ${repo}`);
        }

        // Send directly from the authenticated webhook. Do not route this
        // through a server action or preflight GitHub request: the webhook
        // must complete the Inngest handoff before returning 200.
        await inngest.send({
          name: "pr.review.requested",
          data: {
            repositoryId: repository.id,
            owner,
            repo: repoName,
            prNumber,
            userId: repository.userId,
          },
        });

        console.log(
          `[github-webhook] queued pr.review.requested repo=${repo} pr=${prNumber} delivery=${deliveryId}`,
        );
      } else {
        console.log(
          `[github-webhook] ignored pull_request action=${action} repo=${repo} pr=${prNumber}`,
        );
      }
    }

    return NextResponse.json(
      { message: "Event processed", deliveryId },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error processing webhook:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
