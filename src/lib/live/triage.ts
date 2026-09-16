/**
 * Triage for the live copilot: decide what KIND of help a turn deserves, and
 * suppress the turns that deserve none.
 *
 * The copilot used to emit a "Suggested reply" for literally every utterance,
 * which read as spam. Triage fixes that in two layers, cheapest first:
 *
 *   1. `prefilterTurn` — deterministic, zero-cost, zero-latency. Kills pure
 *      backchannel ("yeah", "mm-hmm", "got it") and STT re-deliveries before any
 *      network call. These are never worth a token.
 *   2. `readTriage` — parses a mode tag the MODEL emits as its first token
 *      (`[ANSWER]` / `[NOTE]` / `[ASK]` / `[SKIP]`), so the speech-act judgement
 *      itself is made by the model. Deepgram cannot do this: its Text
 *      Intelligence `intents` returns open-ended generated verb phrases at very
 *      low confidence, with no question/statement taxonomy and no turn-taking
 *      awareness. Only an LLM can tell "so what's your timeline?" (answer this)
 *      from "our timeline is Q3" (note this).
 *
 * Why the tag is IN-PROMPT rather than a separate classifier call: this is a
 * live copilot, and a pre-flight classification round-trip would add its latency
 * to every answer — including the ones we do want. Interview mode already proved
 * the in-prompt approach works with its bare `SKIP` sentinel; this generalizes
 * that sentinel to four outcomes.
 *
 * Both layers FAIL OPEN. A prefilter that isn't sure lets the turn through; an
 * untagged or unrecognized response is treated as an answer and shown verbatim.
 * A copilot that occasionally says too much is a nuisance; one that silently
 * swallows a real answer is broken.
 */

/**
 * What the copilot decided to do with a turn.
 * - `answer` — a question was aimed at the user; this is what they can say.
 * - `note`   — substantive information was given; these are the facts to keep.
 * - `action` — something was committed to or has to happen; the to-do.
 * - `ask`    — nothing needed answering, but here are questions worth asking.
 * - `skip`   — nothing actionable; show nothing.
 */
export type TriageMode = "answer" | "note" | "action" | "ask" | "skip";

/**
 * Tag spelling → mode. This IS the contract with `COPILOT_TRIAGE_PROMPT` in
 * `src/config/constants.ts`: the prompt tells the model to open with one of these
 * as `[MODE]` or `[MODE: Topic]`. Keep the two in step.
 */
const TAG_TO_MODE: Record<string, TriageMode> = {
  ANSWER: "answer",
  NOTE: "note",
  ACTION: "action",
  ASK: "ask",
  SKIP: "skip",
  // Tolerated synonyms — cheaper than a retry if the model paraphrases the tag.
  REPLY: "answer",
  QUESTION: "ask",
  ASKS: "ask",
  NOTES: "note",
  ACTIONS: "action",
  TODO: "action",
  "NEXT STEP": "action",
  SILENT: "skip",
  NONE: "skip",
};

const TAG_NAMES = Object.keys(TAG_TO_MODE);

/**
 * Result of reading a (possibly incomplete) streamed response.
 * `pending` means "not enough characters yet to know the mode" — render nothing,
 * so a half-typed `[SK` never flashes on screen.
 *
 * `topic` is the model's own 2-6 word headline for this item (from a
 * `[NOTE: Pricing tiers]`-style tag). It is what the UI shows, because "Pricing
 * tiers" tells the user what the card is about and "Worth noting" does not.
 * Optional: a model that emits a bare `[NOTE]` still parses, it just falls back
 * to the generic label.
 */
export type TriageRead =
  | { status: "pending" }
  | { status: "resolved"; mode: TriageMode; topic?: string; body: string };

/**
 * Generic fallback label per mode, used ONLY when the model gave no topic (and
 * for turns committed before topics existed). The topic is always preferred —
 * these strings are a safety net, not the design.
 */
export const TRIAGE_LABELS: Record<Exclude<TriageMode, "skip">, string> = {
  answer: "Suggested reply",
  note: "Worth noting",
  action: "Action item",
  ask: "Questions to ask",
};

/**
 * Longest topic we'll render. The header is a single line on a narrow overlay, so
 * a model that ignores "2-6 words" gets clipped rather than wrapping the card.
 */
