import { getSupabase } from "@/lib/auth/client";
import { backendChatStream, backendWebSearch } from "@/lib/backend";
import { parseJsonFromLLM } from "@/lib/llm";
import { MODEL_ANSWER_FORMAT_RULES } from "./model-answer-format";
import type { QuestionCategory, QuestionDifficulty } from "./question-bank";

/** Roles the question bank is organized by. `label` is stored in role_level. */
export const INTERVIEW_ROLES = [
  { id: "software_engineer", label: "Software Engineer" },
  { id: "senior_staff_engineer", label: "Senior / Staff Engineer" },
  { id: "engineering_manager", label: "Engineering Manager" },
  { id: "frontend_engineer", label: "Frontend Engineer" },
  { id: "backend_engineer", label: "Backend Engineer" },
  { id: "data_ml_engineer", label: "Data / ML Engineer" },
  { id: "product_manager", label: "Product Manager" },
  { id: "devops_sre", label: "DevOps / SRE" },
  { id: "data_scientist", label: "Data Scientist" },
  { id: "management_consultant", label: "Management Consultant" },
  { id: "ib_analyst", label: "Investment Banking Analyst" },
] as const;

export type InterviewRoleId = (typeof INTERVIEW_ROLES)[number]["id"];

export interface ResearchProgress {
  done: number;
  total: number;
  added: number;
  message: string;
}

interface GenQuestion {
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  question: string;
  model_answer: string;
  tags: string[];
}

const CATS: QuestionCategory[] = [
  "technical",
  "behavioral",
  "coding",
  "system_design",
];
const DIFFS: QuestionDifficulty[] = ["easy", "medium", "hard"];
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

async function collectChat(
  messages: { role: "system" | "user"; content: string }[],
  signal?: AbortSignal
): Promise<string> {
  let full = "";
  for await (const chunk of backendChatStream({ messages, signal })) {
    full += chunk;
  }
  return full;
}

async function researchContext(
  companyName: string,
  roleLabel: string
): Promise<string> {
  try {
    const json = await backendWebSearch(
      `${companyName} ${roleLabel} interview questions process technical behavioral system design coding`,
      4
    );
    const web: any[] = json?.data?.web ?? json?.data ?? [];
    return (Array.isArray(web) ? web : [])
      .slice(0, 4)
      .map(
        (r) =>
          `# ${r.title ?? r.url ?? ""}\n${(
            r.markdown ||
            r.description ||
            ""
          ).slice(0, 800)}`
      )
      .join("\n\n")
      .slice(0, 5000);
  } catch {
    return "";
  }
}

async function generateForRole(
  companyName: string,
  roleLabel: string,
  context: string,
  signal?: AbortSignal
): Promise<GenQuestion[]> {
  const system = `You build a realistic, ROLE-SPECIFIC interview question bank for a company.
For the given company and ROLE, produce ORIGINAL, representative questions tailored to that role
(do NOT copy proprietary/verbatim text). Ground them in the company's real domain and the role.
Return STRICT JSON only: {"questions":[{ "category":"technical"|"behavioral"|"coding"|"system_design",
"difficulty":"easy"|"medium"|"hard", "question":string, "model_answer":string (GitHub-flavored Markdown),
"tags":string[] (2-4) }]}.

${MODEL_ANSWER_FORMAT_RULES}

Produce ~3 questions per category (about 12 total), spread across difficulties, specific to this ROLE.`;
  const user = `Company: ${companyName}\nRole: ${roleLabel}\n\nResearch context (may be sparse):\n${
    context || "(use your knowledge of this company + role's typical interviews)"
  }`;

  const raw = await collectChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    signal
  );
  const parsed = parseJsonFromLLM<{ questions: any[] }>(raw);
  const arr = Array.isArray(parsed?.questions) ? parsed!.questions : [];
  return arr
    .filter((q) => q && CATS.includes(q.category) && q.question)
    .map((q) => ({
      category: q.category as QuestionCategory,
      difficulty: (DIFFS.includes(q.difficulty)
        ? q.difficulty
        : "medium") as QuestionDifficulty,
      question: String(q.question).slice(0, 1000),
      model_answer: String(q.model_answer || "").slice(
        0,
        q.category === "system_design" ? 12000 : 3000
      ),
      tags: Array.isArray(q.tags)
        ? q.tags.slice(0, 4).map((t: any) => String(t).slice(0, 40))
        : [],
    }));
}

