import { getSupabase } from "@/lib/auth/client";
import { backendChatStream, backendFirecrawlScrape } from "@/lib/backend";
import { parseJsonFromLLM } from "@/lib/llm";
import type { QuestionCategory, QuestionDifficulty } from "./question-bank";

const CATS: QuestionCategory[] = [
  "technical",
  "behavioral",
  "coding",
  "system_design",
];
const DIFFS: QuestionDifficulty[] = ["easy", "medium", "hard"];
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const STYLE = `model_answer FORMAT (GitHub-flavored Markdown, rendered with syntax highlighting + Mermaid):
- coding: a working solution in a fenced code block with the right language tag + inline comments, then **Explanation:** and **Complexity:** (Big-O).
- technical: fenced code block with comments when code/config/query helps, then a brief explanation; else concise prose/bullets.
- system_design: a \`\`\`mermaid flowchart (clients, services, stores, queues, caches, data flow), then **Components:** bullets, **Scaling:**, **Trade-offs:**.
- behavioral: concise STAR prose, no code.`;

async function collectChat(
  messages: { role: "system" | "user"; content: string }[],
  signal?: AbortSignal
): Promise<string> {
  let full = "";
  for await (const chunk of backendChatStream({ messages, signal })) full += chunk;
  return full;
}

async function extractVerified(
  companyName: string,
  markdown: string,
  signal?: AbortSignal
) {
  const system = `You extract REAL interview questions for ${companyName} from a scraped web page.
Only include questions genuinely present or clearly implied by the page. Do NOT invent company-specific
claims. Rewrite each into clean, original phrasing (no verbatim copyrighted text). Classify each and write
a strong model answer.
Return STRICT JSON: {"questions":[{ "category":"technical"|"behavioral"|"coding"|"system_design",
"difficulty":"easy"|"medium"|"hard", "role_level": string|null, "question": string, "model_answer": string,
"tags": string[] (2-4) }]}. Extract UP TO 12 representative questions. If none, return {"questions":[]}.

${STYLE}`;
  const raw = await collectChat(
    [
      { role: "system", content: system },
      {
        role: "user",
        content: `Company: ${companyName}\n\nScraped page (markdown, truncated):\n${markdown.slice(
          0,
          12000
        )}`,
      },
    ],
    signal
  );
  const parsed = parseJsonFromLLM<{ questions: any[] }>(raw);
  const arr = Array.isArray(parsed?.questions) ? parsed!.questions : [];
  return arr
    .filter((q) => q && q.question && CATS.includes(q.category))
    .map((q) => ({
      category: q.category as QuestionCategory,
      difficulty: (DIFFS.includes(q.difficulty)
        ? q.difficulty
        : "medium") as QuestionDifficulty,
      role_level:
        q.role_level && String(q.role_level).trim()
          ? String(q.role_level).slice(0, 60)
          : null,
      question: String(q.question).slice(0, 1000),
      model_answer: String(q.model_answer || "").slice(0, 3000),
      tags: Array.isArray(q.tags)
        ? q.tags.slice(0, 4).map((t: any) => String(t).slice(0, 40))
        : [],
    }));
}

export interface RefreshProgress {
  done: number;
  total: number;
  added: number;
  message: string;
}

/**
 * Change-tracked verified-question refresh, runnable from the app (admin).
 * Re-scrapes each tracked source via the Firecrawl proxy (stable identity, so
 * change detection works), and only re-extracts + appends verified questions
 * when a page is new/changed. Logs a research_run + per-source items.
 * Stoppable (AbortSignal), resumable (unchanged pages are skipped).
 */
