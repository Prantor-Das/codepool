import OpenAI from "openai";

export const client = new OpenAI({
  baseURL: "https://api-inference.modelscope.cn/v1",
  apiKey: process.env.MODELSCOPE_API_KEY,
});

export async function generateReviewText(prompt: string): Promise<string> {
  const completion = await client.chat.completions.create({
    model: "Qwen/Qwen3.5-27B",
    messages: [{ role: "user", content: prompt }],
  });

  return completion.choices[0]?.message?.content ?? "";
}
