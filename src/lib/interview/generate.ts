import { parseJsonFromLLM, runLLM, type LlmConfig } from "@/lib/llm";
import { firecrawlSearch, firecrawlScrape, getFirecrawlApiKey } from "@/lib/memory";
import { isManagedModeEnabled } from "@/lib/backend";
import {
  blankInterviewTemplate,
  INTERVIEW_CATEGORIES,
  normalizeInterviewCategory,
  normalizeInterviewVoice,
  normalizeQuestionCategory,
  type InterviewDifficulty,
  type InterviewTemplateInput,
} from "./templates";

const CATEGORY_IDS = INTERVIEW_CATEGORIES.map((c) => c.id).join(", ");

export type GuidedTurn = { role: "assistant" | "user"; content: string };

export type GuidedStepResult =
  | { kind: "question"; question: string }
  | { kind: "draft"; draft: InterviewTemplateInput };

const TEMPLATE_JSON_SHAPE = `{
  "title": "<short name>",
  "category": "<one of: ${CATEGORY_IDS}>",
  "roleLevel": "<role being hired for>",
  "focusAreas": ["<topic>", "..."],
  "difficulty": "easy" | "medium" | "hard",
  "voice": "nova" | "echo" | "onyx",
  "notes": "<tone / notes for the AI interviewer>",
  "customQuestions": ["<prepared question 1>", "..."],
  "customQuestionCategories": ["<one of behavioral|technical|coding|system_design PER question, same order & length as customQuestions>"]
}`;

/**
 * Categorization rules so questions land in the right answer workbench.
 * Reused across prompts. The architectural-DECISIONS example is deliberate —
 * it's a behavioral story, not a system-design exercise.
 */
const CATEGORY_RULES =
  `Categorize EACH question in customQuestionCategories (same order/length):\n` +
  `- "behavioral": stories / judgment / "tell me about a time", leadership, teamwork, ` +
  `conflict, prioritization, decisions (e.g. "How have you handled architectural DECISIONS ` +
  `in a fast-paced environment?" is BEHAVIORAL; it asks about your experience, not to design a system).\n` +
  `- "technical": conceptual knowledge Q&A (explain X, trade-offs, how does Y work).\n` +
  `- "coding": write/implement an algorithm or function.\n` +
  `- "system_design": design/architect a system or component ("Design a URL shortener").`;

function clampDifficulty(d: unknown): InterviewDifficulty {
  return d === "easy" || d === "medium" || d === "hard" ? d : "medium";
}

/** Normalize a raw LLM object into a saveable InterviewTemplateInput. */
export function normalizeGeneratedDraft(
  raw: Partial<InterviewTemplateInput> & Record<string, unknown>
): InterviewTemplateInput {
  const base = blankInterviewTemplate();
  const category = normalizeInterviewCategory(
    typeof raw.category === "string" ? raw.category : base.category
  );
  const focusAreas = Array.isArray(raw.focusAreas)
    ? raw.focusAreas.map((a) => String(a).trim()).filter(Boolean)
    : [];
  const customQuestions = Array.isArray(raw.customQuestions)
    ? raw.customQuestions
        .map((q) => String(q).trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];

  // Per-question categories (aligned to customQuestions). Default any missing
  // to "behavioral" so mixed interviews never force a canvas/coding workbench.
  const rawCats = Array.isArray((raw as any).customQuestionCategories)
    ? ((raw as any).customQuestionCategories as unknown[])
    : [];
  const customQuestionCategories = customQuestions.map((_, i) =>
    normalizeQuestionCategory(rawCats[i])
  );

  // Template answerMode = fallback for AI-generated (beyond prepared) questions.
  // If every prepared question is one type use it; otherwise stay "spoken" —
  // the practice picks the workbench per question from the categories.
  const hasCats = customQuestionCategories.length > 0;
  const answerMode =
    hasCats && customQuestionCategories.every((c) => c === "coding")
      ? "coding"
      : hasCats && customQuestionCategories.every((c) => c === "system_design")
        ? "system_design"
        : hasCats
          ? "spoken"
          : focusAreas.some((a) => /system[_\s-]?design/i.test(a))
            ? "system_design"
            : focusAreas.some((a) => /coding/i.test(a))
              ? "coding"
              : "spoken";

  return {
    title: String(raw.title || "").trim() || "Untitled practice",
    mode: "job_interview",
    category,
    roleLevel: String(raw.roleLevel || "").trim() || "General role",
    focusAreas,
    difficulty: clampDifficulty(raw.difficulty),
    voice: normalizeInterviewVoice(
      typeof raw.voice === "string" ? raw.voice : "nova"
    ),
    notes: String(raw.notes || "").trim(),
    productContext: "",
    customQuestions,
    customQuestionCategories,
    answerMode,
  };
}

