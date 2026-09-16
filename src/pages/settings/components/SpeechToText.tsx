import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import {
  Button,
  Header,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components";
import {
  DEFAULT_STT_OPENAI_BASE_URL,
  DEFAULT_STT_OPENAI_MODEL,
  STT_ENGINES,
  STT_LANGUAGES,
  getAssemblyAIKey,
  getDeepgramKey,
  getGoogleSttKey,
  getOpenAISttKey,
  getSttEngine,
  getSttLanguage,
  setAssemblyAIKey,
  setDeepgramKey,
  setGoogleSttKey,
  setOpenAISttBaseUrl,
  setOpenAISttKey,
  setOpenAISttModel,
  setSttEngine,
  setSttLanguage,
  type SttEngine,
} from "@/lib/stt";
import { safeLocalStorage } from "@/lib/storage";
import { STORAGE_KEYS } from "@/config";
import {
  FolderOpen,
  ExternalLink,
  Copy,
  Check,
  CloudUploadIcon,
} from "lucide-react";

/** Where to grab a GGML whisper model. */
const MODELS_URL = "https://huggingface.co/ggerganov/whisper.cpp/tree/main";
/** A sensible default for most machines (English, ~148 MB). */
const RECOMMENDED_MODEL = "ggml-base.en.bin";

/**
 * Speech-to-text settings.
 *
 * Two shapes of configuration live here, which is why the panel changes as you
 * switch engines. The on-device engine's "value" is a model FILE: you download a
 * GGML model once and drop it in the app's models folder, so it needs a path and
 * a download link. The cloud engines want a key (and, for the OpenAI-compatible
 * one, a base URL and model), so they get text fields.
 *
 * The keys typed here are written straight to this device's local storage and
 * are deliberately NOT synced, unlike the language preference. They are the
 * user's own provider credentials.
 */
export const SpeechToText = () => {
  const [modelsDir, setModelsDir] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [engine, setEngine] = useState<SttEngine>(() => getSttEngine());
  const [language, setLanguage] = useState<string>(() => getSttLanguage());

  // Per-engine credentials, read once and written on every keystroke (same
  // as the AI provider panel — there is no Save button anywhere in Settings).
  const [openaiKey, setOpenaiKey] = useState(() => getOpenAISttKey());
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState(
    () => safeLocalStorage.getItem(STORAGE_KEYS.STT_OPENAI_BASE_URL) || ""
  );
  const [openaiModel, setOpenaiModel] = useState(
    () => safeLocalStorage.getItem(STORAGE_KEYS.STT_OPENAI_MODEL) || ""
  );
  const [googleKey, setGoogleKey] = useState(() => getGoogleSttKey());
  const [deepgramKey, setDeepgramKeyState] = useState(() => getDeepgramKey());
  const [assemblyKey, setAssemblyKeyState] = useState(() => getAssemblyAIKey());

  const info = STT_ENGINES.find((e) => e.id === engine);
  const isLocal = engine === "whisper";

  useEffect(() => {
    invoke<string>("whisper_models_dir")
      .then(setModelsDir)
      .catch(() => setModelsDir(""));
  }, []);

  const copyPath = async () => {
    if (!modelsDir) return;
    try {
      await navigator.clipboard.writeText(modelsDir);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard may be unavailable
    }
  };

  const changeEngine = (value: string) => {
    const next = value as SttEngine;
    setEngine(next);
    setSttEngine(next);
  };

  const changeLanguage = (value: string) => {
    setLanguage(value);
    setSttLanguage(value);
  };

  return (
    <div id="speech-to-text" className="space-y-4">
      <Header
        title="Speech-to-Text"
        description={
          isLocal
            ? "Transcription runs entirely on your device with whisper.cpp — no cloud, no API key, and nothing leaves your machine. Download a whisper model once and drop it in the folder below."
            : "Transcription runs on the provider you pick below, using your own account and API key. Audio from your calls is sent to that provider; switch back to whisper.cpp for fully offline transcription."
        }
        isMainTitle
      />

      <div className="space-y-2">
        <Label className="text-sm font-medium">Engine</Label>
        <Select value={engine} onValueChange={changeEngine}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an engine" />
          </SelectTrigger>
          <SelectContent>
            {STT_ENGINES.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {info?.hint && (
          <p className="text-xs text-muted-foreground">{info.hint}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Language</Label>
        <Select value={language} onValueChange={changeLanguage}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a language" />
          </SelectTrigger>
          <SelectContent>
            {STT_LANGUAGES.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── On-device: point at the models folder ─────────────────────────── */}
      {isLocal && (
        <div className="space-y-3">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Download a GGML model (start with{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {RECOMMENDED_MODEL}
              </code>
              ).
            </li>
            <li>Move the downloaded file into your models folder.</li>
            <li>Start a call — transcription works offline from then on.</li>
          </ol>

          <div className="rounded-lg border border-border/60 bg-background/60 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Models folder
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                {modelsDir || "Resolving…"}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={copyPath}
                disabled={!modelsDir}
                aria-label="Copy models folder path"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => modelsDir && openPath(modelsDir).catch(() => {})}
              disabled={!modelsDir}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              Open models folder
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openUrl(MODELS_URL).catch(() => {})}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Download a model
            </Button>
          </div>
        </div>
      )}

      {/* ── Cloud engines: credentials ────────────────────────────────────── */}
      {engine === "openai" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">API key</Label>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your API key (leave empty for a local server)"
              value={openaiKey}
              onChange={(e) => {
                setOpenaiKey(e.target.value);
                setOpenAISttKey(e.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Base URL</Label>
            <Input
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={DEFAULT_STT_OPENAI_BASE_URL}
              value={openaiBaseUrl}
              onChange={(e) => {
                setOpenaiBaseUrl(e.target.value);
                setOpenAISttBaseUrl(e.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Model</Label>
            <Input
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={DEFAULT_STT_OPENAI_MODEL}
              value={openaiModel}
              onChange={(e) => {
                setOpenaiModel(e.target.value);
                setOpenAISttModel(e.target.value);
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Anything that implements <code>POST /audio/transcriptions</code>
            works here. Leave the last two empty for OpenAI itself.
          </p>
        </div>
      )}

      {engine === "google" && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">API key</Label>
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your Google Cloud API key"
            value={googleKey}
            onChange={(e) => {
              setGoogleKey(e.target.value);
              setGoogleSttKey(e.target.value);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Needs the Speech-to-Text API enabled on the project the key belongs
            to. Auto-detect isn't available on this endpoint, so it falls back to
            English — pick a language above.
          </p>
        </div>
      )}

      {engine === "deepgram" && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">API key</Label>
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your Deepgram API key"
            value={deepgramKey}
            onChange={(e) => {
              setDeepgramKeyState(e.target.value);
              setDeepgramKey(e.target.value);
            }}
          />
        </div>
      )}

      {engine === "assemblyai" && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">API key</Label>
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your AssemblyAI API key"
            value={assemblyKey}
            onChange={(e) => {
              setAssemblyKeyState(e.target.value);
              setAssemblyAIKey(e.target.value);
            }}
          />
        </div>
      )}

      {!isLocal && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <CloudUploadIcon className="mt-0.5 size-3.5 shrink-0" />
          Your key is stored on this device only and is never synced. Audio is
          sent to {info?.label ?? "your provider"} for transcription, so their
          privacy policy applies to it.
        </p>
      )}
    </div>
  );
};
