import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import { indexRepo, pollRepositories } from "./functions";
import { generateReview } from "./functions/review";

// Create an API that serves zero functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [indexRepo, generateReview, pollRepositories],
});