const MAX_TOPIC_CHARS = 56;

/**
 * Clean a raw topic from the tag into something renderable, or `undefined` if
 * there is nothing useful in it.
 *
 * Rejects a topic that is just the mode word again ("[NOTE: Note]") — that
 * carries no information and the generic label is honestly better.
 */
export function sanitizeTopic(raw: string): string | undefined {
  let t = (raw || "").replace(/\s+/g, " ").trim();
  // Loop until stable: a model that writes `"Q3 churn number".` needs the quote
  // AND the period gone, and either order alone leaves the other stranded.
  for (let pass = 0; pass < 4; pass += 1) {
    const next = t
      .replace(/^["'“”‘’(\[\s]+/, "")
      .replace(/["'“”‘’)\]\s.:;,—–-]+$/, "");
    if (next === t) break;
    t = next;
  }
  if (!t) return undefined;
  if (TAG_TO_MODE[t.toUpperCase()]) return undefined;
  if (t.length > MAX_TOPIC_CHARS) t = `${t.slice(0, MAX_TOPIC_CHARS - 1)}…`;
  return t;
}

/**
 * The stream opened with `[` but hasn't closed the bracket yet — could this still
 * become a real tag?
 *
 * Two cases, and the second is why this isn't a simple prefix test: while the
 * topic is streaming we have something like `[NOTE: Pricing ti`, which is not a
 * prefix of any tag but is unmistakably a tag in progress. So if a colon is
 * already present, the part before it must be an exact tag name; if not, what we
 * have must be a prefix of one (note `[A` is a prefix of BOTH `[ANSWER]` and
 * `[ASK]`, so it has to stay pending rather than guess).
 */
function isUnterminatedTag(text: string): boolean {
  const inner = text.slice(1);
  const colon = inner.indexOf(":");
  if (colon !== -1) {
    return TAG_TO_MODE[inner.slice(0, colon).trim().toUpperCase()] !== undefined;
  }
  const head = inner.trim().toUpperCase();
  if (!head) return true; // just "[" so far
  return TAG_NAMES.some((name) => name.startsWith(head));
}

/**
 * Parse a streaming or complete copilot response into a mode + topic + body.
 *
 * Call it on every stream chunk: while it returns `pending`, show nothing; once
 * it resolves, the mode and topic are final and `body` is what to render.
 */
export function readTriage(raw: string): TriageRead {
  const text = (raw || "").replace(/^\s+/, "");
  if (!text) return { status: "pending" };

  if (text.startsWith("[")) {
    const close = text.indexOf("]");
    if (close === -1) {
      // Still streaming the tag itself — hold if it could become one, otherwise
      // this is just a response that happens to open with a bracket.
      if (isUnterminatedTag(text)) return { status: "pending" };
      return { status: "resolved", mode: "answer", body: text };
    }
    // `[MODE]` or `[MODE: topic]`. Split on the FIRST colon only, so a topic may
    // legitimately contain one ("[NOTE: Pricing: tier 2]").
    const inner = text.slice(1, close);
    const colon = inner.indexOf(":");
    const name = (colon === -1 ? inner : inner.slice(0, colon))
      .trim()
      .toUpperCase();
    const mode = TAG_TO_MODE[name];
    if (mode) {
      const topic =
        colon === -1 ? undefined : sanitizeTopic(inner.slice(colon + 1));
      return {
        status: "resolved",
        mode,
        ...(topic ? { topic } : {}),
        body: text.slice(close + 1).replace(/^[\s:—-]+/, ""),
      };
    }
    // An unknown bracket (a markdown link, a [fill in: ___] placeholder) is
    // content, not a tag. Fail open and keep it.
    return { status: "resolved", mode: "answer", body: text };
  }

  // Legacy path: the interview prompt's bare `SKIP` sentinel, still honored so
  // an `app_prompts` row customized before triage existed keeps working.
  const bare = text.toUpperCase().replace(/[.!,\s]+$/g, "");
  if (bare === "SKIP") return { status: "resolved", mode: "skip", body: "" };
  if ("SKIP".startsWith(bare)) return { status: "pending" };

  return { status: "resolved", mode: "answer", body: text };
}

/**
 * Tokens that carry no information on their own. A turn made up ENTIRELY of
 * these is acknowledgement noise — the other party nodding along — and never
 * needs the copilot. Kept as single tokens so multi-word acks ("sounds good",
 * "got it", "fair enough") are covered by the all-tokens-match rule below.
 */
const ACK_TOKENS = new Set([
  "a", "absolutely", "actually", "ah", "aha", "alright", "amazing", "and",
  "anyway", "awesome", "bye", "certainly", "cool", "correct", "course",
  "definitely", "enough", "exactly", "fair", "fine", "for", "get", "good",
  "goodbye", "got", "great", "ha", "haha", "hello", "hey", "hi", "hmm", "huh",
  "i", "indeed", "it", "just", "k", "like", "lovely", "mean", "mhm", "mhmm",
  "mm", "mmhmm", "mmm", "morning", "nah", "nice", "no", "nope", "oh", "ok",
  "okay", "okey", "perfect", "please", "really", "right", "see", "sense",
  "so", "sorry", "sound", "sounds", "sure", "thank", "thanks", "thanx", "thx",
  "totally", "true", "uh", "uhhuh", "uhhum", "um", "umm", "understood", "very",
  "well", "wow", "yea", "yeah", "yep", "yes", "you", "yup",
  // "makes sense" / "you know" / "i see" fall out of the tokens above.
  "know", "makes",
]);

/** Longest turn (in words) the ack rule will consider. Above this, let it through. */
const ACK_MAX_WORDS = 5;

function normalize(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean);
}

/**
 * Is this turn nothing but acknowledgement? A question mark disqualifies it
 * outright — "Really?" and "Why?" are short but genuinely aimed at the user.
 */
export function isBackchannel(text: string): boolean {
  const t = (text || "").trim();
  if (!t || t.includes("?")) return false;
  const words = tokenize(t);
  if (words.length === 0) return true;
  if (words.length > ACK_MAX_WORDS) return false;
  // Strip a token-level stutter ("yeah yeah yeah") before judging.
  return words.every((w) => ACK_TOKENS.has(w.replace(/-/g, "")));
}

export type PrefilterReason = "empty" | "backchannel" | "duplicate";

export type PrefilterResult =
  | { pass: true }
  | { pass: false; reason: PrefilterReason };

/**
 * Deterministic gate applied before any model call. Cheap, explainable, and
 * conservative — anything it isn't certain about passes through to the model.
 */
export function prefilterTurn(
  text: string,
  opts: { previousTurns?: string[] } = {}
): PrefilterResult {
  const t = (text || "").trim();
  if (!t) return { pass: false, reason: "empty" };
  if (isBackchannel(t)) return { pass: false, reason: "backchannel" };

  const norm = normalize(t);
  for (const prev of opts.previousTurns ?? []) {
    const p = normalize(prev);
    if (!p) continue;
    if (p === norm) return { pass: false, reason: "duplicate" };
    // STT sometimes re-delivers a fragment of a turn we already handled. Only
    // treat containment as a duplicate for substantial text, so a genuine short
    // utterance ("Yes") isn't swallowed because it appeared inside an earlier turn.
    if (norm.length >= 24 && p.includes(norm)) {
      return { pass: false, reason: "duplicate" };
    }
  }
  return { pass: true };
}

/**
 * Heuristic question detection. NOT used to gate anything — the model makes that
 * call. It only annotates the prompt ("this turn looks like a direct question"),
 * which measurably steers the tag on turns where STT dropped the question mark.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (t.includes("?")) return true;
  const words = tokenize(t);
  if (words.length === 0) return false;
  const first = words[0];
  const WH = new Set([
    "who", "what", "when", "where", "why", "how", "which", "whose", "whom",
  ]);
  const AUX = new Set([
    "are", "is", "was", "were", "do", "does", "did", "can", "could", "will",
    "would", "should", "have", "has", "had", "may", "might", "shall",
  ]);
  if (WH.has(first) || AUX.has(first)) return true;
  // Imperative prompts that are questions in everything but punctuation.
  return /\b(tell me|walk me through|explain|describe|talk to me about|give me an example|how about)\b/i.test(
    t
  );
}
