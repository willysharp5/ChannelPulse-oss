import { invoke } from "@tauri-apps/api/core";
import { floatArrayToWav } from "@/lib/utils";
import type { SttResult } from "@/lib/backend";
import { getSttEngine, getSttLanguage } from "@/lib/stt/settings";
import { transcribeCloudBatch } from "@/lib/stt/cloud";

/**
 * The one funnel every recorder in the app goes through for speech-to-text.
 *
 * By default it runs on-device via whisper.cpp (the Rust `transcribe_wav`
 * command): no cloud, no API key, nothing leaves the machine. The user supplies
 * a GGML model file once; see the README and the Speech-to-Text settings for
 * where to place it.
 *
 * If the user picks one of the cloud engines in Settings instead, the same clip
 * is sent to THEIR provider on THEIR key (see lib/stt/cloud.ts). That is opt-in
 * and off by default, because it means audio leaves the machine.
 *
 * The various recorders hand us audio in whatever format their
 * MediaRecorder/WebAudio pipeline produced (16 kHz WAV, 48 kHz WAV, or
 * webm/ogg/opus). We normalize everything here to 16 kHz mono 16-bit WAV, which
 * is what whisper expects and what every cloud engine accepts — so neither side
 * has to care where the audio came from.
 */

const TARGET_SAMPLE_RATE = 16000;

export interface STTParams {
  audio: File | Blob;
  /** Lets a caller bail out before the (blocking) transcription starts. */
  signal?: AbortSignal;
}

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000; // avoid arg-count limits on String.fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Decode arbitrary recorded audio and re-encode it as a 16 kHz mono 16-bit WAV.
 */
async function normalizeToWav16k(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();

  const AudioCtx: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const decodeCtx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    // slice(0) hands decodeAudioData its own copy (it detaches the buffer).
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    // Best-effort; close() is async and not present on every webview.
    void decodeCtx.close?.();
  }

  // Downmix to mono and resample to 16 kHz with an OfflineAudioContext, which
  // does high-quality resampling for us regardless of the source rate.
  const frameCount = Math.max(
    1,
    Math.ceil(decoded.duration * TARGET_SAMPLE_RATE)
  );
  const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  const mono = rendered.getChannelData(0);
  return floatArrayToWav(mono, TARGET_SAMPLE_RATE, "wav");
}

/**
 * Transcribe audio with whichever engine the user selected. On-device whisper
 * throws a clear error (surfaced to the user) when no model file has been
 * installed yet; the cloud engines throw when their key is missing.
 */
export async function fetchSTT(params: STTParams): Promise<string> {
  return (await fetchSTTRich(params)).transcript;
}

/**
 * Rich variant used by the live overlay. On-device whisper does not diarize or
 * extract entities, so there only the transcript is populated — speaker
 * attribution ("You" vs "Them") comes from the capture source (mic vs system
 * audio), which the caller already knows. Deepgram does diarize, so when that
 * engine is selected its speaker label is passed through.
 */
export async function fetchSTTRich(params: STTParams): Promise<SttResult> {
  if (params.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const wav = await normalizeToWav16k(params.audio);
  if (params.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const engine = getSttEngine();
  if (engine !== "whisper") {
    const { text, speaker } = await transcribeCloudBatch(
      engine,
      wav,
      getSttLanguage(),
      params.signal
    );
    return { transcript: text.trim(), speaker };
  }

  const wavBase64 = base64FromArrayBuffer(await wav.arrayBuffer());
  const result = await invoke<{ transcript: string }>("transcribe_wav", {
    wavBase64,
  });
  return { transcript: (result?.transcript ?? "").trim() };
}
