import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  getDeepgramKey,
  getAssemblyAIKey,
  type SttEngine,
} from "./settings";
import { micAudioConstraints } from "@/lib/utils";

export interface StreamingHandlers {
  /**
   * Interim (not-yet-final) transcript text for the current utterance.
   * `speaker` is the diarized speaker label (e.g. "Speaker 1") when the engine
   * detected one, else undefined.
   */
  onPartial?: (text: string, speaker?: string) => void;
  /** A finalized utterance/turn, with the detected speaker when available. */
  onFinal?: (text: string, speaker?: string) => void;
  /**
   * The speaker appears to have finished their TURN, not merely a transcript
   * segment. Deepgram exposes two independent end-of-speech signals and this
   * fires for either (see `startDeepgram` for why both are wired up):
   *  - `speech_final: true` on a Results message — audio-level endpointing
   *  - an `UtteranceEnd` message — derived from word timings, so it survives
   *    non-speech noise (a door, a ringtone) that keeps the VAD "hot"
   *
   * `reason` says which fired. Deepgram's own docs are explicit that any
   * end-of-turn scheme like this "is a heuristic one and may fail in rare
   * situations", so treat it as a strong hint, not ground truth.
   */
  onTurnEnd?: (reason: "speech_final" | "utterance_end") => void;
  onOpen?: () => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

/**
 * Silence (ms) after which Deepgram emits `UtteranceEnd`. Deepgram's docs:
 * "You should set the value of `utterance_end_ms` to be `1000` ms or higher."
 * 1100 matches `TURN_DEFAULTS.gapMs` in src/lib/live/turns.ts so the two
 * turn-boundary mechanisms agree instead of racing each other.
 */
const UTTERANCE_END_MS = 1100;

/**
 * Pick the dominant speaker for a set of Deepgram words. Deepgram labels each
 * word with a 0-indexed `speaker`; we surface a friendly 1-indexed label.
 */
function dominantSpeakerLabel(words: any): string | undefined {
  if (!Array.isArray(words) || words.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const w of words) {
    if (typeof w?.speaker === "number") {
      counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return undefined;
  let best = -1;
  let bestCount = -1;
  for (const [speaker, count] of counts) {
    if (count > bestCount) {
      best = speaker;
      bestCount = count;
    }
  }
  return best >= 0 ? `Speaker ${best + 1}` : undefined;
}

export interface StreamingSession {
  /** Push a chunk of 16-bit little-endian mono PCM. */
  pushPcm16: (data: Int16Array) => void;
  stop: () => Promise<void>;
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Open a Deepgram Nova-3 streaming websocket (browser subprotocol auth). */
async function startDeepgram(
  sampleRate: number,
  handlers: StreamingHandlers,
  language = "en"
): Promise<StreamingSession> {
  const key = getDeepgramKey();
  if (!key) throw new Error("Missing Deepgram API key");

  // Nova-3 auto-detects only when using multilingual; otherwise pin the code.
  const dgLanguage = language === "multi" ? "multi" : language;
  const params = new URLSearchParams({
    model: "nova-3",
    language: dgLanguage,
    encoding: "linear16",
    sample_rate: String(sampleRate),
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    // Speaker diarization: Deepgram tags each word with a speaker index so we
    // can attribute turns to "Speaker 1", "Speaker 2", … in the transcript.
    diarize: "true",
    // End-of-TURN detection, so the copilot can react to a finished thought
    // rather than to each transcript segment. `utterance_end_ms` is derived from
    // word timings, which is why it's worth having alongside audio endpointing:
    // it ignores non-speech noise (a knock at the door, a ringing phone) that
    // would otherwise stop `speech_final` from ever firing. It REQUIRES
    // interim_results, which is already on above.
    utterance_end_ms: String(UTTERANCE_END_MS),
  });
  console.debug(
    `[stt] Deepgram connecting: sample_rate=${sampleRate} language=${dgLanguage}`
  );
  const ws = new WebSocket(
    `wss://api.deepgram.com/v1/listen?${params.toString()}`,
    ["token", key]
  );
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    console.debug("[stt] Deepgram websocket open");
    handlers.onOpen?.();
  };
  ws.onerror = (e) => {
    console.error("[stt] Deepgram websocket error", e);
    handlers.onError?.("Deepgram connection error");
  };
  ws.onclose = (e) => {
    console.debug("[stt] Deepgram websocket closed", e.code, e.reason);
    handlers.onClose?.();
  };
  // `speech_final` and `UtteranceEnd` fire independently, and both can fire for
  // the same turn. Deepgram's recommended logic: trust `speech_final` when it
  // arrives, and treat an `UtteranceEnd` with no preceding `speech_final` as the
  // boundary instead. This flag is what implements "no preceding".
  let sawSpeechFinal = false;
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "UtteranceEnd") {
        // Word-timing based. Only meaningful if audio endpointing didn't already
        // close this turn, otherwise we'd signal the same boundary twice.
        if (!sawSpeechFinal) handlers.onTurnEnd?.("utterance_end");
        sawSpeechFinal = false;
        return;
      }
      if (msg.type === "Results") {
        const alt = msg.channel?.alternatives?.[0];
        const text: string = alt?.transcript ?? "";
        // Deepgram sends empty-transcript Results during silence; those carry no
        // text but CAN carry speech_final, which is exactly the turn boundary —
        // so check it before bailing out on empty text.
        if (msg.speech_final) {
          sawSpeechFinal = true;
        }
        if (!text) {
          if (msg.speech_final) handlers.onTurnEnd?.("speech_final");
          return;
        }
        const speaker = dominantSpeakerLabel(alt?.words);
        if (msg.is_final) handlers.onFinal?.(text, speaker);
        else handlers.onPartial?.(text, speaker);
        // After the text, so a consumer that flushes on turn end already has it.
        if (msg.speech_final) handlers.onTurnEnd?.("speech_final");
      }
    } catch {
      // ignore non-JSON frames
    }
  };

