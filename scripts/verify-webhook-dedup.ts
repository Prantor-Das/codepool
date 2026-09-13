import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/prisma/db";
const deliveryId = `codepool-audit-${randomUUID()}`;
try {
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => prisma.orm.public.WebhookDelivery.create({ deliveryId })));
  const winners = results.filter(r => r.status === "fulfilled").length;
  if (winners !== 1) throw new Error(`Expected one successful atomic claim, got ${winners}.`);
  console.log("PASS: 20 concurrent webhook claims produced exactly one successful INSERT.");
  const rows = await prisma.orm.public.WebhookDelivery.where({ deliveryId }).all();
  if (rows.length !== 1) throw new Error("Duplicate delivery persisted.");
  console.log("PASS: unique delivery constraint left exactly one persisted row.");
} catch (error) { console.error("FAIL:", error instanceof Error ? error.message : "Dedup verification failed"); process.exitCode = 1; }
finally { await prisma.orm.public.WebhookDelivery.where({ deliveryId }).delete(); await prisma.close(); }
