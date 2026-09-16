import type { ScorecardLine } from "./transcript";

/**
 * Matches a model-supplied evidence quote back to the line that was actually
 * said, so the hover popover shows real transcript rather than the model's
 * rendering of it.
 *
 * This is the guard on the whole evidence idea: if a quote can't be found, the
 * UI says so explicitly. A hallucinated quote must never be presented as
 * something a person said.
 */

export interface EvidenceMatch {
  /** The transcript line the quote came from, when found. */
  line: ScorecardLine | null;
  /** The line before / after, for context in the popover. */
  before: ScorecardLine | null;
  after: ScorecardLine | null;
  /**
   * Character span of the quote inside `line.text`, when it was located
   * exactly. Null after a fuzzy match — the whole line is shown instead.
   */
  span: { start: number; end: number } | null;
  matched: boolean;
  /** "exact" for a verbatim hit, "fuzzy" for a word-overlap hit. */
  how: "exact" | "fuzzy" | "none";
}

const NO_MATCH: EvidenceMatch = {
  line: null,
  before: null,
  after: null,
  span: null,
  matched: false,
  how: "none",
};

/**
 * Lowercase, collapse everything that isn't a letter or digit to a single
 * space, and keep a map back to the original offsets so an exact hit can be
 * highlighted in the untouched text.
 */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[\p{L}\p{N}]/u.test(ch)) {
      if (pendingSpace && norm.length > 0) {
        norm += " ";
        map.push(i);
        pendingSpace = false;
      }
      norm += ch.toLowerCase();
      map.push(i);
    } else {
      pendingSpace = true;
    }
  }

  return { norm, map };
}

function normalize(text: string): string {
  return normalizeWithMap(text).norm;
}

function tokens(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean);
}

/**
 * How much of the quote appears in the line. Containment rather than Jaccard:
 * a 10-word quote lifted from a 200-word answer is a perfect match even though
 * the two token sets barely overlap.
 */
function containment(quoteTokens: string[], lineTokens: string[]): number {
  if (quoteTokens.length === 0) return 0;
  const haystack = new Set(lineTokens);
  const hits = quoteTokens.filter((t) => haystack.has(t)).length;
  return hits / quoteTokens.length;
}

/** Below this, a "match" is coincidence rather than the same sentence. */
const FUZZY_THRESHOLD = 0.65;

export function matchEvidence(
  quote: string,
  lines: ScorecardLine[]
): EvidenceMatch {
  const cleanQuote = (quote || "").trim();
  if (!cleanQuote || lines.length === 0) return NO_MATCH;

  const normQuote = normalize(cleanQuote);
  if (!normQuote) return NO_MATCH;

  const at = (i: number): ScorecardLine | null => lines[i] ?? null;

  // Verbatim hit — the case the prompt asks for.
  for (let i = 0; i < lines.length; i++) {
    const { norm, map } = normalizeWithMap(lines[i].text);
    const idx = norm.indexOf(normQuote);
    if (idx === -1) continue;
    const start = map[idx];
    const end = map[idx + normQuote.length - 1] + 1;
    return {
      line: lines[i],
      before: at(i - 1),
      after: at(i + 1),
      span:
        typeof start === "number" && typeof end === "number"
          ? { start, end }
          : null,
      matched: true,
      how: "exact",
    };
  }

  // The model paraphrased or stitched words together. Fall back to the line
  // that contains most of the quote's words, if any line convincingly does.
  const quoteTokens = tokens(cleanQuote);
  let bestIndex = -1;
  let bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const score = containment(quoteTokens, tokens(lines[i].text));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex === -1 || bestScore < FUZZY_THRESHOLD) return NO_MATCH;

  return {
    line: lines[bestIndex],
    before: at(bestIndex - 1),
    after: at(bestIndex + 1),
    span: null,
    matched: true,
    how: "fuzzy",
  };
}
