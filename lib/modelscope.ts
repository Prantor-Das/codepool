import { generateText } from "ai";
import { google } from "@ai-sdk/google";

const reviewModel = google("gemini-3.6-flash");

export async function generateReviewText(prompt: string): Promise<string> {
  const result = await generateText({
    model: reviewModel,
    prompt,
    maxOutputTokens: 8192,
    temperature: 0.2,
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingLevel: "minimal",
        },
      },
    },
  });

  return result.text;
}
