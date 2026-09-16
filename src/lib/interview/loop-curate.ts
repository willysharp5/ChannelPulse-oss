/**
 * Turns a loop stage into a runnable `InterviewTemplate` — i.e. picks the
 * questions for the round.
 *
 * ONE POOL, IN ORDER. Each round has a pool of questions: the stage's own
 * curated `seedQuestions` first, then real reported ones from the question bank.
 * We take the next few you haven't been asked yet, top to bottom. When the pool
 * runs out the cycle starts over. That's it — no shuffling, no fallback layers,
 * and no way to be handed the same question twice before you've seen the rest.
 *
 * Progress is tracked per GROUP rather than per loop (see `question-cycle.ts`),
 * so retaking a round or starting a second loop for the same role continues down
 * the pool instead of drawing at random.
 *
 * Two things still filter the pool:
 *   • Questions already asked earlier in the SAME run, so two rounds with
 *     overlapping pools can't repeat inside one sitting.
 *   • A round that declares an editor (`stage.codingLanguage`) only takes bank
 *     questions that belong in it — the bank has no SQL category, so the SQL
 *     round asks it for "coding" and would otherwise get algorithm questions.
 *
 * The bank is best-effort: it's `to authenticated` behind RLS, so a signed-out
 * user reads zero rows, and it's thin for finance and executive roles. The seeds
 * always cover the round on their own, so a bank failure costs variety, never a
 * question. Only if BOTH come back empty does the round go out with no prepared
 * questions and the interviewer generates it from the focus areas and notes.
 */

import { blankInterviewTemplate, type InterviewTemplate } from "./templates";
import { queryQuestions, type BankQuestion } from "./question-bank";
import { formatBankQuestion } from "./format-bank-text";
import { defaultCodingLanguage } from "./coding-runtime";
import type { LoopBlueprint, LoopStage } from "./loops";
import { normalizeQuestion, type InterviewLoopRun } from "./loop-runs";
import { drawFromGroup, questionGroupKey } from "./question-cycle";

/** How much of the bank to pull into a round's pool. */
const BANK_POOL_SIZE = 40;

/** Map a role label onto the bank's seniority buckets (SENIORITY_PATTERNS). */
export function seniorityForRole(roleLevel: string): string | undefined {
  const r = roleLevel.toLowerCase();
  if (/intern/.test(r)) return "intern";
  if (/new grad|graduate|entry/.test(r)) return "new_grad";
  if (/junior|associate/.test(r)) return "junior";
  if (/manager|director|head of|\bvp\b|chief|cto|cfo/.test(r)) return "manager";
  if (/staff|principal|lead/.test(r)) return "staff";
  if (/senior|\bsr\b/.test(r)) return "senior";
  return undefined;
}

/** One question in a round's pool, with where it came from. */
interface PoolEntry {
  text: string;
  modelAnswer: string;
  category: string;
  /** Set only for bank questions — drives the "bank coverage" stats. */
  bankId?: string;
}

export interface CuratedStage {
  template: InterviewTemplate;
  /** The question text as it will be asked, for the run's no-repeat list. */
  questions: string[];
  /** How many came from the bank — surfaced in the UI as provenance. */
  fromBank: number;
  /** How many came from the stage's own curated pool. */
  fromSeeds: number;
  /** The pool's identity, for progress readouts and a manual reset. */
  group: string;
  /** True when this round used up the pool and started the cycle over. */
  wrapped: boolean;
}

/**
 * Build the template for one stage of a run. Async because the pool includes the
 * bank; it degrades to the stage's own questions without throwing when that
 * fails.
 */
