import { backendSpeak } from "@/lib/backend/client";

/**
 * ChannelPulse OSS speaks with the operating system's built-in voice
 * (`window.speechSynthesis`) — no cloud TTS, no API key, fully offline. The
 * hosted-voice code below is left in place but unreachable behind this switch;
 * `fetchSpeechBlob` short-circuits so every path falls through to the browser
 * voice. Flip this to re-enable a managed TTS backend in a downstream build.
 */
const CLOUD_TTS_ENABLED = false;

export type TtsVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "fable"
  | "onyx"
  | "nova"
  | "sage"
  | "shimmer"
  | "verse";

export const TTS_VOICES: { id: TtsVoice; label: string }[] = [
  { id: "alloy", label: "Alloy" },
  { id: "ash", label: "Ash" },
  { id: "ballad", label: "Ballad" },
  { id: "coral", label: "Coral" },
  { id: "echo", label: "Echo" },
  { id: "fable", label: "Fable" },
  { id: "onyx", label: "Onyx" },
  { id: "nova", label: "Nova" },
  { id: "sage", label: "Sage" },
  { id: "shimmer", label: "Shimmer" },
  { id: "verse", label: "Verse" },
];

/** Slightly faster than natural pace for snappier interview turns. */
export const DEFAULT_TTS_SPEED = 1.15;

type SpeakListeners = {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
  /** Fires as each phrase begins playing (for follow-along highlighting). */
  onPhrase?: (phrase: string) => void;
  /** Fires with playback progress (0..1) within the current phrase. */
  onProgress?: (fraction: number) => void;
};

type SpeakOpts = {
  voice?: string;
  speed?: number;
  signal?: AbortSignal;
  preferBrowser?: boolean;
} & SpeakListeners;

let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
let speaking = false;
let paused = false;
/** Bumps on cancel so in-flight queue loops exit. */
let speakGeneration = 0;

export function isSpeaking(): boolean {
  return speaking;
}

export function isPaused(): boolean {
  return paused;
}

/**
 * Pause the current speech without discarding it. Returns true if something was
 * paused. Resume with {@link resumeSpeech} to continue from the same spot.
 */
export function pauseSpeech(): boolean {
  if (currentAudio && !currentAudio.paused) {
    try {
      currentAudio.pause();
      paused = true;
      return true;
    } catch {
      // ignore
    }
  }
  if (typeof window !== "undefined" && window.speechSynthesis && speaking) {
    try {
      window.speechSynthesis.pause();
      paused = true;
      return true;
    } catch {
      // ignore
    }
  }
  return false;
}

/** Resume speech previously paused with {@link pauseSpeech}. */
export function resumeSpeech(): boolean {
  paused = false;
  if (currentAudio) {
    try {
      void currentAudio.play();
      return true;
    } catch {
      // ignore
    }
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.resume();
      return true;
    } catch {
      // ignore
    }
  }
  return false;
}

/** Stop any in-progress speech (cloud or browser fallback). */
export function cancelSpeech(): void {
  speakGeneration += 1;
  paused = false;
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.src = "";
    } catch {
      // ignore
    }
    currentAudio = null;
  }
  if (currentObjectUrl) {
    try {
      URL.revokeObjectURL(currentObjectUrl);
    } catch {
      // ignore
    }
    currentObjectUrl = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
  speaking = false;
}

