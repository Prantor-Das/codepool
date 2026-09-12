import { Pinecone } from "@pinecone-database/pinecone";

let pineconeIndex: ReturnType<Pinecone["index"]> | undefined;

export function getPineconeIndex() {
  const apiKey = process.env.PINECONE_DB_API_KEY;
  const indexName = process.env.PINECONE_INDEX;

  if (!apiKey || !indexName) {
    throw new Error(
      "Pinecone is not configured. Set PINECONE_DB_API_KEY and PINECONE_INDEX to enable AI indexing.",
    );
  }

  if (!pineconeIndex) {
    pineconeIndex = new Pinecone({ apiKey }).index(indexName);
  }

  return pineconeIndex;
}
