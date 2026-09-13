import { auth } from "@/lib/auth";
import { prisma } from "@/src/prisma/db";
import { getFeedbackTargets } from "@/module/knowledge-graph/feedback-targets";
import { applyEvidenceFeedback } from "@/module/knowledge-graph/feedback";
import { createFeedbackHandler } from "@/module/knowledge-graph/feedback-handler";

export const POST = createFeedbackHandler({
  getSession: headers => auth.api.getSession({ headers }),
  findRepository: (id, userId) => prisma.orm.public.Repository.where({ id, userId }).select("id").first(),
  getTargets: getFeedbackTargets,
  apply: applyEvidenceFeedback,
});
