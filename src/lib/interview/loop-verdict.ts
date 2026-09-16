/**
 * The debrief at the end of a loop: hire or no hire.
 *
 * In a real process the individual interviewers write up their rounds and then a
 * hiring committee reads all of them together and makes ONE call. That's what
 * this does — it takes the per-stage grades and summaries and produces a single
 * decision, at a level, with the reasoning.
 *
 * Two things it does not do:
 *   • It does not average its way to a "hire". A strong technical score does not
 *     rescue a failed values round, and cancelled rounds count as no signal —
 *     which, on a required round, is not a pass.
 *   • It does not require the network. If the model call fails there's a
 *     deterministic fallback off the scores, flagged `offline: true`, so the
 *     candidate always gets an answer after sitting through hours of interviews.
 */

import { fetchAIResponse } from "@/lib/functions";
import { parseJsonFromLLM, type LlmConfig } from "@/lib/llm";
import { getLoopBlueprint, type LoopBlueprint } from "./loops";
import {
  loopAverageScore,
  type InterviewLoopRun,
  type LoopDecision,
  type LoopStageVerdictNote,
  type LoopVerdict,
} from "./loop-runs";

const DECISIONS: LoopDecision[] = [
  "strong_hire",
  "hire",
  "lean_hire",
  "no_hire",
];

export const LOOP_DECISION_LABELS: Record<LoopDecision, string> = {
  strong_hire: "Strong hire",
  hire: "Hire",
  lean_hire: "Lean hire",
  no_hire: "No hire",
};

/** Whether an offer comes out of this decision. Used for the headline styling. */
export function isOffer(decision: LoopDecision): boolean {
  return decision !== "no_hire";
}

function normalizeDecision(v: unknown): LoopDecision | null {
  const s = String(v ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return DECISIONS.find((d) => d === s) ?? null;
}

function asStringArray(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, max);
}

function stageNotes(
  run: InterviewLoopRun,
  blueprint: LoopBlueprint | null
): LoopStageVerdictNote[] {
  return run.stages.map((s) => {
    const stage = blueprint?.stages.find((b) => b.id === s.stageId);
    const title = stage?.title ?? s.stageId;
    if (s.status === "cancelled") {
      return {
        stageId: s.stageId,
        title,
        score: null,
        note:
          s.cancelReason === "time"
            ? "Ran out of time, no signal from this round."
            : "Cancelled by the candidate, no signal from this round.",
      };
    }
    if (s.status !== "completed") {
      return {
        stageId: s.stageId,
        title,
        score: null,
        note: "Not attempted.",
      };
    }
    return {
      stageId: s.stageId,
      title,
      score: typeof s.score === "number" ? s.score : null,
      note: s.summary || "Completed.",
    };
  });
}

/** Deterministic decision from the scores alone. Also the offline fallback. */
export function scoreBasedDecision(run: InterviewLoopRun): LoopDecision {
  const avg = loopAverageScore(run);
  const cancelled = run.stages.filter((s) => s.status === "cancelled").length;
  const lowest = run.stages
    .filter((s) => s.status === "completed" && typeof s.score === "number")
    .reduce<number | null>(
      (min, s) => (min === null ? (s.score as number) : Math.min(min, s.score as number)),
      null
    );
  if (avg === null) return "no_hire";
  // A round nobody sat through, or a round that clearly failed, is not
  // averaged away — that's how real committees treat it.
  if (cancelled > 1) return "no_hire";
  if (lowest !== null && lowest <= 2) return avg >= 4 ? "lean_hire" : "no_hire";
  if (avg >= 4.5 && cancelled === 0) return "strong_hire";
  if (avg >= 3.8) return "hire";
  if (avg >= 3.2) return "lean_hire";
  return "no_hire";
}

function fallbackVerdict(
  run: InterviewLoopRun,
  blueprint: LoopBlueprint | null,
  notes: LoopStageVerdictNote[]
): LoopVerdict {
  const decision = scoreBasedDecision(run);
  const avg = loopAverageScore(run);
  const avgText = avg === null ? "no graded rounds" : `${avg.toFixed(1)}/5 average`;
  const strong = notes
    .filter((n) => (n.score ?? 0) >= 4)
    .map((n) => `${n.title} was a clear strength.`);
  const weak = notes
    .filter((n) => n.score !== null && n.score <= 2)
    .map((n) => `${n.title} fell below the bar.`);
  const missing = notes
    .filter((n) => n.score === null)
    .map((n) => `${n.title} produced no signal.`);
  return {
    decision,
    level: blueprint?.level,
    headline:
      decision === "no_hire"
        ? "No hire on this loop"
        : `${LOOP_DECISION_LABELS[decision]} · ${blueprint?.title ?? run.title}`,
    summary:
      `Committee call based on ${avgText} across ${notes.length} rounds. ` +
      "This debrief was generated offline from your round scores, so it's blunter than usual; open the individual round reports for the detail.",
    stages: notes,
    strengths: strong.slice(0, 4),
    gaps: [...weak, ...missing].slice(0, 4),
    nextSteps: [
      "Re-read the report for your weakest round and rewrite one answer from scratch.",
      "Retake that round only; the board lets you retake a single stage.",
    ],
    createdAt: Date.now(),
    offline: true,
  };
}

