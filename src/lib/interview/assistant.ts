import { parseJsonFromLLM, runLLM, type LlmConfig } from "@/lib/llm";
import { firecrawlSearch, firecrawlScrape } from "@/lib/memory";
import { normalizeQuestionCategory } from "./templates";

export interface AssistQuestion {
  question: string;
  category: string;
}

export interface AssistResult {
  questions: AssistQuestion[];
  summary: string;
  /** Short note about any web/URL research performed (for the chat log). */
  researchNote?: string;
}

const URL_RE = /\bhttps?:\/\/[^\s)]+/gi;
const WEB_INTENT =
  /\b(online|web|internet|find|research|search|blind|glassdoor|levels|leetcode|real|reddit|source)\b/i;

/**
 * Conversational question manager. Given the current questions + a natural-
 * language instruction (which may include URLs to crawl or a request to search
 * the web), it optionally researches via Firecrawl and returns the UPDATED full
 * question list plus a one-line summary of what changed.
 */
export async function assistInterviewQuestions(params: {
  config: LlmConfig;
  instruction: string;
  current: AssistQuestion[];
  role?: string;
  company?: string;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<AssistResult> {
  const { config, instruction, current } = params;
  let researchContext = "";
  let researchNote = "";

  const urls = (instruction.match(URL_RE) || []).slice(0, 2);
  if (urls.length) {
    params.onProgress?.(
      `Crawling ${urls.length} link${urls.length === 1 ? "" : "s"}…`
    );
    const parts: string[] = [];
    for (const u of urls) {
      const md = await firecrawlScrape(u);
      if (md.trim()) parts.push(`# ${u}\n${md.slice(0, 4000)}`);
    }
    if (parts.length) {
      researchContext = parts.join("\n\n");
      researchNote = `Crawled ${parts.length} link${parts.length === 1 ? "" : "s"}`;
    }
  } else if (WEB_INTENT.test(instruction)) {
    params.onProgress?.("Searching the web…");
    const query = `${params.company || ""} ${params.role || ""} interview questions ${instruction}`
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    const results = await firecrawlSearch(query, 5);
    if (results.length) {
      researchContext = results
        .map(
          (r, i) =>
            `[${i + 1}] ${r.title} (${r.url})\n${(r.markdown || r.description || "")
              .replace(/\s+/g, " ")
              .slice(0, 900)}`
        )
        .join("\n\n");
      researchNote = `Found ${results.length} web source${results.length === 1 ? "" : "s"}`;
    }
  }

  if (params.signal?.aborted)
    throw new DOMException("Aborted", "AbortError");
  params.onProgress?.("Updating your questions…");

  const system =
    `You manage a practice interview's QUESTION LIST. Given the current questions ` +
    `(each with a category), the user's instruction, and optional research context, ` +
    `return the UPDATED FULL list. You may add, edit, remove, reorder, or recategorize. ` +
    `Keep at most 20 questions and preserve good existing ones unless asked otherwise.\n` +
    `Categorize accurately: "behavioral" (stories / "tell me about a time" / decisions / ` +
    `leadership, e.g. "How have you handled architectural DECISIONS in a fast-paced ` +
    `environment?" is BEHAVIORAL), "technical" (concept Q&A / trade-offs), "coding" ` +
    `(write an algorithm/function), "system_design" (design/architect a system).\n` +
    `When research context is provided, ground NEW questions in it (adapt wording; never ` +
    `copy paywalled text verbatim).\n` +
    `Return ONLY JSON (no markdown fences): ` +
    `{"questions":[{"question":string,"category":"behavioral|technical|coding|system_design"}],` +
    `"summary":"<one sentence describing what you changed>"}`;

  const user =
    (params.role ? `ROLE: ${params.role}\n` : "") +
    (params.company ? `COMPANY: ${params.company}\n` : "") +
    `CURRENT QUESTIONS (${current.length}):\n` +
    (current.length
      ? current
          .map((q, i) => `${i + 1}. [${q.category}] ${q.question}`)
          .join("\n")
      : "(none yet)") +
    `\n\nINSTRUCTION:\n${instruction}\n` +
    (researchContext
      ? `\nRESEARCH CONTEXT:\n"""\n${researchContext.slice(0, 6000)}\n"""\n`
      : "") +
    `\nReturn the updated JSON now.`;

  const raw = await runLLM(config, system, user, {
    structured: true,
    signal: params.signal,
  });
  const parsed = parseJsonFromLLM<{ questions?: unknown[]; summary?: string }>(
    raw
  );

  const questions: AssistQuestion[] = Array.isArray(parsed?.questions)
    ? (parsed!.questions as any[])
        .map((q) => ({
          question: String(q?.question || "").trim(),
          category: normalizeQuestionCategory(q?.category),
        }))
        .filter((q) => q.question)
        .slice(0, 20)
    : current;

  const summary =
    String(parsed?.summary || "").trim() ||
    (questions.length === current.length
      ? "Updated your questions."
      : `Now ${questions.length} questions.`);

  return { questions, summary, researchNote: researchNote || undefined };
}