/**
 * One-shot: turn a free-form description into a practice draft.
 */
export async function generateInterviewDraftFromDescription(params: {
  config: LlmConfig;
  description: string;
}): Promise<InterviewTemplateInput> {
  const systemPrompt =
    `You design practice sessions for Interview Practice Mode, where the AI ` +
    `interviews the user for a role.\n` +
    `Return ONLY a JSON object (no markdown fences) with this shape:\n${TEMPLATE_JSON_SHAPE}\n` +
    `Rules: be specific; invent realistic customQuestions (4–8) the practice should cover.` +
    `\n${CATEGORY_RULES}`;

  const raw = await runLLM(
    params.config,
    systemPrompt,
    `Build a practice type from this description:\n\n${params.description.trim()}`
  );

  const parsed = parseJsonFromLLM<Record<string, unknown>>(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI didn’t return a usable practice draft. Try again.");
  }
  return normalizeGeneratedDraft(parsed);
}

/**
 * Guided flow: given prior Q&A, either ask the next clarifying question or
 * return a finished draft.
 */
export async function continueGuidedInterviewDraft(params: {
  config: LlmConfig;
  history: GuidedTurn[];
}): Promise<GuidedStepResult> {
  const systemPrompt =
    `You are a coach helping the user design ONE job interview practice session ` +
    `(the AI interviews the user for a role).\n` +
    `Ask ONE short clarifying question at a time until you have enough to build a strong draft ` +
    `(title, role, focus areas, difficulty, ~5–8 practice questions, notes).\n` +
    `When ready, stop asking and return the draft.\n\n` +
    `Return ONLY JSON in ONE of these shapes:\n` +
    `{"status":"ask","question":"<your next short question>"}\n` +
    `OR\n` +
    `{"status":"done","template": ${TEMPLATE_JSON_SHAPE}}\n` +
    `No markdown fences. After ~5–8 answered questions, prefer status "done".`;

  const transcript = params.history
    .map((t) => `${t.role === "assistant" ? "Coach" : "User"}: ${t.content}`)
    .join("\n");

  const userMessage =
    params.history.length === 0
      ? "Start the guided setup. Ask your first question."
      : `Conversation so far:\n${transcript}\n\nContinue. Ask the next question OR return the finished template.`;

  const raw = await runLLM(params.config, systemPrompt, userMessage);
  const parsed = parseJsonFromLLM<{
    status?: string;
    question?: string;
    template?: Record<string, unknown>;
  }>(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI response was unclear. Try answering again.");
  }

  if (parsed.status === "done" && parsed.template) {
    return {
      kind: "draft",
      draft: normalizeGeneratedDraft(parsed.template),
    };
  }

  const question = String(parsed.question || "").trim();
  if (!question) {
    throw new Error("AI didn’t ask a next question. Try again.");
  }
  return { kind: "question", question };
}

function assertWebResearchAvailable(): void {
  if (isManagedModeEnabled()) return;
  if (!getFirecrawlApiKey()) {
    throw new Error(
      "Web research needs Firecrawl. Add a key in Settings › Memory, or use managed mode."
    );
  }
}

function formatSearchBlock(
  label: string,
  results: Awaited<ReturnType<typeof firecrawlSearch>>
): string {
  if (!results.length) return `${label}:\n(no results)\n`;
  return (
    `${label}:\n` +
    results
      .map((r, i) => {
        const body = (r.markdown || r.description || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1200);
        return `[${i + 1}] ${r.title} (${r.url})\n${body}`;
      })
      .join("\n\n") +
    "\n"
  );
}

export interface JobPostingResearchInput {
  jobDescription: string;
  /** Optional job-posting URL — scraped with Firecrawl to fetch the JD. */
  jobUrl?: string;
  companyProfile?: string;
  companyName?: string;
  roleHint?: string;
  /** Seniority, e.g. "Junior", "Senior", "Staff / Principal". */
  seniority?: string;
  /** Interview stage / focus, e.g. "System design", "Behavioral", "Full loop". */
  stageFocus?: string;
  /** How many practice questions to prepare (default 8). */
  questionCount?: number;
}

