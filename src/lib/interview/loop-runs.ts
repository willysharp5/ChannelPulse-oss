/**
 * Persisted state for a full interview loop in progress.
 *
 * The rules this module enforces, because they're what makes the simulation
 * honest:
 *
 *   • BETWEEN stages you can stop for as long as you like. A run just sits in
 *     localStorage; come back tomorrow and the next stage is waiting.
 *   • INSIDE a stage there is no pause. `startStage` stamps `endsAt` as a
 *     wall-clock time, so quitting the app, reloading, or walking away does not
 *     stop the clock. Reopening a stage whose time ran out marks it
 *     `cancelled` with reason `"time"` — exactly what happens if you no-show
 *     the back half of a real 45-minute round.
 *   • Your only escape hatch mid-stage is to CANCEL it. Cancelling costs you
 *     the round: it counts as no signal in the final debrief. `resetStage`
 *     exists so a cancelled round can be retaken, and it is explicit — the user
 *     has to ask for it, it is never automatic.
 *
 * Everything is best-effort against localStorage (same posture as
 * `results.ts`): a storage failure must never break an interview in flight.
 */

import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage";
import { setSyncedItem } from "@/lib/sync/kv";
import type { LoopBlueprint, LoopStage } from "./loops";
import type { InterviewTemplate } from "./templates";

export type LoopStageStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

/** Why a stage ended without a result. Shown in the debrief, so it's specific. */
export type LoopStageCancelReason = "user" | "time";

export interface LoopStageRun {
  /** Matches `LoopStage.id` in the blueprint. */
  stageId: string;
  status: LoopStageStatus;
  /** Wall-clock start. Set once, when the candidate enters the room. */
  startedAt?: number;
  /** `startedAt + minutes * 60_000`. The clock does not stop for anything. */
  endsAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  cancelReason?: LoopStageCancelReason;
  /** 1–5, from the stage assessment (same scale as the rest of practice). */
  score?: number;
  /** One-line takeaway from the stage assessment, for the board and debrief. */
  summary?: string;
  /** Id in `interview_results_v1`, so the full report stays reachable. */
  resultId?: string;
  /** How many questions the candidate actually got through. */
  answered?: number;
  /** True when the stage ended because the slot expired mid-answer. */
  ranOutOfTime?: boolean;
  /**
   * The curated round, stored when the stage starts. Walking out of a round and
   * coming back has to put you in front of the SAME questions with the clock
   * where you left it — re-curating would hand out a fresh, easier round.
   */
  template?: InterviewTemplate;
}

export type LoopDecision = "strong_hire" | "hire" | "lean_hire" | "no_hire";

export interface LoopStageVerdictNote {
  stageId: string;
  title: string;
  score: number | null;
  note: string;
}

export interface LoopVerdict {
  decision: LoopDecision;
  /** Level the panel would extend an offer at, when they'd extend one. */
  level?: string;
  headline: string;
  summary: string;
  stages: LoopStageVerdictNote[];
  strengths: string[];
  gaps: string[];
  nextSteps: string[];
  createdAt: number;
  /** True when the verdict came from the score fallback, not the model. */
  offline?: boolean;
}

export interface InterviewLoopRun {
  id: string;
  blueprintId: string;
  /** Copied from the blueprint so an old run still renders if it changes. */
  title: string;
  level: string;
  roleLevel: string;
  /** Optional company the candidate is targeting; biases question curation. */
  companyId?: string;
  companyName?: string;
  createdAt: number;
  updatedAt: number;
  /** Only the stages the candidate chose, in blueprint order. */
  stages: LoopStageRun[];
  verdict?: LoopVerdict;
  /** Questions already asked anywhere in this run — prevents repeats. */
  askedQuestions?: string[];
}

const MAX_RUNS = 25;