  return {
    pushPcm16: (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data.buffer);
    },
    stop: async () => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "CloseStream" }));
        }
      } catch {
        // ignore
      }
      ws.close();
    },
  };
}

/**
 * Transcribe a single audio chunk with Deepgram's BATCH API, with speaker
 * diarization enabled. Returns the transcript plus the dominant speaker label
 * (e.g. "Speaker 1") so the live overlay can attribute the turn to who spoke,
 * using Deepgram's diarization rather than a hardcoded source label.
 */
export async function transcribeDeepgramDiarized(
  audio: Blob,
  apiKey: string,
  language = "en"
): Promise<{ text: string; speaker?: string }> {
  const buf = await audio.arrayBuffer();
  // Very short/empty clips (VAD noise) aren't transcribable — treat as silence
  // rather than throwing, so the occasional junk chunk doesn't surface an error.
  if (!buf || buf.byteLength < 1200) {
    return { text: "", speaker: undefined };
  }

  const params = new URLSearchParams({
    model: "nova-3",
    language: language === "multi" ? "multi" : language,
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
  });
  const body = new Blob([buf], { type: audio.type || "audio/wav" });

  // One transparent retry for transient network/edge hiccups.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await tauriFetch(
        `https://api.deepgram.com/v1/listen?${params.toString()}`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": "audio/wav",
          },
          body,
        }
      );
      if (!res.ok) {
        // 400 = unusable/corrupt clip → treat as silence (don't interrupt the
        // user). Auth failures (401) surface so a bad key is obvious.
        if (res.status === 400) return { text: "", speaker: undefined };
        const detail = await res.text().catch(() => "");
        throw new Error(`Deepgram diarize failed (${res.status}): ${detail}`);
      }
      const json: any = await res.json();
      const alt = json?.results?.channels?.[0]?.alternatives?.[0];
      const text: string = (alt?.transcript ?? "").trim();
      return { text, speaker: dominantSpeakerLabel(alt?.words) };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/\b401\b/.test(msg)) break; // bad key won't fix on retry
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Deepgram diarize failed");
}

