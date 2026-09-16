import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getEmbeddingApiKey } from "./settings";
import { isManagedModeEnabled, backendEmbed } from "@/lib/backend";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
export const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Embed a batch of texts. When signed in (managed mode) this routes through the
 * backend proxy; otherwise it calls OpenAI directly with a locally-configured
 * key. Returns one vector per input, preserving order.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const inputs = texts.map((t) => (t ?? "").slice(0, 8000));

  if (isManagedModeEnabled()) {
    return backendEmbed(inputs);
  }

  const apiKey = getEmbeddingApiKey();
  if (!apiKey) {
    throw new Error(
      "No OpenAI API key available for embeddings. Configure one in Memory settings."
    );
  }

  const res = await tauriFetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Embedding request failed (${res.status}): ${detail}`);
  }

  const json: any = await res.json();
  const data: any[] = json?.data ?? [];
  // Sort by index to be safe, then map to vectors.
  return data
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding as number[]);
}

export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  return vec;
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
