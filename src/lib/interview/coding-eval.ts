import { parseJsonFromLLM, runLLM, type LlmConfig } from "@/lib/llm";
import type { CodeRunResult, CodingLanguage } from "./coding-runtime";
import { referenceBlock } from "./references";
import { SQL_SCHEMA_BRIEF } from "./sql-fixtures";

/**
 * What a SQL screen is actually about. Without this the model treats a query
 * like JavaScript — "add error handling", "extract a helper" — and misses the
 * things that get people rejected: wrong grain, NULL semantics, and ties.
 */
const SQL_LENS =
  `This is a SQL round, so judge it like a data interviewer, not a code reviewer:\n` +
  `- GRAIN: does one output row mean what the question asked for (per user? per user-day?), ` +
  `and does a JOIN fan the rows out and inflate the aggregates?\n` +
  `- NULLs: NULL amounts drop out of SUM/AVG and never match =; COUNT(col) skips them but COUNT(*) doesn't; ` +
  `an outer join's unmatched rows need COALESCE, and a filter in WHERE (rather than ON) silently turns a LEFT JOIN into an INNER one.\n` +
  `- TIES and ordering: RANK vs DENSE_RANK vs ROW_NUMBER is a real decision for "top N per group": ` +
  `say what happens on a tie. LIMIT without a deterministic ORDER BY is a bug.\n` +
  `- Time windows: half-open ranges (>= start AND < end), inclusive BETWEEN on timestamps missing the last day, ` +
  `and gaps; days with no rows only appear if the query generates a calendar and LEFT JOINs to it.\n` +
  `- Dedup: with at-least-once delivery, state the key and use DISTINCT / a window function over it rather than hoping.\n` +
  `- GROUP BY correctness, integer division, and rounding only at the end.\n` +
  `- Cost, briefly: what this scans, and whether a window function replaces a self-join or correlated subquery.\n` +
  `Do NOT ask for JavaScript-style refactors, error handling, or unit tests. ` +
  `Readability feedback should be about CTEs and naming.\n` +
  `The candidate writes against this sample SQLite database:\n${SQL_SCHEMA_BRIEF}\n` +
  `Empty output is usually a bug in the filter or the join, not an empty database.\n`;

export interface CodingVerdict {
  /** True when the solution would pass a typical interviewer bar for this problem. */
  passed: boolean;
  /** 1–5 quality score. */
  score: number;
  /** Short overall judgment. */
  feedback: string;
  strengths: string[];
  improvements: string[];
  /**
   * Progressive hints, ordered from a gentle nudge to a concrete step.
   * These guide the candidate to fix their OWN code and never contain the
   * full solution (that lives in modelAnswer).
   */
  hints: string[];
  /**
   * Optional mermaid diagram (flowchart) illustrating each hint, aligned by
   * index with `hints` (empty string when a diagram wouldn't help). Used by
   * the system-design workbench to visualize hints. Coding leaves this empty.
   */
  hintDiagrams?: string[];
  /** What a strong solution looks like (code + brief explanation). */
  modelAnswer: string;
  /**
   * True when this object is on-demand guidance (Get hints) rather than a
   * graded pass/fail submission — the UI hides the score/verdict in that case.
   */
  tipsOnly?: boolean;
}

/**
 * Ask the AI whether the submitted code solves the interview question.
 * Uses the problem statement, source, and local run output.
 */
