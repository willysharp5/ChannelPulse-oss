/**
 * Post-conversation scorecard: what replaces the raw chat log once a
 * conversation is finished. Two shapes behind one union — a graded interview
 * review, or a meeting summary with key points — because those are the two
 * things a ChannelPulse conversation ever is.
 *
 * Deliberately mirrors the vocabulary of `InterviewAssessment` in
 * lib/interview/session.ts (overallScore / strengths / improvements /
 * recommendations, 1-5 scores) so Interview Practice's assessment report and
 * this surface read as one product.
 */

/**
 * How serious a flagged moment is. Red and yellow are what get highlighted in
 * the UI (per product requirement); green marks a genuinely strong moment and
 * is used sparingly.
 * - red: a real problem — didn't answer the question, vague/incorrect claim, rambling.
 * - yellow: worth watching — partial answer, filler, a missed opportunity.
 * - green: a strong moment worth repeating.
 */
export type Severity = "red" | "yellow" | "green";

/** Was the thing that was asked actually addressed? */
export type Verdict3 = "yes" | "partly" | "no";

/**
 * A pointer back into what was actually said. `quote` MUST be copied verbatim
 * out of the transcript — the UI matches it back to a real message so the hover
 * popover can show the real line rather than the model's paraphrase (see
 * evidence.ts). An unmatched quote is labelled as such in the UI.
 */
export interface Evidence {
  quote: string;
  speaker?: string;
  severity: Severity;
  /** Why this moment matters, one short sentence. */
  note: string;
}

/** A statement about the conversation, backed by the moments that support it. */
export interface KeyPoint {
  text: string;
  evidence: Evidence[];
}

/** One axis of an interview score (Structure, Specificity, …). */
export interface Dimension {
  label: string;
  /** 1-5. */
  score: number;
  comment: string;
}

export interface ActionItem {
  text: string;
  /** Who owns it, when the conversation made that clear. */
  owner?: string;
  evidence: Evidence[];
}

/** Meticulous review of a single question and the answer given to it. */
export interface QuestionReview {
  /** The question as it was actually asked. */
  question: string;
  /** What the candidate actually said, in a sentence or two. */
  answerSummary: string;
  /** Did the answer address the question that was asked? */
  answeredWhatWasAsked: Verdict3;
  /** Was the answer coherent and internally consistent? */
  madeSense: Verdict3;
  /** 1-5. */
  score: number;
  strengths: string[];
  improvements: string[];
  /** What a strong answer covers, in markdown. */
  strongerAnswer: string;
  evidence: Evidence[];
}

export interface InterviewScorecard {
  kind: "interview";
  /** One-line title for the card, e.g. "Backend system design screen". */
  headline: string;
  /** One-line bottom line, e.g. "Solid structure, thin on trade-offs." */
  verdict: string;
  summary: string;
  /** 1-5. */
  overallScore: number;
  dimensions: Dimension[];
  keyPoints: KeyPoint[];
  questions: QuestionReview[];
  strengths: string[];
  improvements: string[];
  recommendations: string[];
  /** Flagged spoken moments that don't belong to one specific question. */
  moments: Evidence[];
}

export interface MeetingScorecard {
  kind: "meeting";
  headline: string;
  summary: string;
  keyPoints: KeyPoint[];
  decisions: KeyPoint[];
  actionItems: ActionItem[];
  openQuestions: KeyPoint[];
  topics: string[];
  moments: Evidence[];
}

export type Scorecard = InterviewScorecard | MeetingScorecard;

export type ScorecardKind = Scorecard["kind"];

/** A cached scorecard plus what it was generated from. */
export interface ScorecardRecord {
  conversationId: string;
  scorecard: Scorecard;
  generatedAt: number;
  /**
   * Identifies the conversation state this was graded from. A mismatch means
   * the conversation grew since, so the card is stale.
   */
  fingerprint: string;
}
