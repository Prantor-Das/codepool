export class BodyTooLargeError extends Error {}

/** Bounded download used exclusively on the trusted control plane. */
export async function readBoundedBody(response: Pick<Request, "body">, limit: number): Promise<Buffer> {
  if (!response.body) throw new Error("Missing response body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new BodyTooLargeError("Response exceeds size limit.");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); reader.releaseLock(); }
}