export async function evaluateCodingSubmission(params: {
  config: LlmConfig;
  question: string;
  code: string;
  language: CodingLanguage;
  run: CodeRunResult | null;
  /** Selects the role lens on top of the coding playbook (data science, EM…). */
  roleLevel?: string | null;
  signal?: AbortSignal;
}): Promise<CodingVerdict> {
  const { config, question, code, language, run } = params;

  const isSql = language === "sql";

  const systemPrompt =
    (isSql
      ? `You are a strict but fair data interviewer grading a SQL answer.\n`
      : `You are a strict but fair coding interviewer grading a practice solution.\n`) +
    (isSql ? SQL_LENS : "") +
    `Decide PASS or FAIL for this single question.\n` +
    (isSql
      ? `PASS means: the query answers the question at the right grain and would ` +
        `return the correct rows (minor style issues OK).\n` +
        `FAIL means: wrong grain, a join that inflates or drops rows, a filter that ` +
        `breaks an outer join, NULL or tie handling that changes the answer, an empty ` +
        `stub, or a SQL error.\n`
      : `PASS means: correct approach for the stated problem, reasonable correctness, ` +
        `and code that would work (minor style issues OK).\n` +
        `FAIL means: wrong approach, major bugs, doesn't address the problem, empty stub, ` +
        `or runtime clearly shows failure.\n`) +
    `Use the run output as evidence when present, but you may still PASS if the code is ` +
    `clearly correct and tests were incomplete.\n` +
    `Also produce PROGRESSIVE HINTS that coach the candidate to fix THEIR OWN code, ` +
    `ordered from a gentle nudge, to a more specific pointer, to a concrete step ` +
    (isSql
      ? `(e.g. "check what one row of your output means", "the LEFT JOIN filter belongs in ON"). `
      : `(e.g. "handle the empty-array case", "use a hash map keyed by value"). `) +
    `Hints must NOT contain the full solution or a full code block; that belongs only in modelAnswer. ` +
    `Give 2-4 hints even when the solution passes (edge cases, complexity, style).\n` +
    `Return ONLY JSON (no markdown fences) with this shape:\n` +
    `{\n` +
    `  "passed": <boolean>,\n` +
    `  "score": <1-5>,\n` +
    `  "feedback": "<2-4 sentences>",\n` +
    `  "strengths": ["..."],\n` +
    `  "improvements": ["..."],\n` +
    `  "hints": ["<gentle nudge>", "<more specific>", "<concrete step, still no full code>"],\n` +
    (isSql
      ? `  "modelAnswer": "<markdown: brief explanation + a correct query in a fenced \`\`\`sql code block. It must be valid SQLite against the sample schema above (no invented tables or columns, no vendor-only syntax), with comments on the grain and any NULL/tie decision, then **Cost:** what it scans>"\n`
      : `  "modelAnswer": "<markdown: brief explanation + a correct solution in a fenced \`\`\`${language} code block. The code MUST be valid ${language} (NOT bash/shell, SQL, or any other language). Even if the question is phrased as a shell/CLI task, implement the equivalent logic in ${language}. Include inline comments, then **Complexity:** time/space>"\n`) +
    `}`;

  const runBlock = run
    ? `LOCAL RUN:\n` +
      `- ok: ${run.ok}\n` +
      `- timedOut: ${run.timedOut}\n` +
      `- durationMs: ${run.durationMs}\n` +
      `- stdout:\n"""\n${run.stdout.slice(0, 4000)}\n"""\n` +
      `- stderr:\n"""\n${run.stderr.slice(0, 4000)}\n"""\n`
    : `LOCAL RUN: (not run)\n`;

  const grounding = await referenceBlock({
    category: "coding",
    query: question,
    roleLevel: params.roleLevel,
    signal: params.signal,
  });

  const userMessage =
    (grounding ? `${grounding}\n\n` : "") +
    `QUESTION:\n"""\n${question.slice(0, 6000)}\n"""\n\n` +
    `LANGUAGE: ${language}\n\n` +
    `CANDIDATE CODE:\n\`\`\`${language}\n${code.slice(0, 12000)}\n\`\`\`\n\n` +
    runBlock +
    `\nGrade now.`;

  // runLLM doesn't take signal today — wrap with a race if aborted.
  const raw = await Promise.race([
    runLLM(config, systemPrompt, userMessage, {
      signal: params.signal,
      structured: true,
      maxTokens: 4096,
    }),
    new Promise<string>((_, reject) => {
      if (!params.signal) return;
      if (params.signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      params.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true }
      );
    }),
  ]);

  const parsed = parseJsonFromLLM<Partial<CodingVerdict>>(raw);
  return normalizeVerdict(parsed, raw);
}