/**
 * Run role-based interview research and APPEND new questions to the bank.
 * Client-side (uses the managed backend for web + LLM, and inserts via the
 * signed-in admin's session — RLS requires is_admin). Resumable (skips
 * company+role combos already populated) and stoppable (AbortSignal).
 */
export async function runInterviewResearch(opts: {
  roleIds: InterviewRoleId[];
  /** Optional: limit to these company slugs. */
  companySlugs?: string[];
  signal?: AbortSignal;
  onProgress?: (p: ResearchProgress) => void;
}): Promise<{ added: number }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Not signed in.");

  const roles = INTERVIEW_ROLES.filter((r) =>
    opts.roleIds.includes(r.id as InterviewRoleId)
  );
  if (roles.length === 0) return { added: 0 };

  // Companies.
  let cq = sb.from("companies").select("id,slug,name").order("name");
  const { data: companies, error: cErr } = await cq;
  if (cErr) throw new Error(cErr.message);
  let list = (companies ?? []) as { id: string; slug: string; name: string }[];
  if (opts.companySlugs?.length) {
    const set = new Set(opts.companySlugs);
    list = list.filter((c) => set.has(c.slug));
  }

  // Existing (company_id, role_level) combos → skip; existing question text → dedupe.
  const { data: existing } = await sb
    .from("interview_questions")
    .select("company_id,role_level,question")
    .limit(20000);
  const doneCombo = new Set<string>();
  const textByCompany = new Map<string, Set<string>>();
  for (const row of (existing ?? []) as {
    company_id: string;
    role_level: string | null;
    question: string;
  }[]) {
    if (row.role_level) doneCombo.add(`${row.company_id}::${row.role_level}`);
    const s = textByCompany.get(row.company_id) ?? new Set<string>();
    s.add(norm(row.question));
    textByCompany.set(row.company_id, s);
  }

  // Worklist = companies × roles, skipping already-done combos.
  const work: { company: (typeof list)[number]; role: (typeof roles)[number] }[] =
    [];
  for (const company of list) {
    for (const role of roles) {
      if (doneCombo.has(`${company.id}::${role.label}`)) continue;
      work.push({ company, role });
    }
  }

  const total = work.length;
  let done = 0;
  let added = 0;
  opts.onProgress?.({
    done,
    total,
    added,
    message: `Starting: ${total} company/role combinations to research`,
  });

  for (const { company, role } of work) {
    if (opts.signal?.aborted) break;
    try {
      const ctx = await researchContext(company.name, role.label);
      if (opts.signal?.aborted) break;
      const qs = await generateForRole(
        company.name,
        role.label,
        ctx,
        opts.signal
      );
      const seen = textByCompany.get(company.id) ?? new Set<string>();
      const rows = qs
        .filter((q) => {
          const k = norm(q.question);
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((q) => ({
          company_id: company.id,
          category: q.category,
          difficulty: q.difficulty,
          role_level: role.label,
          question: q.question,
          model_answer: q.model_answer || null,
          tags: q.tags,
          source: "admin-research",
        }));
      textByCompany.set(company.id, seen);
      if (rows.length > 0) {
        const { error: iErr } = await sb
          .from("interview_questions")
          .insert(rows);
        if (iErr) throw new Error(iErr.message);
        added += rows.length;
      }
      done += 1;
      opts.onProgress?.({
        done,
        total,
        added,
        message: `${company.name} · ${role.label}: +${rows.length}`,
      });
    } catch (err) {
      done += 1;
      opts.onProgress?.({
        done,
        total,
        added,
        message: `${company.name} · ${role.label} failed: ${
          err instanceof Error ? err.message.slice(0, 80) : "error"
        }`,
      });
    }
  }

  opts.onProgress?.({
    done,
    total,
    added,
    message: opts.signal?.aborted
      ? `Stopped. Added ${added} questions.`
      : `Done. Added ${added} questions.`,
  });
  return { added };
}
