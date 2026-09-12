import { generateText } from "ai";
import { google } from "@ai-sdk/google";

const model = google("gemini-3.6-flash");

/** Shared JSON-only model call for structured knowledge-graph extraction. */
export async function generateAIJson<T>(prompt: string): Promise<T> {
  const result = await generateText({
    model,
    prompt,
    maxOutputTokens: 2048,
    temperature: 0.1,
    abortSignal: AbortSignal.timeout(60_000),
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: "minimal" },
        responseMimeType: "application/json",
      },
    },
  });

  const text = result.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return JSON.parse(text) as T;
}

