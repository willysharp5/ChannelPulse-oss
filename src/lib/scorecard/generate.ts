import { parseJsonFromLLM, runLLM, type LlmConfig } from "@/lib/llm";
import { px } from "@/lib/prompts/overrides";
import type { ChatConversation } from "@/types/completion";
import {
  SCORECARD_CLASSIFY_PROMPT,
  SCORECARD_DIGEST_PROMPT,
  SCORECARD_INTERVIEW_PROMPT,
  SCORECARD_MEETING_PROMPT,
} from "./prompts";
import {
  buildScorecardTranscript,
  chunkTranscriptLines,
  isInterviewPracticeConversation,
  renderLines,
  SINGLE_CALL_MAX_CHARS,
  type ScorecardTranscript,
} from "./transcript";
import type {
  ActionItem,
  Dimension,
  Evidence,
  InterviewScorecard,
  KeyPoint,
  MeetingScorecard,
  QuestionReview,
  Scorecard,
  ScorecardKind,
  Severity,
  Verdict3,
} from "./types";

/**
 * Generates a scorecard from a finished conversation: one classification pass
 * (skipped when the conversation's origin already settles it), then one
 * grading call whose JSON is normalized into a shape the UI can render without
 * optional-chaining into a crash.
 *
 * The grader always sees the WHOLE conversation. If the transcript doesn't fit
 * in one call, it's read in sequential chunks and the resulting digests are what
 * gets graded — never a transcript with its middle deleted.
 */

/** Grading returns a lot of per-question prose; give it room. */
const GRADE_MAX_TOKENS = 6000;

/** A digest is dense but bounded; each chunk gets its own generous budget. */
const DIGEST_MAX_TOKENS = 4000;

export class ScorecardError extends Error {}

// ---------------------------------------------------------------- normalizing

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function strArray(v: unknown, limit = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, limit);
}

/** Clamp to the 1-5 rubric, defaulting to the middle rather than to 0. */
function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function asSeverity(v: unknown): Severity {
  const s = str(v).toLowerCase();
  if (s === "red" || s === "yellow" || s === "green") return s;
  // Anything unrecognized is treated as "worth a look" rather than dropped:
  // losing a flagged moment is worse than mis-shading one.
  return "yellow";
}

function asVerdict3(v: unknown): Verdict3 {
  const s = str(v).toLowerCase();
  if (s === "yes" || s === "no" || s === "partly") return s;
  if (s === "partial" || s === "partially") return "partly";
  return "partly";
}