/**
 * On-demand coaching hints for a coding problem — NO pass/fail grade.
 * Lets the candidate reveal step-by-step guidance (and a model answer) without
 * having to submit for grading first.
 */
export async function generateCodingHints(params: {
  config: LlmConfig;
  question: string;
  code?: string;
  language: CodingLanguage;
  /** Selects the role lens on top of the coding playbook (data science, EM…). */
  roleLevel?: string | null;
  signal?: AbortSignal;
}): Promise<{ hints: string[]; modelAnswer: string }> {
  const { config, question, code, language } = params;

  const isSql = language === "sql";

  const systemPrompt =
    (isSql
      ? `You are a supportive data tutor helping a candidate write a SQL answer.\n` +
        SQL_LENS
      : `You are a supportive coding tutor helping a candidate solve an interview problem.\n`) +
    `Give PROGRESSIVE HINTS (2-4), ordered from a gentle nudge to a concrete step, ` +
    `that guide them to solve it THEMSELVES. Do NOT put the full solution in the hints.\n` +
    (isSql
      ? `Also provide a modelAnswer (a brief explanation + a correct SQLite query in a ` +
        `fenced \`\`\`sql block, using only the sample schema above) for when they choose ` +
        `to reveal it.\n`
      : `Also provide a modelAnswer (a brief explanation + a correct ${language} solution ` +
        `in a fenced code block) for when they choose to reveal it.\n`) +
    `Return ONLY JSON (no markdown fences): {"hints":["..."],"modelAnswer":"..."}`;

  const grounding = await referenceBlock({
    category: "coding",
    query: question,
    roleLevel: params.roleLevel,
    signal: params.signal,
  });

  const userMessage =
    (grounding ? `${grounding}\n\n` : "") +
    `QUESTION:\n"""\n${question.slice(0, 6000)}\n"""\n` +
    (code && code.trim()
      ? `\nCANDIDATE'S CURRENT CODE (may be incomplete):\n\`\`\`${language}\n${code.slice(0, 8000)}\n\`\`\`\n`
      : ``) +
    `\nGive the hints now.`;

  const raw = await Promise.race([
    runLLM(config, systemPrompt, userMessage, {
      signal: params.signal,
      structured: true,
      maxTokens: 4096,
    }),
    new Promise<string>((_, reject) => {
      if (!params.signal) return;
      if (params.signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      params.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true }
      );
    }),
  ]);

  const parsed = parseJsonFromLLM<{ hints?: unknown; modelAnswer?: unknown }>(
    raw
  );
  return {
    hints: asStringArray(parsed?.hints),
    modelAnswer: String(parsed?.modelAnswer || "").trim(),
  };
}

function normalizeVerdict(
  raw: Partial<CodingVerdict> | null,
  fallbackText: string
): CodingVerdict {
  const scoreRaw = Number(raw?.score);
  const score = Number.isFinite(scoreRaw)
    ? Math.min(5, Math.max(1, Math.round(scoreRaw)))
    : 3;
  const passed =
    typeof raw?.passed === "boolean" ? raw.passed : score >= 4;
  const improvements = asStringArray(raw?.improvements);
  const hints = asStringArray(raw?.hints);
  const feedbackRaw = String(raw?.feedback || "").trim();
  const feedback =
    feedbackRaw && !looksLikeJsonBlob(feedbackRaw)
      ? feedbackRaw
      : looksLikeJsonBlob(fallbackText)
        ? "Couldn’t fully parse the grade (response was cut off). Try checking again."
        : fallbackText.trim().slice(0, 400) ||
          "Could not parse a full grade. Review the code and try again.";
  return {
    passed,
    score,
    feedback,
    strengths: asStringArray(raw?.strengths),
    improvements,
    // Fall back to improvements so there's always something to reveal step-by-step.
    hints: hints.length ? hints : improvements,
    modelAnswer: String(raw?.modelAnswer || "").trim(),
  };
}

function looksLikeJsonBlob(s: string): boolean {
  const t = s.trim();
  return (
    (t.startsWith("{") || t.startsWith("```")) &&
    /"passed"\s*:|"score"\s*:|"feedback"\s*:/.test(t)
  );
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}
