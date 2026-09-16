/**
 * Turn assembly for the live copilot.
 *
 * WHY THIS EXISTS: the Rust VAD closes an utterance after ~0.5s of silence
 * (`DEFAULT_VAD_CONFIG.silence_chunks = 24`) with a floor of ~0.11s of speech.
 * That is deliberately aggressive so the visible transcript feels instant — but
 * it means one spoken thought ("So the thing is… <breath> …we need to pick a
 * database this week") arrives as two or three separate STT results. Feeding each
 * fragment to the copilot produced the two problems this module fixes:
 *   1. the copilot answered sentence FRAGMENTS, so its replies were incoherent;
 *   2. it fired once per fragment, so it felt like it responded to everything.
 *
 * The fix is to run the transcript and the copilot on TWO DIFFERENT CLOCKS. The
 * VAD stays fast (transcript latency is a feature), and fragments are buffered
 * here into a coherent *turn* before the copilot is consulted. Retuning the VAD
 * to ~1.1s instead would have made the transcript itself feel laggy, which is a
 * worse trade: users watch the transcript continuously and the copilot only
 * occasionally.
 *
 * The thresholds mirror Deepgram's own `utterance_end_ms` guidance ("You should
 * set the value of `utterance_end_ms` to be `1000` ms or higher"), because it is
 * the same judgement — when has a speaker actually finished a thought — and
 * their number comes from far more conversational audio than we have.
 */

/** A single STT result: one VAD-delimited fragment, not necessarily a turn. */
export interface TurnFragment {
  text: string;
  /** Diarized speaker label ("Speaker 1", "Them", …) when the engine gave one. */
  speaker?: string;
  /** Epoch ms the fragment was received. Injected so tests can drive the clock. */
  at: number;
}

/** Why the buffer was flushed — surfaced for debugging and telemetry. */
export type TurnEndReason =
  | "gap"
  | "sentence"
  | "speaker-change"
  | "cap"
  | "flush";

export interface AssembledTurn {
  /** The joined text of every fragment in the turn. */
  text: string;
  speaker?: string;
  /** How many STT fragments composed this turn (1 = the VAD got it in one). */
  parts: number;
  startedAt: number;
  endedAt: number;
  reason: TurnEndReason;
}

export interface TurnAggregatorOptions {
  /**
   * Silence to wait after a fragment that does NOT end a sentence. Longer,
   * because unterminated text means the speaker is mid-thought — being patient
   * here is what actually stitches fragments back into one turn.
   */
  gapMs?: number;
  /**
   * Silence to wait after a fragment that ends with terminal punctuation. A
   * finished sentence *might* be a finished turn, so we commit sooner. Note a
   * finished sentence is not automatically a finished turn ("I was at Google.
   * Then I moved to Stripe.") — hence still a wait, just a shorter one.
   */
  sentenceGapMs?: number;
  /**
   * Hard character ceiling. A monologue never goes silent long enough to flush,
   * and the user still deserves help during one, so cut a turn at this length.
   */
  maxChars?: number;
  /** Hard time ceiling for the same reason. */
  maxMs?: number;
  /** Injected for tests; defaults to the real timers. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export const TURN_DEFAULTS = {
  /** ≥1000ms per Deepgram's utterance_end_ms guidance; 1100 for a little margin. */
  gapMs: 1100,
  sentenceGapMs: 700,
  maxChars: 700,
  maxMs: 20000,
} as const;