/** Evidence without a quote is useless — it can't be matched or hovered. */
function normalizeEvidence(v: unknown, limit = 6): Evidence[] {
  if (!Array.isArray(v)) return [];
  const out: Evidence[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const quote = str(item.quote);
    if (!quote) continue;
    out.push({
      quote,
      speaker: str(item.speaker) || undefined,
      severity: asSeverity(item.severity),
      note: str(item.note),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeKeyPoints(v: unknown, limit = 10): KeyPoint[] {
  if (!Array.isArray(v)) return [];
  const out: KeyPoint[] = [];
  for (const raw of v) {
    if (!raw) continue;
    // Tolerate a bare string where the contract asked for {text, evidence}.
    if (typeof raw === "string") {
      const text = raw.trim();
      if (text) out.push({ text, evidence: [] });
    } else if (typeof raw === "object") {
      const item = raw as Record<string, unknown>;
      const text = str(item.text);
      if (text) out.push({ text, evidence: normalizeEvidence(item.evidence) });
    }
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeActionItems(v: unknown, limit = 12): ActionItem[] {
  if (!Array.isArray(v)) return [];
  const out: ActionItem[] = [];
  for (const raw of v) {
    if (!raw) continue;
    if (typeof raw === "string") {
      const text = raw.trim();
      if (text) out.push({ text, evidence: [] });
    } else if (typeof raw === "object") {
      const item = raw as Record<string, unknown>;
      const text = str(item.text);
      if (!text) continue;
      out.push({
        text,
        owner: str(item.owner) || undefined,
        evidence: normalizeEvidence(item.evidence),
      });
    }
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeDimensions(v: unknown): Dimension[] {
  if (!Array.isArray(v)) return [];
  const out: Dimension[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const label = str(item.label);
    if (!label) continue;
    out.push({
      label,
      score: clampScore(item.score),
      comment: str(item.comment),
    });
    if (out.length >= 8) break;
  }
  return out;
}

function normalizeQuestions(v: unknown): QuestionReview[] {
  if (!Array.isArray(v)) return [];
  const out: QuestionReview[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const question = str(item.question);
    if (!question) continue;
    out.push({
      question,
      answerSummary: str(item.answerSummary),
      answeredWhatWasAsked: asVerdict3(item.answeredWhatWasAsked),
      madeSense: asVerdict3(item.madeSense),
      score: clampScore(item.score),
      strengths: strArray(item.strengths),
      improvements: strArray(item.improvements),
      strongerAnswer: str(item.strongerAnswer),
      evidence: normalizeEvidence(item.evidence),
    });
    if (out.length >= 25) break;
  }
  return out;
}

function normalizeInterview(raw: Record<string, unknown>): InterviewScorecard {
  const questions = normalizeQuestions(raw.questions);
  const stated = clampScore(raw.overallScore);
  // When per-question scores exist they're the more defensible number — the
  // same reasoning as normalizeAssessment() in lib/interview/session.ts.
  const overallScore = questions.length
    ? clampScore(
        questions.reduce((sum, q) => sum + q.score, 0) / questions.length
      )
    : stated;

  return {
    kind: "interview",
    headline: str(raw.headline, "Interview review"),
    verdict: str(raw.verdict),
    summary: str(raw.summary),
    overallScore,
    dimensions: normalizeDimensions(raw.dimensions),
    keyPoints: normalizeKeyPoints(raw.keyPoints),
    questions,
    strengths: strArray(raw.strengths),
    improvements: strArray(raw.improvements),
    recommendations: strArray(raw.recommendations),
    moments: normalizeEvidence(raw.moments),
  };
}

function normalizeMeeting(raw: Record<string, unknown>): MeetingScorecard {
  return {
    kind: "meeting",
    headline: str(raw.headline, "Conversation summary"),
    summary: str(raw.summary),
    keyPoints: normalizeKeyPoints(raw.keyPoints),
    decisions: normalizeKeyPoints(raw.decisions),
    actionItems: normalizeActionItems(raw.actionItems),
    openQuestions: normalizeKeyPoints(raw.openQuestions),
    topics: strArray(raw.topics, 8),
    moments: normalizeEvidence(raw.moments),
  };
}

/**
 * Coerce a parsed grading response into a valid Scorecard. `kind` comes from
 * the caller, not the payload — we asked for a specific review and that's what
 * we render, even if the model echoed the wrong kind field.
 */
export function normalizeScorecard(
  parsed: unknown,
  kind: ScorecardKind
): Scorecard {
  if (!parsed || typeof parsed !== "object") {
    throw new ScorecardError("The model didn't return a scorecard.");
  }
  const raw = parsed as Record<string, unknown>;
  return kind === "interview" ? normalizeInterview(raw) : normalizeMeeting(raw);
}

// ------------------------------------------------------------------- the calls

async function classifyKind(
  config: LlmConfig,
  transcript: ScorecardTranscript,
  signal?: AbortSignal
): Promise<ScorecardKind> {
  try {
    const text = await runLLM(
      config,
      px("scorecard.classify", SCORECARD_CLASSIFY_PROMPT),
      transcript.text,
      { structured: true, maxTokens: 300, signal }
    );
    const parsed = parseJsonFromLLM<{ kind?: string }>(text);
    return str(parsed?.kind).toLowerCase() === "interview"
      ? "interview"
      : "meeting";
  } catch (err) {
    if (signal?.aborted) throw err;
    // A failed classification shouldn't cost the user their summary; the
    // header switch lets them re-grade as an interview.
    return "meeting";
  }
}

/**
 * Read one section of an over-long transcript. Returns the raw digest text to
 * hand to the grading pass — it's re-serialized rather than typed, because
 * nothing but the grader consumes it and a rigid shape would only invite
 * dropping fields the model added.
 */
async function digestChunk(
  config: LlmConfig,
  chunk: string,
  position: string,
  signal?: AbortSignal
): Promise<string | null> {
  const response = await runLLM(
    config,
    px("scorecard.digest", SCORECARD_DIGEST_PROMPT),
    [
      `This is ${position} of the transcript.`,
      "--- Section (line numbers are for your reference only; do not include them in quotes) ---",
      chunk,
      "--- End section ---",
    ].join("\n\n"),
    { structured: true, maxTokens: DIGEST_MAX_TOKENS, signal }
  );
  const parsed = parseJsonFromLLM<Record<string, unknown>>(response);
  // A chunk whose JSON came back unreadable is skipped rather than failing the
  // whole review — but see the guard in buildDigestedSource(): if too many fail,
  // there isn't enough left to review honestly and we say so.
  return parsed ? JSON.stringify(parsed, null, 1) : null;
}

/**
 * The long-conversation path: digest every section, then grade from the digests.
 * Sections run in parallel — they're independent reads, and a 90-minute meeting
 * shouldn't take a minute of wall clock to review.
 */
async function buildDigestedSource(
  config: LlmConfig,
  transcript: ScorecardTranscript,
  signal?: AbortSignal
): Promise<string> {
  const chunks = chunkTranscriptLines(transcript.lines);
  const digests = await Promise.all(
    chunks.map((chunk, i) =>
      digestChunk(
        config,
        renderLines(chunk),
        `section ${i + 1} of ${chunks.length}`,
        signal
      ).catch(() => null)
    )
  );

  const usable = digests.filter((d): d is string => !!d);
  if (usable.length < Math.ceil(chunks.length / 2)) {
    throw new ScorecardError(
      "Couldn't read enough of this conversation to review it properly. Try generating it again."
    );
  }

  return usable
    .map((digest, i) => `--- Section ${i + 1} notes ---\n${digest}`)
    .join("\n\n");
}

export interface GenerateScorecardResult {
  scorecard: Scorecard;
}

export async function generateScorecard(params: {
  config: LlmConfig;
  conversation: ChatConversation;
  /** Set by the header switch to override detection. */
  forceKind?: ScorecardKind;
  signal?: AbortSignal;
}): Promise<GenerateScorecardResult> {
  const { config, conversation, forceKind, signal } = params;
  const transcript = buildScorecardTranscript(conversation);

  if (!transcript.text) {
    throw new ScorecardError("There's nothing in this conversation to review.");
  }

  const kind: ScorecardKind =
    forceKind ??
    (isInterviewPracticeConversation(conversation)
      ? "interview"
      : await classifyKind(config, transcript, signal));

  const system =
    kind === "interview"
      ? px("scorecard.interview", SCORECARD_INTERVIEW_PROMPT)
      : px("scorecard.meeting", SCORECARD_MEETING_PROMPT);

  // Short enough for one call (virtually every real conversation): grade the
  // verbatim transcript. Otherwise read it in full, section by section, and
  // grade from those notes.
  const fitsInOneCall = transcript.text.length <= SINGLE_CALL_MAX_CHARS;

  const user = fitsInOneCall
    ? [
        conversation.title ? `Conversation title: ${conversation.title}` : "",
        "--- Transcript (line numbers are for your reference only; do not include them in quotes) ---",
        transcript.text,
        "--- End transcript ---",
      ]
        .filter(Boolean)
        .join("\n\n")
    : [
        conversation.title ? `Conversation title: ${conversation.title}` : "",
        "This conversation was long, so it was read in sections and these are the notes from" +
          " every section, in order. They cover the conversation end to end; treat them as the" +
          " full record. Every quote in them is verbatim, so quote from them directly.",
        await buildDigestedSource(config, transcript, signal),
      ]
        .filter(Boolean)
        .join("\n\n");

  const response = await runLLM(config, system, user, {
    structured: true,
    maxTokens: GRADE_MAX_TOKENS,
    signal,
  });

  const parsed = parseJsonFromLLM<Record<string, unknown>>(response);
  if (!parsed) {
    throw new ScorecardError(
      "Couldn't read the review that came back. Try generating it again."
    );
  }

  return { scorecard: normalizeScorecard(parsed, kind) };
}
