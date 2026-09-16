/**
 * Runtime grounding for interview coaching.
 *
 * Combines two layers so answers are ALWAYS well-grounded:
 *  1) A distilled static playbook per category (instant, offline).
 *  2) Semantically-retrieved chunks from the curated reference corpus in
 *     Supabase (Alex Xu, Grokking, GeeksforGeeks, CtCI, EM guides…), when signed
 *     in and the corpus is populated.
 *
 * The result is a compact prompt block injected into hint/model-answer/grading
 * prompts, plus a list of "learn more" links for the UI. Never throws — any
 * retrieval failure degrades gracefully to the static playbook.
 */
import { embedText } from "@/lib/memory/embeddings";
import { getSupabase } from "@/lib/auth/client";
import {
  resolvePlaybook,
  type ReferenceCategory,
  type ReferenceLink,
} from "./playbooks";

export type { ReferenceCategory, ReferenceLink } from "./playbooks";

interface MatchedChunk {
  category: string;
  heading: string | null;
  content: string;
  url: string | null;
  title: string | null;
  authority: number;
  similarity: number;
}

const MIN_SIMILARITY = 0.3;
const MAX_CHUNK_CHARS = 900;

function clip(s: string, max = MAX_CHUNK_CHARS): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Fetch the top reference chunks for a query from the DB corpus. Returns [] when
 * not signed in, corpus empty, or on any error.
 */
async function retrieveChunks(
  category: ReferenceCategory,
  query: string,
  count: number,
  signal?: AbortSignal
): Promise<MatchedChunk[]> {
  const sb = getSupabase();
  if (!sb || !query.trim()) return [];
  try {
    const embedding = await embedText(query.slice(0, 6000));
    if (signal?.aborted) return [];
    const { data, error } = await sb.rpc("match_interview_reference_chunks", {
      query_embedding: embedding,
      match_category: category,
      match_count: count,
    });
    if (error || !Array.isArray(data)) return [];
    return (data as MatchedChunk[]).filter(
      (c) => (c.similarity ?? 0) >= MIN_SIMILARITY
    );
  } catch {
    return [];
  }
}

export interface ReferenceContext {
  /** Prompt-ready grounding block (playbook + retrieved excerpts). */
  block: string;
  /** Curated + retrieved "learn more" links (deduped). */
  links: ReferenceLink[];
}

/**
 * Build the grounding block for a category + specific question. Always returns
 * the static playbook; enriches with retrieved corpus excerpts when available.
 */
export async function buildReferenceContext(params: {
  category: ReferenceCategory;
  query: string;
  roleLevel?: string | null;
  chunkCount?: number;
  signal?: AbortSignal;
}): Promise<ReferenceContext> {
  const { category, query, roleLevel, chunkCount = 5, signal } = params;
  const playbook = resolvePlaybook(category, roleLevel);

  const chunks = await retrieveChunks(category, query, chunkCount, signal);

  const parts: string[] = [
    "=== INTERVIEW REFERENCE (ground your answer in this; do not contradict it) ===",
    `## ${playbook.title}`,
    playbook.guidance,
  ];

  const links: ReferenceLink[] = [...playbook.learnMore];

  if (chunks.length) {
    const lines = chunks.map((c, i) => {
      const src = c.title || c.url || "reference";
      const head = c.heading ? ` · ${c.heading}` : "";
      if (c.url && !links.some((l) => l.url === c.url)) {
        links.push({ label: c.title || c.url, url: c.url });
      }
      return `[R${i + 1}] (${src}${head})\n${clip(c.content)}`;
    });
    parts.push(
      "## Verified excerpts from the reference library (cite ideas, don't copy verbatim):",
      lines.join("\n\n")
    );
  }

  parts.push(
    "Do NOT include any \"Learn more\" / reference link list in your answer; links are internal only.",
    "=== END INTERVIEW REFERENCE ==="
  );

  // Links are kept internally (not shown to the user).
  const seen = new Set<string>();
  const dedupLinks = links
    .filter((l) => {
      if (!l.url || seen.has(l.url)) return false;
      seen.add(l.url);
      return true;
    })
    .slice(0, 6);

  return { block: parts.join("\n\n"), links: dedupLinks };
}

/**
 * Convenience: just the prompt block (never throws). Callers that only need to
 * ground a prompt can prepend this to their user message.
 */
export async function referenceBlock(params: {
  category: ReferenceCategory;
  query: string;
  roleLevel?: string | null;
  signal?: AbortSignal;
}): Promise<string> {
  try {
    const { block } = await buildReferenceContext(params);
    return block;
  } catch {
    return "";
  }
}
