import { getPineconeIndex } from "@/lib/pinecone";

const PINECONE_TEXT_FIELD = process.env.PINECONE_TEXT_FIELD ?? "text";
const EMBEDDING_BATCH_SIZE = 64;
const EMBEDDING_PARALLEL_BATCHES = 3;
const MAX_EMBEDDING_CHARS = 8000;

type RepositoryFile = { path: string; content: string };

function toIntegratedRecord(repoId: string, file: RepositoryFile) {
  const content = `File: ${file.path}\n\n${file.content}`.slice(
    0,
    MAX_EMBEDDING_CHARS,
  );

  return {
    _id: `${repoId}-${file.path.replace(/\//g, "_")}`,
    [PINECONE_TEXT_FIELD]: content,
    repoId,
    path: file.path,
  };
}

export async function indexCodeBase(
  repoId: string,
  files: RepositoryFile[],
) {
  const batches: RepositoryFile[][] = [];

  for (let i = 0; i < files.length; i += EMBEDDING_BATCH_SIZE) {
    batches.push(files.slice(i, i + EMBEDDING_BATCH_SIZE));
  }

  let nextBatch = 0;
  let indexedFiles = 0;
  let failedFiles = 0;
  let lastError: unknown;

  const worker = async () => {
    while (true) {
      const batchFiles = batches[nextBatch++];
      if (!batchFiles) return;

      try {
        await getPineconeIndex().upsertRecords({
          records: batchFiles.map((file) => toIntegratedRecord(repoId, file)),
        });
        indexedFiles += batchFiles.length;
      } catch (error) {
        failedFiles += batchFiles.length;
        lastError = error;
        console.error(
          `Failed to index batch (${batchFiles[0].path} to ${batchFiles.at(-1)?.path}):`,
          error,
        );
      }
    }
  };

  if (batches.length > 0) {
    await Promise.all(
      Array.from(
        { length: Math.min(EMBEDDING_PARALLEL_BATCHES, batches.length) },
        worker,
      ),
    );
  }

  if (files.length > 0 && indexedFiles === 0) {
    const message =
      lastError instanceof Error ? lastError.message : "Unknown Pinecone error";
    throw new Error(`Repository indexing failed: ${message}`);
  }

  console.log(
    `Indexing complete: ${indexedFiles} indexed, ${failedFiles} failed`,
  );

  return { indexedFiles, failedFiles };
}

export async function retrieveContext(
  query: string,
  repoId: string,
  topK: number = 5,
) {
  const results = await getPineconeIndex().searchRecords({
    query: {
      inputs: { text: query },
      filter: { repoId },
      topK,
    },
    fields: [PINECONE_TEXT_FIELD, "repoId", "path"],
  });

  return results.result.hits
    .map((hit) => {
      const fields = hit.fields as Record<string, unknown>;
      return fields[PINECONE_TEXT_FIELD] as string | undefined;
    })
    .filter((content): content is string => Boolean(content));
}