export interface JobPostingResearchResult {
  draft: InterviewTemplateInput;
  /** Short status lines about what was researched (for UI). */
  researchNotes: string[];
  /** Markdown briefing on the company, interview process, and question themes. */
  researchBrief: string;
}

/**
 * Build a job-interview practice draft from a pasted JD + company info,
 * researching the company and common interview questions via Firecrawl
 * (Blind, Glassdoor, Levels, Teamblind, etc.).
 */
export async function generateInterviewDraftFromJobPosting(params: {
  config: LlmConfig;
  input: JobPostingResearchInput;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<JobPostingResearchResult> {
  assertWebResearchAvailable();
  const throwIfAborted = () => {
    if (params.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };

  const researchNotes: string[] = [];

  // 1) Fetch the job description — from a URL (Firecrawl scrape) and/or paste.
  let jd = params.input.jobDescription.trim();
  const jobUrl = (params.input.jobUrl || "").trim();
  if (jobUrl) {
    params.onProgress?.("Reading the job posting…");
    const scraped = await firecrawlScrape(jobUrl);
    if (scraped.trim()) {
      jd = [jd, scraped.trim()].filter(Boolean).join("\n\n").slice(0, 12000);
      researchNotes.push("Job posting: fetched from the URL");
    } else {
      researchNotes.push("Job posting: couldn’t fetch the URL, using other info");
    }
  }
  if (jd.length < 40 && !params.input.companyName?.trim()) {
    throw new Error(
      "Add a job posting URL, paste the description, or at least a company + role so research has something to work with."
    );
  }

  const company =
    params.input.companyName?.trim() ||
    extractCompanyGuess(jd, params.input.companyProfile) ||
    "";
  const seniority = (params.input.seniority || "").trim();
  const baseRole =
    params.input.roleHint?.trim() || extractRoleGuess(jd) || "the role";
  const role = seniority ? `${seniority} ${baseRole}`.trim() : baseRole;
  const stage = (params.input.stageFocus || "").trim();
  const questionCount = Math.min(
    16,
    Math.max(4, params.input.questionCount || 8)
  );

  // 2) Research: company snapshot, interview process, and real questions.
  throwIfAborted();
  params.onProgress?.("Researching the company & interview process…");

  const companyQuery = company
    ? `${company} company overview products culture funding interview process`
    : `${jd.slice(0, 120)} company about`;
  const processQuery = company
    ? `${company} ${baseRole} interview process stages loop what to expect experience`
    : `${baseRole} interview process stages what to expect`;
  const questionQueries = [
    company
      ? `${company} ${role} interview questions site:teamblind.com OR site:glassdoor.com OR site:levels.fyi`
      : `${role} interview questions site:teamblind.com OR site:glassdoor.com`,
    company
      ? `${company} ${role} interview questions ${stage || "behavioral system design coding"}`
      : `${role} interview questions ${stage || "behavioral system design"}`,
    `${role} interview questions what to expect`,
  ];

  const [companyResults, processResults, ...questionBatches] =
    await Promise.all([
      firecrawlSearch(companyQuery, 5),
      firecrawlSearch(processQuery, 4),
      ...questionQueries.map((q) => firecrawlSearch(q, 4)),
    ]);

  researchNotes.push(
    companyResults.length
      ? `Company research: ${companyResults.length} sources`
      : "Company research: limited public results"
  );
  researchNotes.push(
    processResults.length
      ? `Interview process: ${processResults.length} sources`
      : "Interview process: limited results"
  );

  const questionResults = dedupeResults(questionBatches.flat());
  researchNotes.push(
    questionResults.length
      ? `Question research: ${questionResults.length} sources (Blind / Glassdoor / web)`
      : "Question research: limited results, drafting from the JD"
  );

  // Collect source links for the brief.
  const sources = dedupeResults([
    ...companyResults,
    ...processResults,
    ...questionResults,
  ])
    .slice(0, 8)
    .map((r) => `- [${r.title}](${r.url})`)
    .join("\n");

  params.onProgress?.("Building your research brief & questions…");

  const jsonShapeWithBrief = TEMPLATE_JSON_SHAPE.replace(
    /\}\s*$/,
    `,\n  "researchBrief": "<GitHub-flavored Markdown briefing with these sections: **Company snapshot**, **Interview process & stages**, **What they look for**, **Common questions & themes**. Be concrete and grounded in the research.>"\n}`
  );

  const systemPrompt =
    `You design a job interview practice session AND a research brief for Interview Practice Mode.\n` +
    `mode MUST be "job_interview".\n` +
    `Primary source of truth for the role is the JOB DESCRIPTION.\n` +
    `Use COMPANY + PROCESS research to write an accurate briefing and to personalize notes.\n` +
    `Use QUESTION research (Blind, Glassdoor, Levels, forums, blogs) to craft realistic ` +
    `customQuestions this company/role is known to ask. Adapt wording; never copy paywalled text verbatim.\n` +
    (seniority ? `Target seniority: ${seniority}.\n` : "") +
    (stage ? `Emphasize this interview stage/focus: ${stage}.\n` : "") +
    `If research is thin, still produce strong role-appropriate questions from the JD.\n` +
    `Return ONLY a JSON object (no markdown fences) with this shape:\n${jsonShapeWithBrief}\n` +
    `title should look like "<Role> at <Company>" when company is known.\n` +
    `notes should include a short company briefing the interviewer can use.\n` +
    `customQuestions: exactly ${questionCount} high-signal questions. productContext: "".\n` +
    CATEGORY_RULES;

  const userMessage =
    `COMPANY NAME (if known): ${company || "(unknown)"}\n` +
    `ROLE: ${role}\n` +
    (seniority ? `SENIORITY: ${seniority}\n` : "") +
    (stage ? `STAGE / FOCUS: ${stage}\n` : "") +
    `\nJOB DESCRIPTION:\n"""\n${jd.slice(0, 8000)}\n"""\n\n` +
    (params.input.companyProfile?.trim()
      ? `COMPANY PROFILE (user-provided):\n"""\n${params.input.companyProfile
          .trim()
          .slice(0, 4000)}\n"""\n\n`
      : "") +
    formatSearchBlock("COMPANY WEB RESEARCH", companyResults) +
    "\n" +
    formatSearchBlock("INTERVIEW PROCESS RESEARCH", processResults) +
    "\n" +
    formatSearchBlock(
      "INTERVIEW QUESTION RESEARCH (Blind / Glassdoor / web)",
      questionResults
    ) +
    `\nBuild the practice template + research brief JSON now.`;

  throwIfAborted();
  const raw = await runLLM(params.config, systemPrompt, userMessage, {
    signal: params.signal,
  });
  const parsed = parseJsonFromLLM<Record<string, unknown>>(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI didn’t return a usable practice draft. Try again.");
  }

  const draft = normalizeGeneratedDraft({
    ...parsed,
    mode: "job_interview",
    productContext: "",
  });

  let researchBrief = String((parsed as any).researchBrief || "").trim();
  if (researchBrief && sources) {
    researchBrief += `\n\n**Sources**\n${sources}`;
  }

  return { draft, researchNotes, researchBrief };
}

function dedupeResults(
  results: Awaited<ReturnType<typeof firecrawlSearch>>
): Awaited<ReturnType<typeof firecrawlSearch>> {
  const seen = new Set<string>();
  const out: typeof results = [];
  for (const r of results) {
    const key = (r.url || r.title).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= 10) break;
  }
  return out;
}

function extractCompanyGuess(jd: string, profile?: string): string {
  const fromProfile = profile?.match(
    /(?:^|\n)\s*(?:company|about)\s*[:\-]\s*(.+)/i
  );
  if (fromProfile?.[1]) return fromProfile[1].split(/[.\n]/)[0]!.trim().slice(0, 80);

  const atMatch = jd.match(
    /(?:at|@|join(?:ing)?)\s+([A-Z][A-Za-z0-9&.\- ]{1,40})/
  );
  if (atMatch?.[1]) return atMatch[1].trim();

  const companyLine = jd.match(
    /(?:^|\n)\s*([A-Z][A-Za-z0-9&.\- ]{1,40})\s+(?:is hiring|is looking)/i
  );
  return companyLine?.[1]?.trim() ?? "";
}

function extractRoleGuess(jd: string): string {
  const titleLine = jd.match(
    /(?:job title|title|role|position)\s*[:\-]\s*(.+)/i
  );
  if (titleLine?.[1]) return titleLine[1].split(/[.\n|]/)[0]!.trim().slice(0, 80);

  const firstLine = jd.split("\n").map((l) => l.trim()).find((l) => l.length > 3);
  if (firstLine && firstLine.length < 80) return firstLine;
  return "";
}
