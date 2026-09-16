import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  getAssemblyAIKey,
  getDeepgramKey,
  getGoogleSttKey,
  getOpenAISttBaseUrl,
  getOpenAISttKey,
  getOpenAISttModel,
  type SttEngine,
} from "./settings";
import { transcribeDeepgramDiarized } from "./streaming";

/**
 * Cloud speech-to-text, batch mode.
 *
 * The on-device engine (whisper.cpp) is still the default and still the one this
 * app is built around. These are here because plenty of people already pay for a
 * transcription API and would rather use it than manage a model file — so every
 * engine below runs on the USER's own account and key. Audio does leave the
 * machine when one is selected; the Settings panel says so in as many words.
 *
 * "Batch" means one HTTP round trip per clip, from the same 16 kHz mono WAV the
 * local engine gets (see fetchSTT). The live streaming sockets in streaming.ts
 * are a separate path and are not wired into this dispatch.
 *
 * All requests go through the Tauri HTTP plugin rather than the webview's fetch:
 * these hosts don't send CORS headers, so a plain browser fetch from
 * tauri://localhost would be blocked before it left.
 */

/** Clips this small are VAD noise, not speech — don't spend a request on them. */
const MIN_CLIP_BYTES = 1200;

export interface CloudSttResult {
  text: string;
  /** Only Deepgram diarizes here, so only Deepgram fills this in. */
  speaker?: string;
}

/**
 * Google's v1 `recognize` needs a concrete BCP-47 tag, so the app's short codes
 * get a region. Anything not listed is passed through unchanged, which is what
 * Google wants for the tags that have no region (e.g. "zh").
 */
const GOOGLE_LANGUAGE_TAGS: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  pt: "pt-BR",
  it: "it-IT",
  nl: "nl-NL",
  hi: "hi-IN",
  ja: "ja-JP",
  ko: "ko-KR",
  ru: "ru-RU",
};

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000; // avoid arg-count limits on String.fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

/** Trim a provider's error body so a wall of HTML can't become a toast. */
async function errorDetail(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  return body.slice(0, 300);
}

/**
 * Any endpoint implementing OpenAI's `POST /audio/transcriptions` — OpenAI
 * itself, Groq, or a local server. Sent as multipart/form-data; the Content-Type
 * (with its boundary) is deliberately left to the FormData encoder.
 */
async function transcribeOpenAICompatible(
  wav: Blob,
  language: string,
  signal?: AbortSignal
): Promise<CloudSttResult> {
  const key = getOpenAISttKey();
  const form = new FormData();
  form.append("file", new File([wav], "audio.wav", { type: "audio/wav" }));
  form.append("model", getOpenAISttModel());
  form.append("response_format", "json");
  // "multi" means auto-detect, which is what these endpoints do when the
  // parameter is absent.
  if (language && language !== "multi") form.append("language", language);

  const res = await tauriFetch(`${getOpenAISttBaseUrl()}/audio/transcriptions`, {
    method: "POST",
    // A local OpenAI-compatible server usually wants no key at all.
    headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    body: form,
    signal,
  });
  if (!res.ok) {
    throw new Error(
      `Transcription failed (${res.status}): ${await errorDetail(res)}`
    );
  }
  const json: any = await res.json();
  return { text: (json?.text ?? "").trim() };
}

/**
 * Google Cloud Speech-to-Text v1, synchronous `recognize`, authenticated with an
 * API key. `encoding` and `sampleRateHertz` are intentionally omitted: the audio
 * is a WAV, and Google reads those from its header.
 */
async function transcribeGoogle(
  wav: Blob,
  language: string,
  signal?: AbortSignal
): Promise<CloudSttResult> {
  const key = getGoogleSttKey();
  if (!key) throw new Error("Add your Google Speech-to-Text API key in Settings.");

  // v1 recognize has no auto-detect, so "multi" lands on English rather than
  // failing the request outright.
  const code = language === "multi" ? "en" : language;
  const languageCode = GOOGLE_LANGUAGE_TAGS[code] ?? code;

  const res = await tauriFetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: { languageCode, enableAutomaticPunctuation: true },
        audio: { content: base64FromArrayBuffer(await wav.arrayBuffer()) },
      }),
      signal,
    }
  );
  if (!res.ok) {
    throw new Error(
      `Google Speech-to-Text failed (${res.status}): ${await errorDetail(res)}`
    );
  }
  const json: any = await res.json();
  // No `results` at all is Google's way of saying "no speech in that clip".
  const text: string = (json?.results ?? [])
    .map((r: any) => r?.alternatives?.[0]?.transcript ?? "")
    .join(" ")
    .trim();
  return { text };
}