/** Fetch a short-lived AssemblyAI streaming token (browser can't send headers on WS). */
async function getAssemblyToken(key: string): Promise<string> {
  const res = await tauriFetch(
    "https://streaming.assemblyai.com/v3/token?expires_in_seconds=600",
    { method: "GET", headers: { Authorization: key } }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AssemblyAI token failed (${res.status}): ${detail}`);
  }
  const json: any = await res.json();
  const token = json?.token;
  if (!token) throw new Error("AssemblyAI token missing in response");
  return token;
}

/** Open an AssemblyAI Universal-Streaming websocket (temp-token auth). */
async function startAssemblyAI(
  sampleRate: number,
  handlers: StreamingHandlers,
  language = "en"
): Promise<StreamingSession> {
  const key = getAssemblyAIKey();
  if (!key) throw new Error("Missing AssemblyAI API key");

  const token = await getAssemblyToken(key);
  // AssemblyAI streaming only offers English vs. multilingual models, so any
  // non-English (or auto) selection uses the multilingual model.
  const isEnglish = language === "en";
  const params = new URLSearchParams({
    speech_model: isEnglish
      ? "universal-streaming-english"
      : "universal-streaming-multilingual",
    language: isEnglish ? "en" : "multi",
    sample_rate: String(sampleRate),
    encoding: "pcm_s16le",
    format_turns: "true",
    token,
  });
  console.debug(
    `[stt] AssemblyAI connecting: sample_rate=${sampleRate} language=${
      isEnglish ? "en" : "multi"
    }`
  );
  const ws = new WebSocket(
    `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`
  );
  ws.binaryType = "arraybuffer";

  ws.onopen = () => handlers.onOpen?.();
  ws.onerror = () => handlers.onError?.("AssemblyAI connection error");
  ws.onclose = () => handlers.onClose?.();
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "Turn") {
        const text: string = msg.transcript ?? "";
        if (!text) return;
        if (msg.end_of_turn) handlers.onFinal?.(text);
        else handlers.onPartial?.(text);
      }
    } catch {
      // ignore
    }
  };

  return {
    pushPcm16: (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data.buffer);
    },
    stop: async () => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "Terminate" }));
        }
      } catch {
        // ignore
      }
      ws.close();
    },
  };
}

export async function startStreamingSession(
  engine: SttEngine,
  sampleRate: number,
  handlers: StreamingHandlers,
  language = "en"
): Promise<StreamingSession> {
  if (engine === "deepgram")
    return startDeepgram(sampleRate, handlers, language);
  if (engine === "assemblyai")
    return startAssemblyAI(sampleRate, handlers, language);
  throw new Error(`Engine ${engine} is not a streaming provider`);
}

export interface MicTranscription {
  stop: () => Promise<void>;
}

/**
 * Capture the microphone and stream it to the chosen provider. Fully
 * self-contained so both providers can be A/B tested from settings.
 */
export async function startMicTranscription(
  engine: SttEngine,
  handlers: StreamingHandlers,
  language = "en",
  deviceId?: string
): Promise<MicTranscription> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { ...micAudioConstraints(deviceId), channelCount: 1 },
  });

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  // Prefer 16 kHz; some webviews ignore this and keep the hardware rate, so we
  // always read back the actual rate and send THAT to the provider.
  let ctx: AudioContext;
  try {
    ctx = new AudioCtx({ sampleRate: 16000 });
  } catch {
    ctx = new AudioCtx();
  }
  const sampleRate = ctx.sampleRate;
  console.debug(`[stt] mic AudioContext sampleRate=${sampleRate}`);

  let session: StreamingSession | null = null;
  let stopped = false;
  try {
    session = await startStreamingSession(engine, sampleRate, handlers, language);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => {});
    throw err;
  }

  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  // Route through a muted gain node so the processor runs without echoing the
  // mic back through the speakers.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  let frames = 0;
  processor.onaudioprocess = (e) => {
    if (stopped || !session) return;
    const input = e.inputBuffer.getChannelData(0);
    if (frames++ === 0) console.debug("[stt] first audio frame captured");
    session.pushPcm16(floatTo16BitPCM(input));
  };
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  // The context often starts "suspended"; without resuming, onaudioprocess
  // never fires and no audio is sent (no transcript, no error).
  if (ctx.state === "suspended") {
    await ctx.resume().catch(() => {});
  }
  console.debug(`[stt] AudioContext state=${ctx.state}`);

  // Quietly log (don't clutter the UI) if no audio is flowing shortly after
  // start — silence during a session is normal and shouldn't show an error.
  setTimeout(() => {
    if (!stopped && frames === 0) {
      console.warn(
        "[stt] no microphone audio captured yet (check input device / mic permission)"
      );
    }
  }, 2500);

  return {
    stop: async () => {
      stopped = true;
      try {
        processor.disconnect();
        source.disconnect();
        mute.disconnect();
      } catch {
        // ignore
      }
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close().catch(() => {});
      await session?.stop();
    },
  };
}
