import { formatBankQuestion } from "./format-bank-text";
import { listInterviewResults, type SavedInterviewResult } from "./results";
import type { BankQuestion } from "./question-bank";

/** Progress for a bank question the user has already practiced & assessed. */
export interface PracticedQuestionInfo {
  /** Last time this question appeared in a saved assessment. */
  lastPracticedAt: number;
  /** Best score seen (1–5), when available. */
  score?: number;
  /** How many saved sessions included this question. */
  times: number;
}

/** Normalize question text so bank rows match saved practice turns. */
export function normalizePracticeQuestionKey(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>~]+/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[^\p{L}\p{N}\s.?!,;:'"/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function textKey(raw: string): string {
  return `text:${normalizePracticeQuestionKey(raw)}`;
}

function idKey(id: string): string {
  return `id:${id}`;
}

function upsert(
  map: Map<string, PracticedQuestionInfo>,
  key: string,
  at: number,
  score?: number
) {
  if (!key || key.endsWith(":")) return;
  const prev = map.get(key);
  if (!prev) {
    map.set(key, {
      lastPracticedAt: at,
      score: score != null && Number.isFinite(score) ? score : undefined,
      times: 1,
    });
    return;
  }
  const nextScore =
    score != null && Number.isFinite(score)
      ? prev.score != null
        ? Math.max(prev.score, score)
        : score
      : prev.score;
  map.set(key, {
    lastPracticedAt: Math.max(prev.lastPracticedAt, at),
    score: nextScore,
    times: prev.times + 1,
  });
}

/**
 * Build a lookup of practiced bank questions from saved assessment results.
 * Keys are `id:<bankId>` (preferred) and `text:<normalized>` (legacy / fallback).
 */
export function buildPracticedQuestionIndex(
  results: SavedInterviewResult[] = listInterviewResults()
): Map<string, PracticedQuestionInfo> {
  const map = new Map<string, PracticedQuestionInfo>();

  for (const result of results) {
    const ids = result.bankQuestionIds ?? [];
    const turns = result.turns ?? [];
    const assessed = result.assessment?.questions ?? [];

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const answer = (turn.answer || "").trim();
      if (!answer || answer === "(skipped)") continue;

      const score =
        turn.coding?.verdict?.score ??
        turn.design?.verdict?.score ??
        assessed[i]?.score;

      const bankId = ids[i];
      if (bankId) upsert(map, idKey(bankId), result.createdAt, score);

      if (turn.question) {
        upsert(map, textKey(turn.question), result.createdAt, score);
        // Also index the formatted form used when starting from the bank.
        upsert(
          map,
          textKey(formatBankQuestion(turn.question)),
          result.createdAt,
          score
        );
      }
    }

    // Assessment rows can still match when turn text drifted slightly.
    for (const qa of assessed) {
      if (!qa?.question) continue;
      upsert(map, textKey(qa.question), result.createdAt, qa.score);
      upsert(
        map,
        textKey(formatBankQuestion(qa.question)),
        result.createdAt,
        qa.score
      );
    }
  }

  return map;
}

/** Look up practice progress for a bank question. */
export function getPracticedQuestionInfo(
  question: Pick<BankQuestion, "id" | "question">,
  index: Map<string, PracticedQuestionInfo> = buildPracticedQuestionIndex()
): PracticedQuestionInfo | undefined {
  return (
    index.get(idKey(question.id)) ??
    index.get(textKey(formatBankQuestion(question.question))) ??
    index.get(textKey(question.question))
  );
}

/** True when this bank question has been answered in a saved assessment. */
export function isBankQuestionPracticed(
  question: Pick<BankQuestion, "id" | "question">,
  index?: Map<string, PracticedQuestionInfo>
): boolean {
  return !!getPracticedQuestionInfo(question, index);
}
