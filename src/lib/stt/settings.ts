import { safeLocalStorage } from "@/lib/storage";
import { STORAGE_KEYS } from "@/config";
import { setSyncedItem } from "@/lib/sync/kv";

export type SttEngine =
  | "whisper"
  | "openai"
  | "google"
  | "deepgram"
  | "assemblyai";

export interface SttEngineInfo {
  id: SttEngine;
  label: string;
  /** True when the provider also has a live streaming API (see streaming.ts). */
  streaming: boolean;
  /** False for the on-device engine — everything else needs a key from the user. */
  cloud: boolean;
  /** One line shown under the picker in Settings. */
  hint: string;
}

/**
 * The transcription engines this build can use.
 *
 * `whisper` is the default and the only one that needs nothing: it runs
 * whisper.cpp on this machine. The rest are the user's own cloud accounts —
 * their key, their bill, their provider's privacy policy. Audio does leave the
 * machine when one is selected, which is why the Settings panel says so and why
 * nothing here is opt-out.
 */
export const STT_ENGINES: SttEngineInfo[] = [
  {
    id: "whisper",
    label: "whisper.cpp (on this device)",
    streaming: false,
    cloud: false,
    hint: "Runs offline from a model file you download once. Nothing leaves your machine.",
  },
  {
    id: "openai",
    label: "OpenAI-compatible (Whisper, Groq, local server)",
    streaming: false,
    cloud: true,
    hint: "Any endpoint that implements /audio/transcriptions — OpenAI, Groq, or your own server.",
  },
  {
    id: "google",
    label: "Google Cloud Speech-to-Text",
    streaming: false,
    cloud: true,
    hint: "Uses an API key on the Speech-to-Text v1 recognize endpoint.",
  },
  {
    id: "deepgram",
    label: "Deepgram Nova-3",
    streaming: true,
    cloud: true,
    hint: "Fast, and the only engine here that labels who spoke.",
  },
  {
    id: "assemblyai",
    label: "AssemblyAI",
    streaming: true,
    cloud: true,
    hint: "Upload-then-poll, so expect a few seconds more per clip than the others.",
  },
];

/** Default endpoint for the OpenAI-compatible engine. */
export const DEFAULT_STT_OPENAI_BASE_URL = "https://api.openai.com/v1";
/** Default model for the OpenAI-compatible engine. */
export const DEFAULT_STT_OPENAI_MODEL = "whisper-1";

/**
 * Transcription languages offered in the UI. "multi" = auto-detect /
 * multilingual. Deepgram supports specific codes directly; AssemblyAI streaming
 * only distinguishes English vs. multilingual, so non-English codes fall back to
 * its multilingual model.
 */
export const STT_LANGUAGES: { id: string; label: string }[] = [
  { id: "multi", label: "Auto-detect (multilingual)" },
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "pt", label: "Portuguese" },
  { id: "it", label: "Italian" },
  { id: "nl", label: "Dutch" },
  { id: "hi", label: "Hindi" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "zh", label: "Chinese" },
  { id: "ru", label: "Russian" },
];

export function getSttLanguage(): string {
  return safeLocalStorage.getItem(STORAGE_KEYS.STT_LANGUAGE) || "en";
}

export function setSttLanguage(code: string): void {
  // Language is a pure preference (no secret, not hardware-bound) so it syncs.
  // The engine choice + provider keys stay device-local.
  setSyncedItem(STORAGE_KEYS.STT_LANGUAGE, code);
}

export function getSttEngine(): SttEngine {
  const v = safeLocalStorage.getItem(STORAGE_KEYS.STT_ENGINE);
  const known = STT_ENGINES.find((e) => e.id === v);
  return known ? known.id : "whisper";
}

export function setSttEngine(engine: SttEngine): void {
  safeLocalStorage.setItem(STORAGE_KEYS.STT_ENGINE, engine);
}

export function isStreamingEngine(engine: SttEngine = getSttEngine()): boolean {
  return engine === "deepgram" || engine === "assemblyai";
}

export function getDeepgramKey(): string {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.DEEPGRAM_API_KEY);
  return stored && stored.trim() ? stored.trim() : "";
}

export function setDeepgramKey(key: string): void {
  safeLocalStorage.setItem(STORAGE_KEYS.DEEPGRAM_API_KEY, key.trim());
}

export function getAssemblyAIKey(): string {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.ASSEMBLYAI_API_KEY);
  return stored && stored.trim() ? stored.trim() : "";
}

export function setAssemblyAIKey(key: string): void {
  safeLocalStorage.setItem(STORAGE_KEYS.ASSEMBLYAI_API_KEY, key.trim());
}

export function getOpenAISttKey(): string {
  return (safeLocalStorage.getItem(STORAGE_KEYS.STT_OPENAI_API_KEY) || "").trim();
}

export function setOpenAISttKey(key: string): void {
  safeLocalStorage.setItem(STORAGE_KEYS.STT_OPENAI_API_KEY, key.trim());
}

/** Base URL of the OpenAI-compatible endpoint, without a trailing slash. */
export function getOpenAISttBaseUrl(): string {
  const stored = (
    safeLocalStorage.getItem(STORAGE_KEYS.STT_OPENAI_BASE_URL) || ""
  ).trim();
  return (stored || DEFAULT_STT_OPENAI_BASE_URL).replace(/\/+$/, "");
}

export function setOpenAISttBaseUrl(url: string): void {
  safeLocalStorage.setItem(STORAGE_KEYS.STT_OPENAI_BASE_URL, url.trim());
}

export function getOpenAISttModel(): string {
  const stored = (
    safeLocalStorage.getItem(STORAGE_KEYS.STT_OPENAI_MODEL) || ""
  ).trim();
  return stored || DEFAULT_STT_OPENAI_MODEL;
}

export function setOpenAISttModel(model: string): void {
  safeLocalStorage.setItem(STORAGE_KEYS.STT_OPENAI_MODEL, model.trim());
}

export function getGoogleSttKey(): string {
  return (safeLocalStorage.getItem(STORAGE_KEYS.STT_GOOGLE_API_KEY) || "").trim();
}

export function setGoogleSttKey(key: string): void {
  safeLocalStorage.setItem(STORAGE_KEYS.STT_GOOGLE_API_KEY, key.trim());
}

export function getEngineKey(engine: SttEngine): string {
  if (engine === "deepgram") return getDeepgramKey();
  if (engine === "assemblyai") return getAssemblyAIKey();
  if (engine === "openai") return getOpenAISttKey();
  if (engine === "google") return getGoogleSttKey();
  return "";
}

/**
 * True when the selected engine can actually run. Only the cloud engines can be
 * misconfigured this way — whisper.cpp fails later, in Rust, with its own
 * "install a model" message.
 */
export function isEngineConfigured(engine: SttEngine = getSttEngine()): boolean {
  if (engine === "whisper") return true;
  // A local OpenAI-compatible server usually wants no key at all, so a custom
  // base URL counts as configured on its own.
  if (engine === "openai") {
    return (
      !!getOpenAISttKey() ||
      getOpenAISttBaseUrl() !== DEFAULT_STT_OPENAI_BASE_URL
    );
  }
  return !!getEngineKey(engine);
}