export async function curateLoopStage(params: {
  blueprint: LoopBlueprint;
  stage: LoopStage;
  run: InterviewLoopRun;
}): Promise<CuratedStage> {
  const { blueprint, stage, run } = params;
  const roleLevel = run.roleLevel || blueprint.roleLevel;

  // ── The pool ──────────────────────────────────────────────────────────────
  // The stage's own questions come first: they're written for this round, in the
  // order the author wanted them, and for the SQL round they're the ones the
  // sample database actually has data for. The bank extends the pool once you've
  // worked through them.
  const seedCategory = stage.bankCategories[0] ?? "behavioral";
  const pool: PoolEntry[] = stage.seedQuestions.map((text) => ({
    text,
    modelAnswer: "",
    category: seedCategory,
  }));

  // A round that declares its editor only takes bank questions that belong in
  // it. A linked-list problem is a real question; it just isn't a SQL question.
  const fitsEditor = (text: string): boolean =>
    !stage.codingLanguage || defaultCodingLanguage(text) === stage.codingLanguage;

  for (const q of await fetchBankQuestions({ stage, roleLevel, run })) {
    const text = formatBankQuestion(q.question);
    if (!fitsEditor(text)) continue;
    pool.push({
      text,
      modelAnswer: q.model_answer || "",
      category: q.category,
      bankId: q.id,
    });
  }

  // ── The pick ──────────────────────────────────────────────────────────────
  const group = questionGroupKey({
    kind: stage.kind,
    difficulty: stage.difficulty,
    roleLevel,
    companyId: run.companyId,
  });
  const draw = drawFromGroup({
    group,
    pool: pool.map((p) => p.text),
    count: stage.questionCount,
    // Asked earlier in this same loop — skip it, but it stays "done" for the
    // group either way, so this can't stall the cycle.
    blocked: (run.askedQuestions ?? []).map(normalizeQuestion),
  });

  const byText = new Map(pool.map((p) => [p.text, p]));
  const picked: PoolEntry[] = draw.questions.map(
    (text) =>
      byText.get(text) ?? { text, modelAnswer: "", category: seedCategory }
  );
  const fromBank = picked.filter((p) => p.bankId).length;
  const fromSeeds = picked.length - fromBank;

  const base = blankInterviewTemplate();
  const template: InterviewTemplate = {
    ...base,
    // Stable id so `persistPracticeSession` and result rows key consistently.
    id: `loop_${run.id}_${stage.id}`,
    title: `${blueprint.title} · ${stage.title}`,
    category: blueprint.category,
    roleLevel: run.roleLevel || blueprint.roleLevel,
    focusAreas: stage.focusAreas,
    difficulty: stage.difficulty,
    notes: buildStageNotes({ blueprint, stage, run }),
    customQuestions: picked.map((p) => p.text),
    customModelAnswers: picked.map((p) => p.modelAnswer),
    customQuestionCategories: picked.map((p) => p.category),
    // Only when every question came from the bank: these ids are aligned 1:1
    // and get flatMapped into "bank coverage" stats, so a placeholder for a
    // seed question would count as a bank question that doesn't exist.
    bankQuestionIds: picked.every((p) => p.bankId)
      ? picked.map((p) => p.bankId as string)
      : undefined,
    answerMode: stage.answerMode,
    // The round's editor, when it has one by definition. Also covers the case
    // where curation comes back empty and the interviewer invents the questions
    // — those never went through `defaultCodingLanguage` at all.
    codingLanguage: stage.codingLanguage,
    builtIn: false,
  };

  return {
    template,
    questions: picked.map((p) => p.text),
    fromBank,
    fromSeeds,
    group,
    wrapped: draw.wrapped,
  };
}

/**
 * Real reported questions for this round, newest first. One query, and an empty
 * result is fine — the stage's own questions already cover the round.
 */
async function fetchBankQuestions(params: {
  stage: LoopStage;
  roleLevel: string;
  run: InterviewLoopRun;
}): Promise<BankQuestion[]> {
  const { stage, roleLevel, run } = params;
  try {
    const res = await queryQuestions(
      {
        categories: stage.bankCategories,
        difficulties: [stage.difficulty],
        seniority: seniorityForRole(roleLevel),
        companyId: run.companyId,
      },
      { limit: BANK_POOL_SIZE }
    );
    return res.rows;
  } catch {
    return [];
  }
}

/**
 * The interviewer's brief for the round. This is what makes stage 3 feel
 * different from stage 5 even when both are spoken Q&A: persona, what to probe,
 * where it sits in the loop, and the clock.
 */
function buildStageNotes(params: {
  blueprint: LoopBlueprint;
  stage: LoopStage;
  run: InterviewLoopRun;
}): string {
  const { blueprint, stage, run } = params;
  const index = run.stages.findIndex((s) => s.stageId === stage.id);
  const position =
    index >= 0
      ? `This is round ${index + 1} of ${run.stages.length} in the loop.`
      : "";
  const company = run.companyName ? ` at ${run.companyName}` : "";
  return [
    `You are conducting the "${stage.title}" round of a real interview loop for a ${blueprint.title} role${company} (${blueprint.level}).`,
    position,
    `Time in the room: ${stage.minutes} minutes. What you are scoring: ${stage.signal}.`,
    stage.interviewerNotes,
    "Stay in character for this round only; do not cover the other rounds' material. Keep your questions and follow-ups tight enough to finish inside the slot.",
  ]
    .filter(Boolean)
    .join(" ");
}
