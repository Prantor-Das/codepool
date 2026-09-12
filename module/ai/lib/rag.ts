import { getPineconeIndex } from "@/lib/pinecone";
import { embed } from "ai";
import { google } from "@ai-sdk/google";

export async function generateEmbedding(text: string) {
  const { embedding } = await embed({
    model: google.textEmbeddingModel("text-embedding-004"),
    value: text,
  });

  return embedding;
}

export async function indexCodeBase(
  repoId: string,
  files: { path: string; content: string }[],
) {
  const vectors = [];

  for (const file of files) {
    const content = `File: ${file.path}\n\n${file.content}`;

    const truncatedContent = content.slice(0, 8000);

    try {
      const embedding = await generateEmbedding(truncatedContent);

      vectors.push({
        id: `${repoId}-${file.path.replace(/\//g, "_")}`,
        values: embedding,
        metadata: {
          repoId,
          path: file.path,
          content: truncatedContent,
        },
      });
    } catch (error) {
      console.error(`Failed to embed file: ${file.path}`, error);
    }
  }

  if (vectors.length > 0) {
    const batchsize = 100;

    for (let i = 0; i < vectors.length; i += batchsize) {
      const batch = vectors.slice(i, i + batchsize);

      await getPineconeIndex().upsert({ records: batch });
    }
  }

  console.log("Indexing complete");
}

export async function retrieveContext(
  query: string,
  repoId: string,
  topK: number = 5,
) {
  const embedding = await generateEmbedding(query);

  const results = await getPineconeIndex().query({
    vector: embedding,
    filter: { repoId },
    topK,
    includeMetadata: true,
  });

  return results.matches
    .map((match) => match.metadata?.content as string)
    .filter(Boolean);
}