function makeId(): string {
  return `loop_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function readAll(): InterviewLoopRun[] {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.INTERVIEW_LOOPS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as InterviewLoopRun[];
  } catch {
    return [];
  }
}

function writeAll(runs: InterviewLoopRun[]): void {
  try {
    // Synced across devices + the web app (see src/lib/sync/kv.ts).
    setSyncedItem(
      STORAGE_KEYS.INTERVIEW_LOOPS,
      JSON.stringify(runs.slice(0, MAX_RUNS))
    );
  } catch {
    // best-effort
  }
}

/**
 * Expire any stage whose slot has run out while the app wasn't looking. This is
 * where "no pause" is actually enforced — every read goes through it.
 */
function reconcile(run: InterviewLoopRun, now: number): InterviewLoopRun {
  let changed = false;
  const stages = run.stages.map((s) => {
    if (s.status !== "in_progress") return s;
    if (!s.endsAt || s.endsAt > now) return s;
    changed = true;
    return {
      ...s,
      status: "cancelled" as LoopStageStatus,
      cancelledAt: s.endsAt,
      cancelReason: "time" as LoopStageCancelReason,
      ranOutOfTime: true,
    };
  });
  if (!changed) return run;
  return { ...run, stages, updatedAt: now };
}

/** Newest first, with expired stages already reconciled and persisted. */
export function listLoopRuns(): InterviewLoopRun[] {
  const now = Date.now();
  const raw = readAll();
  const runs = raw.map((r) => reconcile(r, now));
  const dirty = runs.some((r, i) => r !== raw[i]);
  if (dirty) writeAll(runs);
  return [...runs].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getLoopRun(id: string): InterviewLoopRun | null {
  return listLoopRuns().find((r) => r.id === id) ?? null;
}

function upsert(run: InterviewLoopRun): InterviewLoopRun {
  const next = { ...run, updatedAt: Date.now() };
  const all = readAll();
  const idx = all.findIndex((r) => r.id === next.id);
  if (idx >= 0) all[idx] = next;
  else all.unshift(next);
  writeAll([...all].sort((a, b) => b.updatedAt - a.updatedAt));
  return next;
}

export function createLoopRun(input: {
  blueprint: LoopBlueprint;
  /** Stage ids the candidate picked; blueprint order is preserved. */
  stageIds: string[];
  companyId?: string;
  companyName?: string;
}): InterviewLoopRun {
  const picked = new Set(input.stageIds);
  const stages: LoopStageRun[] = input.blueprint.stages
    .filter((s) => picked.has(s.id))
    .map((s) => ({ stageId: s.id, status: "pending" as LoopStageStatus }));
  const now = Date.now();
  const run: InterviewLoopRun = {
    id: makeId(),
    blueprintId: input.blueprint.id,
    title: input.blueprint.title,
    level: input.blueprint.level,
    roleLevel: input.blueprint.roleLevel,
    companyId: input.companyId,
    companyName: input.companyName,
    createdAt: now,
    updatedAt: now,
    stages,
    askedQuestions: [],
  };
  return upsert(run);
}

export function deleteLoopRun(id: string): void {
  writeAll(readAll().filter((r) => r.id !== id));
}

/**
 * Enter a stage. Stamps the wall clock; from here the only ways out are
 * finishing, cancelling, or running out of time.
 */
export function startLoopStage(
  runId: string,
  stage: LoopStage,
  template: InterviewTemplate
): InterviewLoopRun | null {
  const run = getLoopRun(runId);
  if (!run) return null;
  const now = Date.now();
  const stages = run.stages.map((s) =>
    s.stageId === stage.id
      ? {
          ...s,
          status: "in_progress" as LoopStageStatus,
          startedAt: now,
          endsAt: now + stage.minutes * 60_000,
          cancelledAt: undefined,
          cancelReason: undefined,
          ranOutOfTime: undefined,
          template,
        }
      : s
  );
  // The candidate has now seen these questions, whatever the outcome — no other
  // round in this loop should ask them again.
  const asked = mergeAsked(run.askedQuestions, template.customQuestions ?? []);
  return upsert({ ...run, stages, askedQuestions: asked });
}

export function completeLoopStage(
  runId: string,
  stageId: string,
  input: {
    score?: number;
    summary?: string;
    resultId?: string;
    answered?: number;
    ranOutOfTime?: boolean;
    /** Question text asked in this stage, added to the run-wide no-repeat list. */
    askedQuestions?: string[];
  }
): InterviewLoopRun | null {
  const run = getLoopRun(runId);
  if (!run) return null;
  const stages = run.stages.map((s) =>
    s.stageId === stageId
      ? {
          ...s,
          status: "completed" as LoopStageStatus,
          completedAt: Date.now(),
          score: input.score,
          summary: input.summary,
          resultId: input.resultId,
          answered: input.answered,
          ranOutOfTime: input.ranOutOfTime,
        }
      : s
  );
  const asked = mergeAsked(run.askedQuestions, input.askedQuestions);
  return upsert({ ...run, stages, askedQuestions: asked });
}

/** The only mid-stage exit. Costs the round; `resetLoopStage` can undo it. */
export function cancelLoopStage(
  runId: string,
  stageId: string,
  reason: LoopStageCancelReason = "user"
): InterviewLoopRun | null {
  const run = getLoopRun(runId);
  if (!run) return null;
  const stages = run.stages.map((s) =>
    s.stageId === stageId
      ? {
          ...s,
          status: "cancelled" as LoopStageStatus,
          cancelledAt: Date.now(),
          cancelReason: reason,
          ranOutOfTime: reason === "time" ? true : s.ranOutOfTime,
        }
      : s
  );
  return upsert({ ...run, stages });
}

/** Put a finished or cancelled stage back on the board so it can be retaken. */
export function resetLoopStage(
  runId: string,
  stageId: string
): InterviewLoopRun | null {
  const run = getLoopRun(runId);
  if (!run) return null;
  const stages = run.stages.map((s) =>
    s.stageId === stageId ? { stageId: s.stageId, status: "pending" as const } : s
  );
  // The verdict was drawn from the old set of stages, so it no longer holds.
  return upsert({ ...run, stages, verdict: undefined });
}

export function saveLoopVerdict(
  runId: string,
  verdict: LoopVerdict
): InterviewLoopRun | null {
  const run = getLoopRun(runId);
  if (!run) return null;
  return upsert({ ...run, verdict });
}

function mergeAsked(
  existing: string[] | undefined,
  added: string[] | undefined
): string[] {
  const out = [...(existing ?? [])];
  const seen = new Set(out.map(normalizeQuestion));
  for (const q of added ?? []) {
    const key = normalizeQuestion(q);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  // Runs are at most a dozen stages; this list stays small by construction.
  return out.slice(-120);
}

/** Loose key so "Design a URL shortener." and "design a url shortener" match. */
export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Derived helpers (pure; used by the board and the debrief) ────────────────

export function loopStageRun(
  run: InterviewLoopRun,
  stageId: string
): LoopStageRun | null {
  return run.stages.find((s) => s.stageId === stageId) ?? null;
}

/** The stage the candidate is in right now, if any. */
export function activeLoopStage(run: InterviewLoopRun): LoopStageRun | null {
  return run.stages.find((s) => s.status === "in_progress") ?? null;
}

/** The next stage to run: earliest pending, in blueprint order. */
export function nextLoopStage(run: InterviewLoopRun): LoopStageRun | null {
  return run.stages.find((s) => s.status === "pending") ?? null;
}

/** Every stage has an outcome — time to give a verdict. */
export function isLoopFinished(run: InterviewLoopRun): boolean {
  return run.stages.every(
    (s) => s.status === "completed" || s.status === "cancelled"
  );
}

export function loopProgress(run: InterviewLoopRun): {
  done: number;
  total: number;
  completed: number;
  cancelled: number;
} {
  const completed = run.stages.filter((s) => s.status === "completed").length;
  const cancelled = run.stages.filter((s) => s.status === "cancelled").length;
  return {
    done: completed + cancelled,
    total: run.stages.length,
    completed,
    cancelled,
  };
}

/** Mean score over graded stages, or null when nothing has been graded yet. */
export function loopAverageScore(run: InterviewLoopRun): number | null {
  const scored = run.stages.filter(
    (s) => s.status === "completed" && typeof s.score === "number"
  );
  if (scored.length === 0) return null;
  const sum = scored.reduce((acc, s) => acc + (s.score ?? 0), 0);
  return sum / scored.length;
}

/** Milliseconds left in the active stage. Negative means the slot is blown. */
export function msRemaining(stage: LoopStageRun, now = Date.now()): number {
  if (!stage.endsAt) return 0;
  return stage.endsAt - now;
}
