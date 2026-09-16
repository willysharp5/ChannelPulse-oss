import type { ChatConversation, ChatMessage } from "@/types/completion";
import { isHeardTranscriptMessage } from "@/lib/chat/transcript";

/**
 * Turns a saved conversation into the transcript the grader sees, and the
 * indexed line list the UI later matches evidence quotes back against.
 *
 * The two producers store things differently, which is the whole reason this
 * exists rather than reusing buildTranscriptContext():
 * - Live notes / meetings (`sysaudio_conv…`) carry heard speech as user
 *   messages with `origin: "transcript"`; typed chat questions and the
 *   copilot's suggested replies are `origin: "chat"` and must be dropped — the
 *   grader must never mark an AI suggestion as something a person said.
 * - Interview Practice (`persistPracticeSession`) writes BOTH sides with
 *   `origin: "chat"` (interviewer = assistant, candidate = user), so the
 *   origin filter would delete the entire interview. Those conversations are
 *   detected up front and kept whole, minus the persisted assessment message.
 */

/** One transcript line, addressable so evidence can point back at it. */
export interface ScorecardLine {
  /** 1-based position in the transcript shown to the model. */
  index: number;
  /** Id of the ChatMessage this came from (used to jump to the transcript). */
  messageId: string;
  speaker: string;
  text: string;
  timestamp: number;
}

export interface ScorecardTranscript {
  lines: ScorecardLine[];
  /** The complete indexed, speaker-labelled text. Nothing is ever dropped. */
  text: string;
  /** Words actually spoken — the gate on whether grading is worth a call. */
  wordCount: number;
}

/**
 * How much transcript goes into ONE grading call. ~120k chars is roughly 30k
 * tokens — about a 20,000-word conversation, or a two-and-a-half hour meeting —
 * which every model the app talks to handles comfortably alongside a 6k-token
 * response. Real conversations land far inside this.
 *
 * A transcript longer than this is NOT trimmed. generate.ts reads it in
 * sequential chunks instead (see DIGEST_CHUNK_CHARS), because a review built
 * from a conversation with its middle deleted is a worse review that also looks
 * complete — the failure mode worth avoiding most.
 */
export const SINGLE_CALL_MAX_CHARS = 120_000;

/** Chunk size for the multi-pass path. Small enough to be read closely. */
export const DIGEST_CHUNK_CHARS = 40_000;

/** Below this there isn't enough said to grade honestly. */
export const MIN_WORDS_TO_GRADE = 60;

/** The trailing report `persistPracticeSession` writes — never grade it. */
const ASSESSMENT_LABEL = "interview assessment";

/**
 * Interview Practice sessions, identified the way they're written: an
 * `interview-` id, or the `Interview Practice: …` title. Deterministic, so a
 * practice session is never mistaken for a meeting.
 */
export function isInterviewPracticeConversation(
  conversation: Pick<ChatConversation, "id" | "title">
): boolean {
  return (
    conversation.id.startsWith("interview-") ||
    conversation.title.trim().toLowerCase().startsWith("interview practice:")
  );
}

/** The AI's own output, which must stay out of the graded transcript. */
function isGeneratedReport(message: ChatMessage): boolean {
  return (message.displayLabel || "").trim().toLowerCase() === ASSESSMENT_LABEL;
}

function speakerFor(message: ChatMessage, practice: boolean): string {
  const explicit = message.speaker?.trim();
  if (explicit) return explicit;
  if (message.role === "user") return "You";
  return practice ? "Interviewer" : "Them";
}

/**
 * Pick the messages that count as "what was said". Order of preference:
 * 1. Interview Practice — both sides, minus the persisted assessment.
 * 2. Anything with heard speech — heard speech only.
 * 3. Neither (a plain typed chat) — the whole thread, so a real conversation
 *    still gets a summary instead of an empty state.
 */
function selectSpokenMessages(conversation: ChatConversation): {
  messages: ChatMessage[];
  practice: boolean;
} {
  const ordered = [...conversation.messages]
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((m) => m.role !== "system")
    .filter((m) => (m.content || "").trim().length > 0)
    .filter((m) => !isGeneratedReport(m));

  if (isInterviewPracticeConversation(conversation)) {
    return { messages: ordered, practice: true };
  }

  const heard = ordered.filter((m) =>
    isHeardTranscriptMessage(m, conversation.id)
  );
  if (heard.length > 0) return { messages: heard, practice: false };

  return { messages: ordered, practice: false };
}

function countWords(lines: ScorecardLine[]): number {
  return lines.reduce(
    (sum, line) => sum + line.text.split(/\s+/).filter(Boolean).length,
    0
  );
}

function renderLine(line: ScorecardLine): string {
  return `[${line.index}] ${line.speaker}: ${line.text}`;
}

/** The indexed, speaker-labelled form the model reads. */
export function renderLines(lines: ScorecardLine[]): string {
  return lines.map(renderLine).join("\n");
}

/**
 * Split the transcript into sequential chunks, each within `maxChars`, so a
 * conversation too long for one call can still be read in full.
 *
 * Chunks carry a two-line overlap: an answer that straddles a boundary is then
 * visible whole to at least one pass, so it can't be graded as if it were cut
 * off. A single line longer than the budget still gets its own chunk — better an
 * oversized chunk than a severed sentence.
 */
export function chunkTranscriptLines(
  lines: ScorecardLine[],
  maxChars: number = DIGEST_CHUNK_CHARS
): ScorecardLine[][] {
  const OVERLAP = 2;
  const chunks: ScorecardLine[][] = [];
  let current: ScorecardLine[] = [];
  let chars = 0;

  for (const line of lines) {
    const size = renderLine(line).length + 1;
    if (current.length && chars + size > maxChars) {
      chunks.push(current);
      current = current.slice(-OVERLAP);
      chars = current.reduce((sum, l) => sum + renderLine(l).length + 1, 0);
    }
    current.push(line);
    chars += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function buildScorecardTranscript(
  conversation: ChatConversation
): ScorecardTranscript {
  const { messages, practice } = selectSpokenMessages(conversation);

  const lines: ScorecardLine[] = messages.map((message, i) => ({
    index: i + 1,
    messageId: message.id,
    speaker: speakerFor(message, practice),
    text: (message.content || "").trim().replace(/\s+/g, " "),
    timestamp: message.timestamp,
  }));

  return {
    lines,
    text: renderLines(lines),
    wordCount: countWords(lines),
  };
}

/** Whether there's enough here for grading to say anything true. */
export function canGrade(transcript: ScorecardTranscript): boolean {
  return (
    transcript.lines.length >= 2 && transcript.wordCount >= MIN_WORDS_TO_GRADE
  );
}

/**
 * Identifies the conversation state a scorecard was graded from. A mismatch
 * means the conversation changed, so the cached card is stale.
 */
export function fingerprintConversation(
  conversation: Pick<ChatConversation, "messages" | "updatedAt">
): string {
  return `${conversation.messages.length}:${conversation.updatedAt}`;
}