function speakWithBrowser(
  text: string,
  listeners: SpeakListeners = {},
  speed = DEFAULT_TTS_SPEED
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      const err = new Error("Speech synthesis is not available.");
      listeners.onError?.(err);
      reject(err);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = Math.min(2, Math.max(0.5, speed));
    utterance.onstart = () => {
      speaking = true;
      listeners.onStart?.();
    };
    utterance.onend = () => {
      speaking = false;
      listeners.onEnd?.();
      resolve();
    };
    utterance.onerror = () => {
      speaking = false;
      const err = new Error("Browser speech synthesis failed.");
      listeners.onError?.(err);
      reject(err);
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

async function fetchSpeechBlob(
  text: string,
  opts: {
    voice?: string;
    speed?: number;
    signal?: AbortSignal;
  }
): Promise<Blob> {
  // OSS: no hosted voice. Throwing here makes speak()/speakSequence() fall
  // through to the offline browser voice (see CLOUD_TTS_ENABLED).
  if (!CLOUD_TTS_ENABLED) {
    throw new Error("Cloud TTS disabled in ChannelPulse OSS.");
  }
  return backendSpeak(text, {
    voice: opts.voice || "nova",
    format: "mp3",
    speed: opts.speed ?? DEFAULT_TTS_SPEED,
    signal: opts.signal,
  });
}

function playBlob(
  blob: Blob,
  opts: { signal?: AbortSignal } & SpeakListeners
): Promise<void> {
  const url = URL.createObjectURL(blob);
  currentObjectUrl = url;
  const audio = new Audio(url);
  // Slight playback speed bump as a second lever (in addition to TTS speed).
  audio.playbackRate = 1.05;
  currentAudio = audio;

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      speaking = false;
      if (currentObjectUrl === url) {
        URL.revokeObjectURL(url);
        currentObjectUrl = null;
      }
      if (currentAudio === audio) currentAudio = null;
    };

    audio.onplay = () => {
      speaking = true;
      opts.onStart?.();
    };
    audio.ontimeupdate = () => {
      const d = audio.duration;
      if (d && Number.isFinite(d) && d > 0) {
        opts.onProgress?.(Math.min(1, audio.currentTime / d));
      }
    };
    audio.onended = () => {
      opts.onProgress?.(1);
      cleanup();
      opts.onEnd?.();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      const err = new Error("Audio playback failed.");
      opts.onError?.(err);
      reject(err);
    };

    if (opts.signal) {
      const onAbort = () => {
        cleanup();
        try {
          audio.pause();
        } catch {
          // ignore
        }
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    audio.play().catch((err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

/**
 * Speak a single utterance. Cancels any prior speech first.
 * Prefers cloud TTS; falls back to browser voice on failure.
 */
export async function speak(text: string, opts: SpeakOpts = {}): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  cancelSpeech();
  const gen = speakGeneration;
  const speed = opts.speed ?? DEFAULT_TTS_SPEED;

  if (opts.preferBrowser || !CLOUD_TTS_ENABLED) {
    return speakWithBrowser(trimmed, opts, speed);
  }

  try {
    if (opts.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const blob = await fetchSpeechBlob(trimmed, {
      voice: opts.voice,
      speed,
      signal: opts.signal,
    });

    if (opts.signal?.aborted || gen !== speakGeneration) {
      throw new DOMException("Aborted", "AbortError");
    }

    await playBlob(blob, opts);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    if (gen !== speakGeneration) return;
    console.warn("Cloud TTS failed, falling back to browser voice:", err);
    return speakWithBrowser(trimmed, opts, speed);
  }
}

/**
 * Speak a sequence of phrases back-to-back without gaps from canceling.
 * Prefetches the next clip while the current one plays so speech starts
 * as soon as each phrase is ready (ideal for streaming sentence-by-sentence).
 */
export async function speakSequence(
  phrases: AsyncIterable<string> | string[],
  opts: SpeakOpts = {}
): Promise<void> {
  cancelSpeech();
  const gen = speakGeneration;
  const speed = opts.speed ?? DEFAULT_TTS_SPEED;
  let started = false;

  const queue: string[] = [];
  let producerDone = false;
  let wake: (() => void) | null = null;

  const notify = () => {
    wake?.();
    wake = null;
  };

  const waitForItem = () =>
    new Promise<void>((resolve) => {
      if (queue.length > 0 || producerDone) {
        resolve();
        return;
      }
      wake = resolve;
    });

  const producer = (async () => {
    try {
      for await (const phrase of toAsyncIterable(phrases)) {
        if (gen !== speakGeneration || opts.signal?.aborted) break;
        const trimmed = phrase.trim();
        if (!trimmed) continue;
        queue.push(trimmed);
        notify();
      }
    } finally {
      producerDone = true;
      notify();
    }
  })();

  try {
    let prefetch: Promise<Blob | null> | null = null;
    let prefetchText: string | null = null;

    const takeNext = async (): Promise<string | null> => {
      while (queue.length === 0 && !producerDone) {
        await waitForItem();
        if (gen !== speakGeneration || opts.signal?.aborted) return null;
      }
      return queue.shift() ?? null;
    };

    const fetchBlob = async (text: string): Promise<Blob | null> => {
      if (!CLOUD_TTS_ENABLED) return null; // OSS: use the offline browser voice.
      try {
        return await fetchSpeechBlob(text, {
          voice: opts.voice,
          speed,
          signal: opts.signal,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        console.warn("Cloud TTS chunk failed:", err);
        return null;
      }
    };

    let nextText = await takeNext();
    while (nextText) {
      if (gen !== speakGeneration || opts.signal?.aborted) break;

      let blob: Blob | null = null;
      if (prefetch && prefetchText === nextText) {
        blob = await prefetch;
      } else {
        blob = await fetchBlob(nextText);
      }
      prefetch = null;
      prefetchText = null;

      // Start fetching the following phrase while we play this one.
      const lookahead = queue[0];
      if (lookahead) {
        prefetchText = lookahead;
        prefetch = fetchBlob(lookahead);
      }

      if (gen !== speakGeneration || opts.signal?.aborted) break;

      // Announce the phrase about to play so callers can highlight it.
      opts.onPhrase?.(nextText);

      if (blob) {
        if (!started) {
          started = true;
          speaking = true;
          opts.onStart?.();
        }
        try {
          await playBlob(blob, {
            signal: opts.signal,
            onProgress: opts.onProgress,
          });
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") throw err;
          // If speech was cancelled (e.g. the user hit Grade/Exit, or a new
          // question started), the cleared audio emits an error — do NOT fall
          // back to the browser voice, which would resume talking.
          if (gen !== speakGeneration || opts.signal?.aborted) return;
          // Otherwise it's a genuine playback failure — fall back for this chunk.
          await speakWithBrowser(nextText, {}, speed);
        }
      } else {
        if (!started) {
          started = true;
          speaking = true;
          opts.onStart?.();
        }
        await speakWithBrowser(nextText, {}, speed);
      }

      nextText = await takeNext();
    }
  } finally {
    await producer.catch(() => {});
    if (gen === speakGeneration) {
      speaking = false;
      if (started) opts.onEnd?.();
    }
  }
}

function toAsyncIterable(source: AsyncIterable<string> | string[]): AsyncIterable<string> {
  if (Symbol.asyncIterator in source) return source;
  return (async function* () {
    for (const s of source) yield s;
  })();
}

/**
 * Pull complete sentences out of a growing text buffer so TTS can start
 * while the LLM is still generating. Returns spoken chunks + leftover.
 */
/**
 * Split the FIRST chunk into a short lead phrase (+ remainder) so speech can
 * start almost immediately — the first TTS request is tiny, so synthesis +
 * download return fast instead of waiting on a long opening sentence.
 */
export function splitLeadChunk(chunks: string[], max = 70): string[] {
  if (chunks.length === 0) return chunks;
  const [first, ...rest] = chunks;
  if (first.length <= max) return chunks;
  let cut = first.lastIndexOf(" ", max);
  if (cut < 24) cut = max; // no early space — hard cut
  const lead = first.slice(0, cut).trim();
  const tail = first.slice(cut).trim();
  if (!lead || !tail) return chunks;
  return [lead, tail, ...rest];
}

/**
 * Convert Markdown into clean, speakable prose.
 *
 * A TTS voice reads raw Markdown literally — "star star", "pound", "dash" — and
 * stutters on every hard line break, list bullet, and table pipe, which is what
 * makes a model answer sound robotic. This strips the syntax and reflows the
 * text so it reads the way a person would: emphasis markers gone, headings and
 * list items become sentences with a natural pause between them, links keep
 * their words but drop the URL.
 *
 * `stripCode`: drop fenced code blocks entirely (coding solutions — read the
 * explanation, not the code). Otherwise the code text is kept but its fence
 * markers are removed.
 */
export function markdownToSpeech(
  md: string,
  opts: { stripCode?: boolean } = {}
): string {
  let t = md ?? "";

  // Fenced code blocks first, before other markers touch their contents.
  if (opts.stripCode) {
    t = t.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ");
  } else {
    t = t
      .replace(/```[\w+-]*\n?([\s\S]*?)```/g, " $1 ")
      .replace(/~~~[\w+-]*\n?([\s\S]*?)~~~/g, " $1 ");
  }

  t = t
    // Images: drop (spoken alt text is rarely useful).
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // Links: keep the visible text, drop the URL.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    // Inline code: keep the text, drop the backticks.
    .replace(/`([^`]+)`/g, "$1")
    // Bold / italic / strikethrough: keep the words, drop the markers.
    .replace(/(\*\*\*|\*\*|\*|___|__|_|~~)(\S[\s\S]*?\S|\S)\1/g, "$2")
    .replace(/\*\*|\*|__|~~/g, "")
    // Headings, blockquotes, list markers: drop the marker, keep the text.
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/gm, "\n") // horizontal rule
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    // Tables: drop separator rows, turn pipes into commas so cells read out.
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, "")
    .replace(/\s*\|\s*/g, ", ")
    // Backslash escapes: \* -> *
    .replace(/\\([\\`*_{}[\]()#+\-.!>~])/g, "$1");

  // Reflow into sentences. Each remaining line is a logical unit (paragraph,
  // former heading, or list item); give it a terminal stop if it lacks one so
  // the voice pauses between units, then join into a single spoken stream.
  const spoken = t
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .map((line) => (/[.!?:,;]$/.test(line) ? line : `${line}.`))
    .join(" ");

  return spoken
    .replace(/\s+([,.!?;:])/g, "$1") // no space before punctuation
    .replace(/([.!?:;])\1+/g, "$1") // collapse doubled stops
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function pullSpeakableChunks(
  buffer: string,
  opts: { flush?: boolean } = {}
): { chunks: string[]; rest: string } {
  const chunks: string[] = [];
  let rest = buffer;

  // Prefer ending on sentence punctuation; also split on paragraph breaks.
  const pattern = /[.!?…]["')\]]*(?=\s|$)|(?:\n\n+)/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = pattern.exec(rest)) !== null) {
    const end = match.index + match[0].length;
    const piece = rest.slice(lastIndex, end).trim();
    if (piece) chunks.push(piece);
    lastIndex = end;
  }

  rest = rest.slice(lastIndex);

  if (opts.flush) {
    const tail = rest.trim();
    if (tail) chunks.push(tail);
    rest = "";
  } else if (rest.length > 180) {
    // Long clause without punctuation — speak a breath-group so we don't stall.
    const cut = rest.lastIndexOf(" ", 140);
    if (cut > 40) {
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut);
    }
  }

  return { chunks, rest };
}