export async function generateLoopVerdict(params: {
  config: LlmConfig;
  run: InterviewLoopRun;
  signal?: AbortSignal;
}): Promise<LoopVerdict> {
  const { config, run, signal } = params;
  const blueprint = getLoopBlueprint(run.blueprintId);
  const notes = stageNotes(run, blueprint);

  const systemPrompt =
    `You are the hiring committee for a ${run.title} role (${run.level}). You have just read every ` +
    `interviewer's write-up from the candidate's loop and must make ONE call.\n\n` +
    `How committees actually decide, follow this:\n` +
    `- Weigh the rounds that matter most for this role, not the average. A great coding round does not ` +
    `offset a failed values or people-management round.\n` +
    `- A round with no signal (cancelled, or the candidate ran out of time) is NOT a pass. Say so plainly.\n` +
    `- Be willing to say no hire. An unearned "hire" is useless to the candidate.\n` +
    `- If you would hire, say at what level, and whether it is below the level they interviewed for.\n\n` +
    `Return ONLY JSON (no markdown fences):\n` +
    `{\n` +
    `  "decision": "strong_hire" | "hire" | "lean_hire" | "no_hire",\n` +
    `  "level": "<level you'd extend an offer at, or the level they fell short of>",\n` +
    `  "headline": "<one line the candidate reads first, direct and specific>",\n` +
    `  "summary": "<2-4 sentences: the decision and the reasoning that drove it, naming the rounds>",\n` +
    `  "stages": [{ "stageId": "<id>", "note": "<one line on that round from the committee's view>" }],\n` +
    `  "strengths": ["<what the loop proved, specific>"],\n` +
    `  "gaps": ["<what cost them, specific>"],\n` +
    `  "nextSteps": ["<what to do before interviewing again, concrete>"]\n` +
    `}`;

  const roundBlock = notes
    .map((n, i) => {
      const score = n.score === null ? "no signal" : `${n.score}/5`;
      return `Round ${i + 1} · ${n.title} [id: ${n.stageId}] (${score}): ${n.note}`;
    })
    .join("\n");

  const userMessage =
    `Role: ${run.title} (${run.level})${run.companyName ? ` at ${run.companyName}` : ""}\n` +
    `Loop: ${blueprint?.summary ?? ""}\n` +
    `Rounds completed: ${notes.filter((n) => n.score !== null).length} of ${notes.length}\n\n` +
    `INTERVIEWER WRITE-UPS:\n${roundBlock}\n\n` +
    `Make the call now.`;

  let raw = "";
  try {
    for await (const chunk of fetchAIResponse({
      provider: config.provider,
      selectedProvider: config.selectedProvider,
      systemPrompt,
      userMessage,
      // The committee judges the loop, but the candidate's real background is
      // useful for "next steps" that aren't generic.
      disableMemory: false,
      useWeb: false,
      signal,
    })) {
      if (chunk) raw += chunk;
    }
  } catch {
    return fallbackVerdict(run, blueprint, notes);
  }

  const parsed = parseJsonFromLLM<{
    decision?: unknown;
    level?: unknown;
    headline?: unknown;
    summary?: unknown;
    stages?: { stageId?: unknown; note?: unknown }[];
    strengths?: unknown;
    gaps?: unknown;
    nextSteps?: unknown;
  }>(raw);

  const decision = normalizeDecision(parsed?.decision);
  const summary = String(parsed?.summary ?? "").trim();
  if (!decision || !summary) {
    return fallbackVerdict(run, blueprint, notes);
  }

  // Keep our own scores/titles; take only the committee's prose per round.
  const merged: LoopStageVerdictNote[] = notes.map((n) => {
    const from = parsed?.stages?.find(
      (s) => String(s?.stageId ?? "") === n.stageId
    );
    const note = String(from?.note ?? "").trim();
    return note ? { ...n, note } : n;
  });

  return {
    decision,
    level: String(parsed?.level ?? blueprint?.level ?? "").trim() || undefined,
    headline:
      String(parsed?.headline ?? "").trim() ||
      `${LOOP_DECISION_LABELS[decision]} · ${run.title}`,
    summary,
    stages: merged,
    strengths: asStringArray(parsed?.strengths),
    gaps: asStringArray(parsed?.gaps),
    nextSteps: asStringArray(parsed?.nextSteps, 5),
    createdAt: Date.now(),
  };
}
