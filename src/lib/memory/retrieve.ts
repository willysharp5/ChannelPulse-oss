import { embedText } from "./embeddings";
import { firecrawlSearch } from "./firecrawl";
import { getMemorySettings, getUserProfile } from "./settings";
import { getDisabledFileSources } from "./file-selection";
import { searchMemories } from "@/lib/database/memory.action";
import type { Citation } from "@/types/completion";

export interface RetrievedContext {
  /** The context block injected into the system prompt. */
  text: string;
  /** Numbered sources referenced in the block, for inline [n] citations. */
  citations: Citation[];
}

const MAX_CHUNK_CHARS = 700;

/** Trim a chunk of retrieved content so the context block stays compact. */
function truncate(text: string, max = MAX_CHUNK_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export interface RetrieveOptions {
  /** Override the web-search setting for this specific call. */
  useWeb?: boolean;
  /** Skip file retrieval for this call (profile still applies unless skipped). */
  skipMemory?: boolean;
}

/**
 * Build a context block from the user profile, selected Files (e.g. resume),
 * and optionally live web search.
 *
 * Past conversation chat-summaries are NOT used — each session stays independent.
 */
export async function retrieveContext(
  query: string,
  options: RetrieveOptions = {}
): Promise<RetrievedContext> {
  const settings = getMemorySettings();
  const q = (query ?? "").trim();
  if (!q) return { text: "", citations: [] };

  const blocks: string[] = [];
  const citations: Citation[] = [];
  let n = 0;

  const profile = getUserProfile().trim();
  if (profile) {
    blocks.push(`About the user:\n${profile}`);
    // Meta citation (n: 0) — not for inline [n] in the model reply; UI clue only.
    citations.push({
      n: 0,
      type: "profile",
      title: "Your profile",
      snippet: truncate(profile, 280),
    });
  }

  if (!options.skipMemory) {
    try {
      const queryEmbedding = await embedText(q);
      const fileResults = await searchMemories(queryEmbedding, {
        topK: settings.topK,
        minScore: settings.minScore,
        kinds: ["file"],
        allScopes: true,
        excludeSources: getDisabledFileSources(),
      });

      if (fileResults.length > 0) {
        const lines = fileResults.map((r) => {
          n += 1;
          const title = `File: ${
            r.record.source_label ?? r.record.source ?? "unknown"
          }`;
          const snippet = truncate(r.record.content);
          citations.push({
            n,
            type: "file",
            title,
            snippet,
          });
          return `[${n}] (${title}) ${snippet}`;
        });
        blocks.push(`Relevant files (cite with [n]):\n${lines.join("\n")}`);
      }
    } catch (err) {
      console.warn("File retrieval failed:", err);
    }
  }

  const useWeb = options.useWeb ?? settings.webSearchEnabled;
  if (useWeb) {
    try {
      const results = await firecrawlSearch(q, settings.webLimit);
      if (results.length > 0) {
        const lines = results.map((r) => {
          n += 1;
          const body = truncate(r.markdown || r.description || "", 500);
          citations.push({
            n,
            type: "web",
            title: r.title || r.url,
            url: r.url,
            snippet: body,
          });
          return `[${n}] ${r.title} (${r.url})\n${body}`;
        });
        blocks.push(
          `Live web search results (cite with [n]):\n${lines.join("\n\n")}`
        );
      }
    } catch (err) {
      console.warn("Web retrieval failed:", err);
    }
  }

  if (blocks.length === 0) return { text: "", citations: [] };

  const text = [
    "--- Retrieved context (use if relevant; ignore if not). When you use a numbered source, cite it inline with its [n]. ---",
    ...blocks,
    "--- End retrieved context ---",
  ].join("\n\n");

  return { text, citations };
}