export async function runVerifiedRefresh(opts: {
  tag?: string;
  signal?: AbortSignal;
  onProgress?: (p: RefreshProgress) => void;
  /** When set, only re-scrape these source ids (e.g. monitor-pending queue). */
  onlySourceIds?: string[];
}): Promise<{ added: number }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Not signed in.");
  const tag = opts.tag || "iq-verify";

  let q = sb
    .from("interview_sources")
    .select("id,url,company_id,questions_from_source,companies(name)")
    .eq("active", true)
    .order("last_checked_at", { ascending: true, nullsFirst: true });
  if (opts.onlySourceIds?.length) {
    q = q.in("id", opts.onlySourceIds);
  }
  const { data: sources, error: sErr } = await q;
  if (sErr) throw new Error(sErr.message);
  const list = (sources ?? []) as any[];

  const { data: runRow } = await sb
    .from("research_runs")
    .insert({ kind: "refresh", status: "running", trigger: "manual" })
    .select("id")
    .single();
  const runId: string | undefined = runRow?.id;

  const total = list.length;
  let done = 0;
  let added = 0;
  let changed = 0;
  const seenByCompany = new Map<string, Set<string>>();
  const loadSeen = async (companyId: string) => {
    const cached = seenByCompany.get(companyId);
    if (cached) return cached;
    const { data } = await sb
      .from("interview_questions")
      .select("question")
      .eq("company_id", companyId)
      .limit(5000);
    const set = new Set((data ?? []).map((r: any) => norm(r.question)));
    seenByCompany.set(companyId, set);
    return set;
  };

  opts.onProgress?.({
    done,
    total,
    added,
    message:
      total === 0
        ? "No tracked sources yet. Run the CLI engine once to seed sources."
        : `Checking ${total} tracked sources for updates…`,
  });

  for (const src of list) {
    if (opts.signal?.aborted) break;
    const companyName = src.companies?.name ?? "the company";
    try {
      const { markdown, changeStatus } = await backendFirecrawlScrape(
        src.url,
        tag
      );
      const isChanged = changeStatus === "new" || changeStatus === "changed";
      let add = 0;
      if (isChanged && markdown.length > 200) {
        const qs = await extractVerified(companyName, markdown, opts.signal);
        const seen = await loadSeen(src.company_id);
        const rows = qs
          .filter((q) => {
            const k = norm(q.question);
            if (!k || seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .map((q) => ({
            company_id: src.company_id,
            category: q.category,
            difficulty: q.difficulty,
            role_level: q.role_level,
            question: q.question,
            model_answer: q.model_answer || null,
            tags: q.tags,
            source: "verified-firecrawl",
            source_url: src.url,
            source_id: src.id,
          }));
        if (rows.length) {
          const { error } = await sb.from("interview_questions").insert(rows);
          if (error) throw new Error(error.message);
          add = rows.length;
        }
      }
      if (isChanged) changed += 1;
      added += add;
      await sb
        .from("interview_sources")
        .update({
          last_status: changeStatus,
          last_checked_at: new Date().toISOString(),
          ...(isChanged ? { last_changed_at: new Date().toISOString() } : {}),
          questions_from_source: (src.questions_from_source || 0) + add,
        })
        .eq("id", src.id);
      if (runId)
        await sb.from("research_run_items").insert({
          run_id: runId,
          company_id: src.company_id,
          source_id: src.id,
          url: src.url,
          company_name: companyName,
          change_status: changeStatus,
          questions_added: add,
          questions_verified: add,
        });
      done += 1;
      opts.onProgress?.({
        done,
        total,
        added,
        message: `${companyName} · ${changeStatus} · +${add}`,
      });
    } catch (err) {
      done += 1;
      await sb
        .from("interview_sources")
        .update({ last_status: "error", last_checked_at: new Date().toISOString() })
        .eq("id", src.id)
        .then(
          () => {},
          () => {}
        );
      if (runId)
        await sb
          .from("research_run_items")
          .insert({
            run_id: runId,
            company_id: src.company_id,
            source_id: src.id,
            url: src.url,
            company_name: companyName,
            change_status: "error",
            error: (err instanceof Error ? err.message : String(err)).slice(
              0,
              300
            ),
          })
          .then(
            () => {},
            () => {}
          );
      opts.onProgress?.({
        done,
        total,
        added,
        message: `${companyName} · failed: ${
          err instanceof Error ? err.message.slice(0, 60) : "error"
        }`,
      });
    }
  }

  if (runId)
    await sb
      .from("research_runs")
      .update({
        status: opts.signal?.aborted ? "stopped" : "completed",
        finished_at: new Date().toISOString(),
        sources_checked: done,
        sources_changed: changed,
        questions_added: added,
        questions_verified: added,
      })
      .eq("id", runId);

  opts.onProgress?.({
    done,
    total,
    added,
    message: opts.signal?.aborted
      ? `Stopped. Added ${added} verified questions.`
      : `Done. Added ${added} verified questions across ${changed} changed sources.`,
  });
  return { added };
}