/** Does this text end a sentence? Deepgram's smart_format supplies the marks. */
function endsSentence(text: string): boolean {
  return /[.!?]["')\]]?\s*$/.test(text.trim());
}

/**
 * Join fragments the way a person would read them: a space between fragments,
 * except where the previous one already ended with an open quote/hyphen or the
 * next begins with punctuation that must hug the preceding word.
 */
function joinFragments(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      if (!acc) return part;
      if (/[-–—("'[]$/.test(acc)) return acc + part;
      if (/^[,.;:!?)\]'"]/.test(part)) return acc + part;
      return `${acc} ${part}`;
    }, "");
}

/**
 * Buffers STT fragments and emits coherent turns.
 *
 * Deliberately a plain class rather than a hook: it owns a timer and must
 * survive React re-renders untouched. `useSystemAudio` holds one in a ref.
 */
export class TurnAggregator {
  private readonly opts: Required<
    Pick<TurnAggregatorOptions, "gapMs" | "sentenceGapMs" | "maxChars" | "maxMs">
  >;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<TurnAggregatorOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<TurnAggregatorOptions["clearTimer"]>;

  private parts: string[] = [];
  private speaker: string | undefined;
  private startedAt = 0;
  private lastAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly onTurn: (turn: AssembledTurn) => void,
    options: TurnAggregatorOptions = {}
  ) {
    this.opts = {
      gapMs: options.gapMs ?? TURN_DEFAULTS.gapMs,
      sentenceGapMs: options.sentenceGapMs ?? TURN_DEFAULTS.sentenceGapMs,
      maxChars: options.maxChars ?? TURN_DEFAULTS.maxChars,
      maxMs: options.maxMs ?? TURN_DEFAULTS.maxMs,
    };
    this.now = options.now ?? (() => Date.now());
    this.setTimer =
      options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h));
  }

  /** True when a partial turn is waiting on more audio. */
  get pending(): boolean {
    return this.parts.length > 0;
  }

  /** The text buffered so far — shown live so the UI isn't silent while waiting. */
  get pendingText(): string {
    return joinFragments(this.parts);
  }

  get pendingSpeaker(): string | undefined {
    return this.speaker;
  }

  add(fragment: TurnFragment): void {
    if (this.disposed) return;
    const text = (fragment.text || "").trim();
    if (!text) return;

    // A different voice means the previous speaker's turn is over — emit it
    // immediately rather than waiting out the gap. Without this, a fast
    // back-and-forth would glue both sides into one turn attributed to whoever
    // spoke first, which is exactly the incoherence we're fixing.
    const speakerChanged =
      this.parts.length > 0 &&
      !!fragment.speaker &&
      !!this.speaker &&
      fragment.speaker !== this.speaker;
    if (speakerChanged) this.emit("speaker-change");

    if (this.parts.length === 0) {
      this.startedAt = fragment.at;
      // Only adopt a speaker label when the engine actually supplied one, so an
      // unlabeled fragment can't erase a known speaker mid-turn.
      this.speaker = fragment.speaker;
    } else if (!this.speaker && fragment.speaker) {
      this.speaker = fragment.speaker;
    }
    this.parts.push(text);
    this.lastAt = fragment.at;

    this.cancelTimer();

    // Ceilings: a long monologue must still reach the copilot.
    if (
      joinFragments(this.parts).length >= this.opts.maxChars ||
      this.lastAt - this.startedAt >= this.opts.maxMs
    ) {
      this.emit("cap");
      return;
    }

    const wait = endsSentence(text)
      ? this.opts.sentenceGapMs
      : this.opts.gapMs;
    const reason: TurnEndReason = endsSentence(text) ? "sentence" : "gap";
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.emit(reason);
    }, wait);
  }

  /**
   * Emit whatever is buffered right now. Call when the session stops or the user
   * taps "Answer now" — a half-finished turn is better than a lost one.
   */
  flush(reason: TurnEndReason = "flush"): void {
    this.cancelTimer();
    this.emit(reason);
  }

  /** Drop the buffer without emitting (e.g. the conversation was reset). */
  reset(): void {
    this.cancelTimer();
    this.parts = [];
    this.speaker = undefined;
    this.startedAt = 0;
    this.lastAt = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private emit(reason: TurnEndReason): void {
    if (this.parts.length === 0) return;
    const turn: AssembledTurn = {
      text: joinFragments(this.parts),
      speaker: this.speaker,
      parts: this.parts.length,
      startedAt: this.startedAt,
      endedAt: this.lastAt || this.now(),
      reason,
    };
    // Clear BEFORE the callback: `onTurn` runs app code that may synchronously
    // call back into `add()`/`flush()`, and re-entering with a live buffer would
    // emit the same turn twice.
    this.parts = [];
    this.speaker = undefined;
    this.startedAt = 0;
    this.lastAt = 0;
    this.onTurn(turn);
  }
}
