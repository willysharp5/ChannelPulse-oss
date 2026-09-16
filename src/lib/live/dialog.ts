/**
 * Context blocks that let the live copilot judge a CONVERSATION rather than a
 * single utterance.
 *
 * Two problems this solves:
 *
 * 1. **Judging in isolation.** The copilot was handed one utterance and asked
 *    what to do with it. But "and what about the timeline?" is only answerable
 *    if you know the previous turn was about the migration plan, and "yes,
 *    that's right" is only a skip if you know what "that" was. The recent-dialog
 *    block gives it the last few turns verbatim, with speakers.
 *
 * 2. **Repetition.** Because each turn was judged fresh, the copilot happily
 *    re-noted the same fact three times as a speaker circled a topic. The
 *    already-covered block is an explicit list of what it has ALREADY said, with
 *    an instruction to skip rather than restate — much more reliable than hoping
 *    it notices its own earlier output buried in the history.
 *
 * These go in `extraContext` (not the system prompt) because they change every
 * turn, and because the system prompt is DB-overridable by admins while this is
 * mechanical, per-turn data that must never be edited away.
 */
import type { ChatMessage } from "@/types";
import { isHeardTranscriptMessage } from "@/lib/chat/transcript";

/** How many prior heard turns to show. Enough for reference resolution, small
 *  enough to keep the live path fast — the full history still goes in `history`. */
const DIALOG_TURNS = 8;
/** How many of the copilot's own prior outputs to list as already-covered. */
const COVERED_TURNS = 6;
/** Per-line truncation so one rambling turn can't crowd out the rest. */
const MAX_LINE_CHARS = 320;

function clip(text: string, max = MAX_LINE_CHARS): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * The last few heard turns, oldest-first, as `Speaker: text`.
 *
 * @param latest the turn being judged right now. It is appended last and marked,
 *   because at call time it has usually not been committed to `messages` yet —
 *   and even when it has, marking it is what tells the model which turn to judge.
 */
export function buildRecentDialog(
  messages: ChatMessage[],
  conversationId: string | null | undefined,
  latest: { text: string; speaker?: string }
): string {
  const prior = [...messages]
    .filter((m) => isHeardTranscriptMessage(m, conversationId))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-DIALOG_TURNS)
    .map((m) => {
      const text = clip(m.content);
      if (!text) return "";
      return `${(m.speaker || "Speaker").trim()}: ${text}`;
    })
    .filter(Boolean);

  const latestText = clip(latest.text);
  if (!latestText) return "";
  const latestLine = `${(latest.speaker || "Speaker").trim()}: ${latestText}`;

  // Drop an exact repeat of the last prior line: the turn may already have been
  // committed by the transcript writer, and showing it twice reads as the
  // speaker having said it twice.
  if (prior.length && prior[prior.length - 1] === latestLine) prior.pop();

  return [
    "--- RECENT DIALOG (context only; oldest first) ---",
    ...(prior.length ? prior : ["(nothing earlier)"]),
    "--- LATEST TURN (judge THIS one) ---",
    latestLine,
    "--- End ---",
  ].join("\n");
}

/**
 * What the copilot has already said this session, so it can recognize a moment
 * it has covered and stay quiet instead of restating it.
 */
export function buildAlreadyCovered(messages: ChatMessage[]): string {
  const prior = [...messages]
    .filter(
      (m) => m.role === "assistant" && (m.origin ?? "transcript") !== "chat"
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-COVERED_TURNS)
    .map((m) => {
      // The model's own topic is the sharpest one-line summary of what it covered.
      // Failing that, the first meaningful line is enough to recognize the point;
      // the whole thing would double the prompt for no discriminating power.
      const topic = m.triageTopic?.trim();
      const first =
        topic ||
        (m.content || "")
          .split("\n")
          .map((l) => l.replace(/^[\s>*_#-]+/, "").trim())
          .find(Boolean);
      if (!first) return "";
      const kind =
        m.triageMode === "note"
          ? "noted"
          : m.triageMode === "action"
            ? "flagged as an action"
            : m.triageMode === "ask"
              ? "asked"
              : "answered";
      return `- (${kind}) ${clip(first, 160)}`;
    })
    .filter(Boolean);

  if (!prior.length) return "";
  return [
    "--- ALREADY COVERED (you said these earlier, do NOT say them again; if your best output would restate one, output [SKIP]) ---",
    ...prior,
    "--- End ---",
  ].join("\n");
}

/**
 * Assemble the per-turn context for a live copilot turn. Returns undefined when
 * there is nothing useful to add, so the caller can leave `extraContext` unset.
 */
export function buildLiveTurnContext(args: {
  messages: ChatMessage[];
  conversationId?: string | null;
  text: string;
  speaker?: string;
  /** Heuristic hint from `looksLikeQuestion` — helps when STT dropped the "?". */
  looksLikeQuestion?: boolean;
  /** How many STT fragments were stitched into this turn (debug/steering). */
  parts?: number;
}): string | undefined {
  const blocks: string[] = [];
  const dialog = buildRecentDialog(args.messages, args.conversationId, {
    text: args.text,
    speaker: args.speaker,
  });
  if (dialog) blocks.push(dialog);

  const covered = buildAlreadyCovered(args.messages);
  if (covered) blocks.push(covered);

  if (args.looksLikeQuestion) {
    blocks.push(
      "HINT: the latest turn is phrased like a direct question. Verify it is aimed at the user before using [ANSWER]."
    );
  }
  if ((args.parts ?? 1) > 1) {
    blocks.push(
      `HINT: the latest turn was reassembled from ${args.parts} speech fragments, so treat it as one complete thought.`
    );
  }

  return blocks.length ? blocks.join("\n\n") : undefined;
}
