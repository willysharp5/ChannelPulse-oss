/**
 * Detecting the far side of a call leaking into the microphone.
 *
 * The app captures two streams at once: the system-audio tap (them) and the
 * microphone (you). The microphone is captured RAW — see `micAudioConstraints`
 * in `@/lib/utils` — because enabling the webview's echo canceller put the
 * shared input device into Apple's voice-processing mode, and every other
 * client of that device inherited it, which is what made the user sound quiet
 * and distant to everyone on their Zoom/Meet call.
 *
 * Giving up the echo canceller means the mic now also hears the far side out of
 * the speakers, so their words can reach the transcript twice — the second time
 * labelled as yours. That is what this module exists to prevent. It works on
 * text rather than audio, so it costs nothing on the audio path and cannot
 * damage the recording; the worst it can do is drop a line.
 */

/** Words, lowercased, punctuation dropped — for comparing two transcripts. */
export const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * How much of `mic` already appears in `other`, 0..1.
 *
 * Containment, NOT symmetric similarity, and that choice is load-bearing:
 * speaker bleed reaches the mic as a shorter, patchier version of what the tap
 * heard cleanly, so a symmetric score (Jaccard, dice) rates the pair as
 * different in exactly the case where the shorter one is the echo.
 */
export const containment = (mic: string, other: string): number => {
  const a = wordsOf(mic);
  if (a.length === 0) return 0;
  const b = new Set(wordsOf(other));
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / a.length;
};

/** How far back a THEM line can be and still explain a mic echo. */
export const ECHO_WINDOW_MS = 12_000;
/** Share of the mic's words that must already be in the THEM line. */
export const ECHO_CONTAINMENT = 0.8;
/**
 * Below this many words we never call it bleed: "yeah", "right", "exactly"
 * legitimately come from both sides seconds apart, and a short utterance hits
 * any containment threshold by accident.
 */
export const ECHO_MIN_WORDS = 4;

export interface BleedCandidate {
  content: string;
  timestamp: number;
  speaker?: string;
}

/**
 * True when this mic transcript is really the far side bleeding through the
 * speakers, because a line that closely matches it was just captured from
 * someone who is not you.
 *
 * Requiring a `speaker` is what narrows this to *heard* lines: only captured
 * speech carries one, so AI answers and typed chat messages can never be
 * mistaken for the source of an echo.
 */
export const isSpeakerBleed = (
  transcription: string,
  priorMessages: BleedCandidate[],
  now: number = Date.now()
): boolean => {
  if (wordsOf(transcription).length < ECHO_MIN_WORDS) return false;
  return priorMessages.some(
    (m) =>
      !!m.speaker &&
      m.speaker !== "You" &&
      now - m.timestamp >= 0 &&
      now - m.timestamp < ECHO_WINDOW_MS &&
      containment(transcription, m.content) >= ECHO_CONTAINMENT
  );
};
