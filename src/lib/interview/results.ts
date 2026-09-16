import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage";
import { setSyncedItem } from "@/lib/sync/kv";
import type { InterviewAssessment, InterviewTurn } from "./session";

/** A completed practice session's saved result, shown in the Results tab. */
export interface SavedInterviewResult {
  id: string;
  templateId: string;
  templateTitle: string;
  createdAt: number;
  assessment: InterviewAssessment;
  turns: InterviewTurn[];
  /**
   * Optional bank question ids aligned 1:1 with `turns` when the session was
   * started from the company/role question bank (for progress tracking).
   */
  bankQuestionIds?: string[];
}

const MAX_RESULTS = 100;

function makeId(): string {
  return `result_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function listInterviewResults(): SavedInterviewResult[] {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.INTERVIEW_RESULTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedInterviewResult[]).sort(
      (a, b) => b.createdAt - a.createdAt
    );
  } catch {
    return [];
  }
}

/** Persist a completed result (newest first, capped). Returns the saved row. */
export function saveInterviewResult(input: {
  templateId: string;
  templateTitle: string;
  assessment: InterviewAssessment;
  turns: InterviewTurn[];
  bankQuestionIds?: string[];
}): SavedInterviewResult {
  const result: SavedInterviewResult = {
    id: makeId(),
    templateId: input.templateId,
    templateTitle: input.templateTitle,
    createdAt: Date.now(),
    assessment: input.assessment,
    turns: input.turns,
    bankQuestionIds: input.bankQuestionIds,
  };
  try {
    const all = listInterviewResults();
    const next = [result, ...all].slice(0, MAX_RESULTS);
    // Synced across devices + the web app (see src/lib/sync/kv.ts).
    setSyncedItem(STORAGE_KEYS.INTERVIEW_RESULTS, JSON.stringify(next));
  } catch {
    // best-effort
  }
  return result;
}

export function deleteInterviewResult(id: string): void {
  deleteInterviewResults([id]);
}

/** Delete multiple saved results in one pass. */
export function deleteInterviewResults(ids: string[]): void {
  if (ids.length === 0) return;
  try {
    const remove = new Set(ids);
    const next = listInterviewResults().filter((r) => !remove.has(r.id));
    // Synced across devices + the web app (see src/lib/sync/kv.ts).
    setSyncedItem(STORAGE_KEYS.INTERVIEW_RESULTS, JSON.stringify(next));
  } catch {
    // best-effort
  }
}