/** How long to wait for one AssemblyAI transcript before giving up. */
const ASSEMBLY_POLL_TIMEOUT_MS = 90_000;
const ASSEMBLY_POLL_INTERVAL_MS = 800;

/**
 * AssemblyAI's batch flow is three calls — upload, create, poll — so it is the
 * slowest engine here by a few seconds per clip. Worth saying out loud in the
 * UI rather than letting it look like a hang.
 */
async function transcribeAssemblyAI(
  wav: Blob,
  language: string,
  signal?: AbortSignal
): Promise<CloudSttResult> {
  const key = getAssemblyAIKey();
  if (!key) throw new Error("Add your AssemblyAI API key in Settings.");
  const auth = { Authorization: key };

  const uploadRes = await tauriFetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/octet-stream" },
    body: wav,
    signal,
  });
  if (!uploadRes.ok) {
    throw new Error(
      `AssemblyAI upload failed (${uploadRes.status}): ${await errorDetail(uploadRes)}`
    );
  }
  const uploadUrl: string | undefined = (await uploadRes.json())?.upload_url;
  if (!uploadUrl) throw new Error("AssemblyAI upload returned no URL");

  throwIfAborted(signal);
  const createRes = await tauriFetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(
      language === "multi"
        ? { audio_url: uploadUrl, language_detection: true }
        : { audio_url: uploadUrl, language_code: language }
    ),
    signal,
  });
  if (!createRes.ok) {
    throw new Error(
      `AssemblyAI transcript failed (${createRes.status}): ${await errorDetail(createRes)}`
    );
  }
  const id: string | undefined = (await createRes.json())?.id;
  if (!id) throw new Error("AssemblyAI transcript returned no id");

  const deadline = Date.now() + ASSEMBLY_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    await new Promise((r) => setTimeout(r, ASSEMBLY_POLL_INTERVAL_MS));
    const pollRes = await tauriFetch(
      `https://api.assemblyai.com/v2/transcript/${id}`,
      { method: "GET", headers: auth, signal }
    );
    if (!pollRes.ok) {
      throw new Error(
        `AssemblyAI poll failed (${pollRes.status}): ${await errorDetail(pollRes)}`
      );
    }
    const json: any = await pollRes.json();
    if (json?.status === "completed") return { text: (json?.text ?? "").trim() };
    if (json?.status === "error") {
      throw new Error(`AssemblyAI error: ${json?.error ?? "unknown"}`);
    }
  }
  throw new Error("AssemblyAI timed out waiting for the transcript");
}

/**
 * Transcribe one clip with the selected cloud engine. `wav` must already be the
 * normalized 16 kHz mono WAV — every provider here accepts it as-is.
 *
 * Never called for `whisper`; that path stays in fetchSTT.
 */
export async function transcribeCloudBatch(
  engine: Exclude<SttEngine, "whisper">,
  wav: Blob,
  language: string,
  signal?: AbortSignal
): Promise<CloudSttResult> {
  throwIfAborted(signal);
  if (wav.size < MIN_CLIP_BYTES) return { text: "" };

  switch (engine) {
    case "openai":
      return transcribeOpenAICompatible(wav, language, signal);
    case "google":
      return transcribeGoogle(wav, language, signal);
    case "deepgram": {
      const key = getDeepgramKey();
      if (!key) throw new Error("Add your Deepgram API key in Settings.");
      // Already implemented for the live overlay, and it diarizes — reused
      // rather than written twice.
      return transcribeDeepgramDiarized(wav, key, language);
    }
    case "assemblyai":
      return transcribeAssemblyAI(wav, language, signal);
  }
}
