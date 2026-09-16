import { useEffect, useState, useCallback, useRef } from "react";
import { useWindowResize, useGlobalShortcuts } from ".";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "@/contexts";
import { fetchSTTRich, fetchAIResponse } from "@/lib/functions";
import { backendReadIntelligence, type SttIntelligence } from "@/lib/backend";
import { getSttLanguage } from "@/lib/stt";
import { setSyncedItem } from "@/lib/sync/kv";
import { px } from "@/lib/prompts/overrides";
import {
  DEFAULT_QUICK_ACTIONS,
  DEFAULT_SYSTEM_PROMPT,
  CHAT_ANALYSIS_SYSTEM_PROMPT,
  buildCopilotSystemPrompt,
  buildInterviewSystemPrompt,
  STORAGE_KEYS,
  SCENARIO_PROMPTS,
  type ScenarioKey,
} from "@/config";
import {
  detectScenario,
  generateConversationLabel,
  resolveLiveScenario,
  isInterviewCandidateScenario,
} from "@/lib/scenario";
import {
  safeLocalStorage,
  shouldUseChannelPulseAPI,
  generateConversationTitle,
  saveConversation,
  CONVERSATION_SAVE_DEBOUNCE_MS,
  generateConversationId,
  generateMessageId,
  getConversationById,
  getResponseSettings,
} from "@/lib";
import { type Citation } from "@/types/completion";
import {
  buildTranscriptContext,
  isHeardTranscriptMessage,
  toChatAnalysisHistory,
  toHistoryMessages,
  transcriptCitation,
} from "@/lib/chat/transcript";
import { TurnAggregator, type AssembledTurn } from "@/lib/live/turns";
import {
  looksLikeQuestion,
  prefilterTurn,
  readTriage,
  type TriageMode,
} from "@/lib/live/triage";
import { buildLiveTurnContext } from "@/lib/live/dialog";

// VAD Configuration interface matching Rust
export interface VadConfig {
  enabled: boolean;
  hop_size: number;
  sensitivity_rms: number;
  peak_threshold: number;
  silence_chunks: number;
  min_speech_chunks: number;
  pre_speech_chunks: number;
  noise_gate_threshold: number;
  max_recording_duration_secs: number;
}

// Bump when DEFAULT_VAD_CONFIG changes so cached configs are refreshed.
// v3: manual/continuous mode removed — force any previously-persisted
// `enabled: false` config back to auto-detect (see AGENTS.md §10).
const VAD_CONFIG_VERSION = "3";

// Whether to also transcribe the user's own microphone. Stored as "true"/"false"
// rather than JSON so an absent key and a corrupt one both fall through to the
// ON default (see the useState below). Local-only, like `vad_config`: it's a
// per-machine choice about that machine's microphone, not something to sync.
const MIC_ENABLED_KEY = "mic_enabled";

// Tuned for real-time system-audio capture (e.g. a video/meeting playing
// through the speakers). Lower thresholds catch quieter playback; a shorter
// silence gate makes transcription feel near-immediate.
const DEFAULT_VAD_CONFIG: VadConfig = {
  enabled: true,
  hop_size: 1024,
  sensitivity_rms: 0.008, // more sensitive so quieter playback is captured
  peak_threshold: 0.022, // still filters clicks/noise, catches soft speech
  silence_chunks: 24, // ~0.5s silence to close an utterance (was ~1.0s)
  min_speech_chunks: 5, // ~0.11s - captures short phrases
  pre_speech_chunks: 14, // ~0.31s - catch the very start of words
  noise_gate_threshold: 0.002, // lighter gate so quiet audio isn't zeroed out
  max_recording_duration_secs: 180, // 3 minutes default
};

// Chat message interface (reusing from useCompletion)
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  /** Who said it (e.g. "You", "Them") for captured speech. */
  speaker?: string;
  /** "transcript" = captured speech + live answers; "chat" = typed Q&A. */
  origin?: "transcript" | "chat";
  /** Short label to display when `content` is a longer expanded prompt. */
  displayLabel?: string;
  /** Numbered sources the assistant answer drew on. */
  citations?: Citation[];
  /** Which kind of live help this assistant turn is — see @/lib/live/triage. */
  triageMode?: "answer" | "note" | "action" | "ask";
  /** The model's own short headline for this turn ("Q3 churn number"). */
  triageTopic?: string;
}

// Conversation interface (reusing from useCompletion)
export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export type useSystemAudioType = ReturnType<typeof useSystemAudio>;

// Common Whisper hallucinations produced on silence/noise (multiple languages).
const HALLUCINATION_PHRASES = [
  "怎么了？需要帮助吗？",
  "谢谢观看",
  "请不吝点赞",
  "订阅",
  "字幕",
  "明镜与点点栏目",
  "thank you for watching",
  "thanks for watching",
  "subtitles by",
  "please subscribe",
  "ご視聴ありがとうございました",
  "시청해주셔서 감사합니다",
];

// Languages that use Latin script (so CJK output for them = hallucination).
const LATIN_STT_LANGUAGES = new Set(["en", "es", "fr", "de", "pt", "it", "nl"]);

/** Heuristic: is this STT output a likely hallucination rather than speech? */
const isLikelyHallucination = (text: string): boolean => {
  const t = text.trim();
  const lower = t.toLowerCase();
  if (HALLUCINATION_PHRASES.some((p) => lower.includes(p.toLowerCase()))) {
    return true;
  }
  // If the user's spoken language is Latin-script but the result is mostly
  // CJK characters, it's almost certainly a hallucination on non-speech audio.
  try {
    const lang = getSttLanguage();
    if (LATIN_STT_LANGUAGES.has(lang)) {
      const cjk = (t.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || [])
        .length;
      const nonSpace = t.replace(/\s/g, "").length || 1;
      if (cjk > 0 && cjk / nonSpace > 0.3) return true;
    }
  } catch {
    // ignore
  }
  return false;
};

/**
 * Whether an STT result is actual speech (vs. an empty result, a sentinel like
 * "No transcription found" / an error string, or a Whisper hallucination on
 * silence). Non-speech results must never be sent to the AI.
 */
export const isRealTranscription = (text: string): boolean => {
  const t = (text || "").trim();
  if (!t) return false;
  if (/no transcription found/i.test(t)) return false;
  if (/stt error/i.test(t)) return false;
  if (/^(error|warning)[:\s]/i.test(t)) return false;
  if (isLikelyHallucination(t)) return false;
  return true;
};

/**
 * Classify a (possibly still-streaming) interview-copilot response so we can
 * suppress "SKIP" (nothing-to-say) replies without flashing them:
 *  - "hold": empty or still a prefix of "SKIP" → don't display yet
 *  - "skip": the whole reply is just "SKIP" → suppress entirely
 *  - "show": real content → display it
 */
export const classifySkip = (text: string): "hold" | "skip" | "show" => {
  const t = (text || "").trim();
  if (!t) return "hold";
  const up = t.toUpperCase().replace(/[.!,\s]+$/g, "");
  if (up === "SKIP") return "skip";
  if ("SKIP".startsWith(up)) return "hold";
  return "show";
};

export function useSystemAudio() {
  const { resizeWindow } = useWindowResize();
  const globalShortcuts = useGlobalShortcuts();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  // Paused = session/transcript kept, but the audio stream is halted.
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // ---------------------------------------------------------------------------
  // Live turn state. There are TWO independent streams and they each get their
  // own slot: captured speech → the transcript copilot (`last*` / `isAIProcessing`
  // below), typed questions and quick actions → the chat panel (`chat*` /
  // `isChatProcessing`). They used to share one slot, which meant whichever turn
  // started second wiped the first — ask a question while speech is still being
  // transcribed and your question and its answer vanished mid-read — and both
  // responses streamed into the same string, interleaving the live suggestion
  // with the chat answer. Keep them separate.
  // ---------------------------------------------------------------------------
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [lastTranscription, setLastTranscription] = useState<string>("");
  const [lastSpeaker, setLastSpeaker] = useState<string>("");
  // Short label for the in-flight transcript turn when the prompt is expanded.
  const [lastDisplayLabel, setLastDisplayLabel] = useState<string>("");
  // Numbered sources for the in-flight transcript turn ([n] citations).
  const [lastCitations, setLastCitations] = useState<Citation[]>([]);
  const [lastAIResponse, setLastAIResponse] = useState<string>("");
  // Which kind of help the in-flight copilot turn is producing, so the live card
  // gets the right icon rather than calling a note a "Suggested reply".
  // `undefined` until the mode tag streams in — that is what stops the header
  // showing a guess it then has to correct. See src/lib/live/triage.ts.
  const [lastTriageMode, setLastTriageMode] = useState<
    "answer" | "note" | "action" | "ask" | undefined
  >(undefined);
  // The model's own headline for the in-flight turn ("Q3 churn number"). Arrives
  // in the same tag as the mode, and is what the card actually displays.
  const [lastTriageTopic, setLastTriageTopic] = useState<string | undefined>(
    undefined
  );
  // The chat panel's in-flight turn — same fields, its own stream.
  const [isChatProcessing, setIsChatProcessing] = useState(false);
  const [chatQuestion, setChatQuestion] = useState<string>("");
  const [chatDisplayLabel, setChatDisplayLabel] = useState<string>("");
  const [chatCitations, setChatCitations] = useState<Citation[]>([]);
  const [chatResponse, setChatResponse] = useState<string>("");
  // Newest turn id per stream, so a superseded turn stops writing to the live
  // slot it no longer owns. See `processWithAI`.
  const turnSeqRef = useRef<{ chat: number; transcript: number }>({
    chat: 0,
    transcript: 0,
  });
  const [error, setError] = useState<string>("");
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [quickActions, setQuickActions] = useState<string[]>([]);
  // Live, context-aware insight actions generated from the ongoing conversation.
  const [liveInsights, setLiveInsights] = useState<
    { label: string; prompt: string }[]
  >([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const insightsBusyRef = useRef(false);
  const lastInsightLenRef = useRef(0);
  const insightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Deepgram Speech Intelligence signals surfaced live. Entities accumulate
  // across the session (from the per-utterance STT); topics/intents/sentiment/
  // summary come from a session-level /v1/read pass on the running transcript.
  const [sttEntities, setSttEntities] = useState<
    { label: string; value: string }[]
  >([]);
  const [sttIntelligence, setSttIntelligence] = useState<SttIntelligence>({});
  const intelBusyRef = useRef(false);
  const lastIntelLenRef = useRef(0);
  const intelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Merge newly-detected entities, de-duped by value (keep first-seen label).
  const addSttEntities = useCallback(
    (incoming: { label: string; value: string }[]) => {
      if (!incoming.length) return;
      setSttEntities((prev) => {
        const seen = new Set(prev.map((e) => e.value.toLowerCase()));
        const merged = [...prev];
        for (const e of incoming) {
          const key = e.value.trim().toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          merged.push({ label: e.label, value: e.value.trim() });
        }
        return merged.slice(-40);
      });
    },
    []
  );
  const [isManagingQuickActions, setIsManagingQuickActions] =
    useState<boolean>(false);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(true);
  const [vadConfig, setVadConfig] = useState<VadConfig>(DEFAULT_VAD_CONFIG);
  // Whether the user's microphone is also transcribed alongside system audio.
  //
  // Defaults ON, and persists. It used to default off and reset on every
  // launch, which read as "transcription is broken": capture starts, the
  // waveform moves because system audio is being heard, and then you speak and
  // nothing at all appears. The only cure was a mic button that doesn't exist
  // until capture is already running — so the fix was invisible at exactly the
  // moment you needed it. A two-sided transcript ("You" next to "Them") is the
  // whole point of the product, so on is the right default; muting is one click
  // and now stays muted.
  const [micEnabled, setMicEnabled] = useState<boolean>(
    () => safeLocalStorage.getItem(MIC_ENABLED_KEY) !== "false"
  );
  useEffect(() => {
    safeLocalStorage.setItem(MIC_ENABLED_KEY, micEnabled ? "true" : "false");
  }, [micEnabled]);
  // Images (screenshots/uploads) queued to send with the next transcription.
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const pendingImagesRef = useRef<string[]>([]);

  const addPendingImage = useCallback((base64: string) => {
    setPendingImages((prev) => {
      const next = [...prev, base64];
      pendingImagesRef.current = next;
      return next;
    });
  }, []);

  const removePendingImage = useCallback((index: number) => {
    setPendingImages((prev) => {
      const next = prev.filter((_, i) => i !== index);
      pendingImagesRef.current = next;
      return next;
    });
  }, []);

  const clearPendingImages = useCallback(() => {
    pendingImagesRef.current = [];
    setPendingImages([]);
  }, []);

  const [conversation, setConversation] = useState<ChatConversation>({
    id: "",
    title: "",
    messages: [],
    createdAt: 0,
    updatedAt: 0,
  });
  // Mirrors `conversation.messages` without the speech-detected listener effect
  // having to depend on it — see that effect for why depending on the array
  // caused the tauri listener to be torn down/recreated on every turn.
  const conversationMessagesRef = useRef(conversation.messages);
  useEffect(() => {
    conversationMessagesRef.current = conversation.messages;
  }, [conversation.messages]);

  // ---------------------------------------------------------------------------
  // Turn assembly + triage. The transcript and the copilot run on two different
  // clocks (see src/lib/live/turns.ts): every STT fragment is written to the
  // transcript immediately (fast, verbatim), while the copilot waits for the
  // fragments to settle into a whole turn and then decides whether the moment
  // deserves anything at all (see src/lib/live/triage.ts).
  //
  // The aggregator fires on a timer, long after the tauri listener closure that
  // fed it was created, so its callback must be indirected through a ref —
  // otherwise it would forever call the first render's handler, with that
  // render's stale prompt/persona state.
  // ---------------------------------------------------------------------------
  const handleAssembledTurnRef = useRef<(turn: AssembledTurn) => void>(
    () => {}
  );
  const turnAggregatorRef = useRef<TurnAggregator | null>(null);
  const getTurnAggregator = () => {
    if (!turnAggregatorRef.current) {
      turnAggregatorRef.current = new TurnAggregator((turn) =>
        handleAssembledTurnRef.current(turn)
      );
    }
    return turnAggregatorRef.current;
  };
  // Recent assembled turns, for the duplicate prefilter (STT occasionally
  // re-delivers text we already handled).
  const recentTurnsRef = useRef<string[]>([]);
  // The latest processWithAI, for the same staleness reason as above.
  const processWithAIRef = useRef<
    | ((
        transcription: string,
        prompt: string,
        priorMessages: ChatMessage[],
        images?: string[],
        speaker?: string,
        displayLabel?: string,
        options?: {
          forced?: boolean;
          skipUserCommit?: boolean;
          turnParts?: number;
        }
      ) => Promise<void>)
    | null
  >(null);

  useEffect(() => {
    return () => {
      turnAggregatorRef.current?.dispose();
      turnAggregatorRef.current = null;
    };
  }, []);

  // Auto-detected scenario for the current conversation (tailors the prompt).
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey | null>(null);
  const scenarioLenRef = useRef<number>(0);
  const scenarioBusyRef = useRef<boolean>(false);
  // Whether we've generated an LLM title for this conversation yet.
  const sessionTitledRef = useRef<boolean>(false);

  const {
    selectedAIProvider,
    allAiProviders,
    systemPrompt,
    selectedAudioDevices,
    hasActiveLicense,
  } = useApp();
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Load VAD config from localStorage on mount
  useEffect(() => {
    // Load VAD config (ignore stale caches from older tuning presets)
    const savedVadConfig = safeLocalStorage.getItem("vad_config");
    const savedVadVersion = safeLocalStorage.getItem("vad_config_version");
    if (savedVadConfig && savedVadVersion === VAD_CONFIG_VERSION) {
      try {
        const parsed = JSON.parse(savedVadConfig);
        setVadConfig(parsed);
      } catch (error) {
        console.error("Failed to load VAD config:", error);
      }
    } else {
      // No config or outdated preset -> apply the new tuned defaults
      setVadConfig(DEFAULT_VAD_CONFIG);
      safeLocalStorage.setItem("vad_config", JSON.stringify(DEFAULT_VAD_CONFIG));
      safeLocalStorage.setItem("vad_config_version", VAD_CONFIG_VERSION);
    }
  }, []);

  // Load quick actions from localStorage on mount
  useEffect(() => {
    const savedActions = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS
    );
    if (savedActions) {
      try {
        const parsed: string[] = JSON.parse(savedActions);
        // Ensure the newer built-in "Visualize as diagram" action is available
        // to existing users who already have saved quick actions.
        const DIAGRAM_ACTION = "Visualize as diagram";
        if (Array.isArray(parsed) && !parsed.includes(DIAGRAM_ACTION)) {
          const merged = [...parsed, DIAGRAM_ACTION];
          setQuickActions(merged);
          setSyncedItem(
            STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS,
            JSON.stringify(merged)
          );
        } else {
          setQuickActions(parsed);
        }
      } catch (error) {
        console.error("Failed to load quick actions:", error);
        setQuickActions(DEFAULT_QUICK_ACTIONS);
      }
    } else {
      setQuickActions(DEFAULT_QUICK_ACTIONS);
    }
  }, []);

  // Handle audio encoding errors and discarded-speech notices (emitted by
  // both VAD and — historically — continuous capture).
  useEffect(() => {
    let errorUnlisten: (() => void) | undefined;
    let discardedUnlisten: (() => void) | undefined;

    const setupContinuousListeners = async () => {
      try {
        // Audio encoding errors
        errorUnlisten = await listen("audio-encoding-error", (event) => {
          const errorMsg = event.payload as string;
          console.error("Audio encoding error:", errorMsg);
          setError(`Failed to process audio: ${errorMsg}`);
          setIsProcessing(false);
          setIsAIProcessing(false);
        });

        // Speech discarded (too short)
        discardedUnlisten = await listen("speech-discarded", (event) => {
          const reason = event.payload as string;
          console.log("Speech discarded:", reason);
          // Don't show error - this is expected behavior
        });
      } catch (err) {
        console.error("Failed to setup continuous recording listeners:", err);
      }
    };

    setupContinuousListeners();

    return () => {
      if (errorUnlisten) errorUnlisten();
      if (discardedUnlisten) discardedUnlisten();
    };
  }, []);

  /**
   * Write a heard line straight into the transcript, independent of whether the
   * copilot has anything to say about it. Functional `setConversation` only, so
   * this is stable and safe to call from the tauri listener closure.
   */
  const commitHeardLine = useCallback((text: string, speaker: string) => {
    const content = (text || "").trim();
    if (!content) return;
    const timestamp = Date.now();
    setConversation((prev) => {
      // `messages` is newest-first, so the line to compare against is the FIRST
      // heard entry. Guards a duplicate tauri event delivering the same audio.
      const newestHeard = prev.messages.find(
        (m) => m.role === "user" && (m.origin ?? "transcript") !== "chat"
      );
      if (newestHeard?.content === content) return prev;
      return {
        ...prev,
        messages: [
          {
            id: generateMessageId("user", timestamp),
            role: "user" as const,
            content,
            timestamp,
            speaker,
            origin: "transcript" as const,
          },
          ...prev.messages,
        ],
        updatedAt: timestamp,
        title: prev.title || generateConversationTitle(content),
      };
    });
  }, []);

  // Handle single speech detection event (both VAD and continuous modes)
  useEffect(() => {
    // Guards the async `listen()` race below: if this effect is torn down
    // (e.g. on re-run) before `listen()` resolves, `speechUnlisten` is still
    // undefined when cleanup runs, so the listener would leak — leaving TWO
    // live listeners on "speech-detected" that each fire for the same event,
    // producing a duplicated transcription + AI response ("Suggested reply"
    // shown twice for one utterance). Checking `cancelled` once `listen()`
    // resolves closes that window.
    let cancelled = false;
    let speechUnlisten: (() => void) | undefined;

    const setupEventListener = async () => {
      try {
        const unlisten = await listen("speech-detected", async (event) => {
          try {
            if (!capturing) return;

            const base64Audio = event.payload as string;
            // Convert to blob
            const binaryString = atob(base64Audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const audioBlob = new Blob([bytes], { type: "audio/wav" });

            setIsProcessing(true);

            // Managed-only: transcribe via the backend proxy (key server-side).
            // There is no BYOK/local Deepgram fallback. The rich result carries
            // Deepgram Speech Intelligence signals (diarized speaker + entities)
            // when the admin has enabled those features.
            type RichStt = {
              text: string;
              speaker?: string;
              entities?: { label: string; value: string }[];
            };
            // Deadlines and retries live in `backendTranscribeRich`, NOT here.
            // This used to race the request against one 45s wall clock, which
            // read as a safety net and behaved as the opposite: the single
            // budget covered the request and its retry together, so a first
            // attempt that hung for 45s left the retry no time at all — the
            // upstream episode that makes a retry worth having was precisely
            // the one that disabled it. `signal` is now for cancellation only.
            const sttAbort = new AbortController();
            const runStt = async (): Promise<RichStt> =>
              fetchSTTRich({
                audio: audioBlob,
                signal: sttAbort.signal,
              }).then((r) => ({
                text: r.transcript,
                speaker: r.speaker,
                entities: r.entities,
              }));

            try {
              const result = await runStt();
              const transcription = result.text;
              const detectedSpeaker = result.speaker;
              if (result.entities?.length) addSttEntities(result.entities);

              if (isRealTranscription(transcription)) {
                setLastTranscription(transcription);
                setLastSpeaker(detectedSpeaker || "Them");
                setError("");

                // The transcript is written NOW, per fragment, so what the user
                // sees stays as immediate as the VAD is. It no longer waits on
                // the copilot — which also fixes a real bug: a turn the copilot
                // declined to answer used to vanish from the transcript
                // entirely, because the line was only committed alongside a
                // reply.
                commitHeardLine(transcription, detectedSpeaker || "Them");

                // The copilot gets the fragment on a slower clock: the
                // aggregator stitches fragments into a whole turn and only then
                // asks for help. See src/lib/live/turns.ts.
                getTurnAggregator().add({
                  text: transcription,
                  speaker: detectedSpeaker,
                  at: Date.now(),
                });
              } else {
                // No speech detected in this segment — skip quietly (common
                // during silence); don't send it to the AI or show an error.
                console.debug("Skipped non-speech STT result:", transcription);
              }
            } catch (sttError: any) {
              console.error("STT Error:", sttError);
              setError(sttError.message || "Failed to transcribe audio");
              setIsPopoverOpen(true);
            }
          } catch (err) {
            setError("Failed to process speech");
          } finally {
            setIsProcessing(false);
          }
        });

        if (cancelled) {
          // Effect was torn down while `listen()` was in flight — remove the
          // listener immediately instead of leaving it (and a future one)
          // both live.
          unlisten();
        } else {
          speechUnlisten = unlisten;
        }
      } catch (err) {
        setError("Failed to setup speech listener");
      }
    };

    setupEventListener();

    return () => {
      cancelled = true;
      if (speechUnlisten) speechUnlisten();
    };
    // Deliberately NOT depending on `conversation.messages` — the handler
    // reads it via `conversationMessagesRef` instead. Re-subscribing this
    // tauri listener on every committed message reopened the same
    // teardown/setup race guarded against above, on every single turn.
    // Only `capturing` matters. This used to also depend on the selected STT
    // provider and the provider list, back when the handler read them; it no
    // longer does (STT is managed server-side), and re-subscribing this tauri
    // listener whenever an unrelated setting changed reopened the teardown race
    // guarded against above.
  }, [capturing]);

  // Once the user closes the details panel during a listening session, it must
  // stay closed — new transcripts must not pop it back open. We detect a
  // deliberate close as a true->false transition of `isPopoverOpen` while
  // capturing (the panel can only close via the collapse/toggle buttons during
  // capture — see the Popover onOpenChange guard), and latch it for the rest of
  // the session. Reset when a new session starts.
  const userClosedPanelRef = useRef(false);
  const prevPopoverOpenRef = useRef(isPopoverOpen);
  useEffect(() => {
    if (capturing && prevPopoverOpenRef.current && !isPopoverOpen) {
      userClosedPanelRef.current = true;
    }
    prevPopoverOpenRef.current = isPopoverOpen;
  }, [isPopoverOpen, capturing]);

  // Auto-open the details panel on the FIRST activity of a listening session,
  // so the user can see that listening/transcription is actually happening —
  // but only once, and never if the user has already closed it. Previously this
  // reopened the panel on every new transcript/response, so a manual close
  // never stuck. Both refs reset when a new capture session starts, so the
  // one-time auto-open happens again next time the user starts listening.
  const autoOpenedThisSessionRef = useRef(false);
  useEffect(() => {
    if (!capturing) {
      autoOpenedThisSessionRef.current = false;
      userClosedPanelRef.current = false;
      return;
    }
    if (autoOpenedThisSessionRef.current || userClosedPanelRef.current) return;
    if (isProcessing || isAIProcessing || lastTranscription) {
      autoOpenedThisSessionRef.current = true;
      setIsPopoverOpen(true);
      resizeWindow(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, isProcessing, isAIProcessing, lastTranscription]);

  // "Open in Overlay" from the dashboard writes the conversation id to
  // localStorage; load it into the panel and show it.
  useEffect(() => {
    const loadFromStorage = async (id: string) => {
      try {
        const conv = await getConversationById(id);
        if (!conv) return;
        // The DB returns messages oldest-first and fully populated (speaker,
        // origin, displayLabel, citations — see mapDbMessage). Keep all of it and
        // store newest-first, matching how live turns are prepended: re-mapping
        // to bare id/role/content/timestamp used to drop `origin`, so every
        // saved chat Q&A reappeared in the Transcript pane as heard speech, and
        // speakers came back as "Heard".
        const msgs = [...(conv.messages || [])].reverse();
        setConversation({
          id: conv.id,
          title: conv.title,
          messages: msgs,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        });
        // Seed the copilot's slot from the transcript stream only — a saved chat
        // question must not become the basis for the next suggestion.
        const newestHeard = msgs.find((m) =>
          isHeardTranscriptMessage(m, conv.id)
        );
        setLastTranscription(newestHeard?.content || "");
        setLastSpeaker(newestHeard?.speaker || "");
        setLastAIResponse(
          msgs.find(
            (m) => m.role === "assistant" && (m.origin ?? "transcript") !== "chat"
          )?.content || ""
        );
        // Reset scenario/title so they re-derive for this loaded conversation.
        setScenarioKey(null);
        scenarioLenRef.current = 0;
        sessionTitledRef.current = !!conv.title;
        setIsPopoverOpen(true);
        resizeWindow(true);
      } catch (err) {
        console.error("Failed to open conversation in overlay:", err);
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "channelpulse-conversation-selected" && e.newValue) {
        try {
          const { id } = JSON.parse(e.newValue);
          if (id && typeof id === "string") loadFromStorage(id);
        } catch (err) {
          console.error("Failed to parse conversation selection:", err);
        }
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizeWindow]);

  // Quick actions management
  const saveQuickActions = useCallback((actions: string[]) => {
    try {
      setSyncedItem(
        STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS,
        JSON.stringify(actions)
      );
    } catch (error) {
      console.error("Failed to save quick actions:", error);
    }
  }, []);

  const addQuickAction = useCallback(
    (action: string) => {
      if (action && !quickActions.includes(action)) {
        const newActions = [...quickActions, action];
        setQuickActions(newActions);
        saveQuickActions(newActions);
      }
    },
    [quickActions, saveQuickActions]
  );

  const removeQuickAction = useCallback(
    (action: string) => {
      const newActions = quickActions.filter((a) => a !== action);
      setQuickActions(newActions);
      saveQuickActions(newActions);
    },
    [quickActions, saveQuickActions]
  );

  const handleQuickActionClick = async (
    action: string,
    images: string[] = [],
    displayLabel?: string
  ) => {
    setError("");

    const effectiveSystemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

    // The line that was just heard usually isn't committed to the thread yet
    // (it commits with its copilot suggestion), so pull it in as context.
    //
    // `conversation.messages` is newest-first — new messages are PREPENDED — so
    // the already-committed line to compare against is the FIRST heard entry,
    // not the last. Comparing against `messages[length - 1]` (the oldest line in
    // the thread) meant this never matched: every chat question re-committed the
    // most recent heard line as a fresh duplicate "Heard" bubble.
    const updatedMessages = [...conversation.messages];

    if (lastSpeaker && lastTranscription.trim()) {
      const newestHeard = updatedMessages.find(
        (m) => m.role === "user" && m.origin !== "chat"
      );
      if (newestHeard?.content !== lastTranscription) {
        const timestamp = Date.now();
        const userMessage = {
          id: generateMessageId("user", timestamp),
          role: "user" as const,
          content: lastTranscription,
          timestamp,
          speaker: lastSpeaker,
          origin: "transcript" as const,
        };
        updatedMessages.unshift(userMessage);

        // Update conversation state with the latest transcription
        setConversation((prev) => ({
          ...prev,
          messages: [userMessage, ...prev.messages],
          updatedAt: timestamp,
          title: prev.title || generateConversationTitle(lastTranscription),
        }));
      }
    }

    const previousMessages = updatedMessages;

    await processWithAI(
      action,
      effectiveSystemPrompt,
      previousMessages,
      images,
      undefined,
      displayLabel
    );
  };

  // AI Processing function
  const processWithAI = useCallback(
    async (
      transcription: string,
      prompt: string,
      priorMessages: ChatMessage[],
      images: string[] = [],
      speaker?: string,
      displayLabel?: string,
      options: {
        forced?: boolean;
        skipUserCommit?: boolean;
        turnParts?: number;
      } = {}
    ) => {
      // Forced = the user tapped "Answer now": always produce a suggestion
      // (never stay quiet), and don't re-append a transcript line we already have.
      const forced = options.forced ?? false;
      // The heard line(s) are already in the transcript (written per fragment by
      // `commitHeardLine`), so this turn must not re-commit its assembled text as
      // a second, differently-worded user bubble.
      const skipUserCommit = options.skipUserCommit ?? false;
      // Nothing was actually said / provided this turn → don't run the AI.
      if (!transcription?.trim() && images.length === 0) {
        return;
      }

      // Captured speech (has a speaker) → the live copilot. Typed questions /
      // quick actions (no speaker) → the Chat panel, which ANALYZES the
      // transcript and answers questions about it rather than suggesting
      // replies for the user to say.
      const isChatTurn = !speaker;
      // Each stream writes only to its own live slot, so a question asked while
      // speech is being transcribed can't clobber the suggestion in flight (or
      // have its answer streamed into the same string).
      const stream = isChatTurn ? "chat" : "transcript";
      // …and within a stream, only its newest turn may drive the live slot. Ask a
      // second question while the first is still answering and both used to
      // stream into the same string; now the superseded turn goes quiet (its
      // answer still commits to the thread when it lands) and, crucially, can't
      // clear the "answering" flag out from under the turn that replaced it.
      const turnId = ++turnSeqRef.current[stream];
      const isCurrentTurn = () => turnSeqRef.current[stream] === turnId;

      const rawSetProcessing = isChatTurn
        ? setIsChatProcessing
        : setIsAIProcessing;
      const rawSetResponse = isChatTurn ? setChatResponse : setLastAIResponse;
      const rawSetCitations = isChatTurn ? setChatCitations : setLastCitations;
      // Mode + topic move together: they come from the same tag, and the card
      // shows the topic, so setting one without the other would pair this turn's
      // icon with the previous turn's headline.
      const setLiveTriage = (m?: TriageMode, topic?: string) => {
        if (isChatTurn || m === "skip" || !isCurrentTurn()) return;
        setLastTriageMode(m);
        setLastTriageTopic(topic);
      };
      const setProcessing = (v: boolean) => {
        if (isCurrentTurn()) rawSetProcessing(v);
      };
      const setResponse = (v: string) => {
        if (isCurrentTurn()) rawSetResponse(v);
      };
      const setCitations = (c: Citation[]) => {
        if (isCurrentTurn()) rawSetCitations(c);
      };

      try {
        setProcessing(true);
        setResponse("");
        setCitations([]);
        // Start a triaged turn with NO mode and NO topic. Pre-seeding "answer"
        // here is what made the card read "SUGGESTED REPLY" and then visibly flip
        // to "Worth noting" once the real tag arrived; now the header stays blank
        // for the fraction of a second before the tag resolves. Forced turns
        // ("Answer now") never emit a tag, so a reply is what they are.
        setLiveTriage(!isChatTurn && !forced ? undefined : "answer");
        setError("");
        if (isChatTurn) {
          setChatQuestion(transcription);
          setChatDisplayLabel(displayLabel ?? "");
        } else {
          setLastTranscription(transcription);
          setLastSpeaker(speaker);
          setLastDisplayLabel(displayLabel ?? "");
        }

        // Show the question in the chat thread the moment it's asked. It used to
        // be committed only alongside a successful answer, so until the first
        // token arrived it existed nowhere but the live slot — and an empty or
        // failed response made it disappear entirely.
        if (isChatTurn) {
          const askedAt = Date.now();
          const questionMessage: ChatMessage = {
            id: generateMessageId("user", askedAt),
            role: "user",
            content: transcription,
            timestamp: askedAt,
            origin: "chat",
            ...(displayLabel ? { displayLabel } : {}),
          };
          setConversation((prev) => ({
            ...prev,
            messages: [questionMessage, ...prev.messages],
            updatedAt: askedAt,
            title: prev.title || generateConversationTitle(transcription),
          }));
        }
        // Web research (Firecrawl) is always available in the Chat: chat turns
        // (fact-check, questions about things not in the transcript) always
        // pull web sources. The live copilot never searches per-utterance.
        const useWebForTurn = isChatTurn;
        // Live mode follows selected persona → then auto-detected scenario.
        // Interview copilot (SKIP / STAR) only for candidate interviews.
        // "Answer now" (forced) always uses the general copilot so it replies.
        const liveScenario = resolveLiveScenario({
          detected: scenarioKey,
          personaPrompt: prompt,
          usePersona: true,
        });
        const interviewMode =
          !isChatTurn && !forced && isInterviewCandidateScenario(liveScenario);
        // TRIAGE applies to every turn of captured speech, in EVERY scenario —
        // that is the fix for the copilot replying to everything. Previously only
        // `interview_candidate` had a quiet mode, so meetings, support calls,
        // negotiations, lectures and generic sessions got a "Suggested reply"
        // for every single utterance.
        //
        // It is off for `forced` (the "Answer now" button), typed questions, and
        // quick actions: there the user explicitly asked for output, so staying
        // quiet would be a bug, not restraint.
        const useTriage = !isChatTurn && !forced;
        let finalPrompt: string;
        if (isChatTurn) {
          finalPrompt = px("chat.analysis", CHAT_ANALYSIS_SYSTEM_PROMPT);
        } else if (interviewMode) {
          finalPrompt = buildInterviewSystemPrompt(
            prompt,
            getResponseSettings().responseLength,
            useTriage
          );
        } else {
          const scenarioAddendum =
            SCENARIO_PROMPTS[liveScenario]?.prompt ?? "";
          // Base copilot + selected persona as guidance + scenario addendum.
          finalPrompt = buildCopilotSystemPrompt(
            prompt,
            scenarioAddendum,
            useTriage
          );
        }

        // Chat analysis always gets an explicit transcript block; live turns
        // keep labeled history for continuity.
        const transcriptBlock = isChatTurn
          ? buildTranscriptContext(priorMessages, conversation.id)
          : "";
        const previousMessages = isChatTurn
          ? toChatAnalysisHistory(priorMessages, conversation.id)
          : toHistoryMessages(priorMessages);
        const transcriptCite = isChatTurn
          ? transcriptCitation(priorMessages, conversation.id)
          : null;

        // Sources for [n] citations + "Using Transcript" chip.
        let turnCitations: Citation[] = transcriptCite ? [transcriptCite] : [];
        if (turnCitations.length) setCitations(turnCitations);

        let fullResponse = "";

        const useChannelPulseAPI = await shouldUseChannelPulseAPI();
        if (!selectedAIProvider.provider && !useChannelPulseAPI) {
          setError("No AI provider selected.");
          return;
        }

        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        if (!provider && !useChannelPulseAPI) {
          setError("AI provider config not found.");
          return;
        }

        // Chat analysis gets the transcript block. Live copilot turns instead get
        // the recent dialog + what's already been covered, so the model judges a
        // CONVERSATION rather than one utterance in isolation, and stops
        // re-noting the same point. Per-turn data, so it goes here rather than in
        // the (DB-overridable) system prompt.
        const extraContext = isChatTurn
          ? transcriptBlock || undefined
          : buildLiveTurnContext({
              messages: priorMessages,
              conversationId: conversation.id,
              text: transcription,
              speaker,
              looksLikeQuestion: looksLikeQuestion(transcription),
              parts: options.turnParts,
            });

        try {
          for await (const chunk of fetchAIResponse({
            provider: useChannelPulseAPI ? undefined : provider,
            selectedProvider: selectedAIProvider,
            systemPrompt: finalPrompt,
            history: previousMessages,
            // Prefix with the speaker so the AI knows who said it.
            userMessage: speaker ? `${speaker}: ${transcription}` : transcription,
            imagesBase64: images,
            extraContext,
            useWeb: useWebForTurn,
            // Interview answers define their own (richer) length; skip the
            // generic wrapper that would otherwise shorten them, and give the
            // model enough room to produce a full 2-3 minute answer.
            skipLengthWrapper: interviewMode,
            maxTokens: interviewMode ? 1200 : undefined,
            onCitations: (c) => {
              turnCitations = transcriptCite ? [transcriptCite, ...c] : c;
              setCitations(turnCitations);
            },
          })) {
            fullResponse += chunk;
            if (useTriage) {
              // Hold display until the leading mode tag has fully arrived, so a
              // half-typed "[SK" or "[NOT" never flashes on screen. Once
              // resolved, render the BODY — the tag itself is never shown.
              const read = readTriage(fullResponse);
              if (read.status === "resolved" && read.mode !== "skip") {
                setLiveTriage(read.mode, read.topic);
                setResponse(read.body);
              }
            } else {
              // Absolute, not `prev + chunk`: the accumulator is already the
              // whole response, and a relative update would concatenate a
              // second turn's tokens onto whatever was in the slot.
              setResponse(fullResponse);
            }
          }
        } catch (aiError: any) {
          setError(aiError.message || "Failed to get AI response");
        }

        // Resolve the final mode. `readTriage` fails open — an untagged response
        // is treated as an answer and shown verbatim — because a copilot that
        // occasionally says too much is a nuisance, while one that silently
        // swallows a real answer is broken.
        let triageMode: TriageMode = "answer";
        let triageTopic: string | undefined;
        let body = fullResponse;
        if (useTriage && fullResponse) {
          const read = readTriage(fullResponse);
          if (read.status === "resolved") {
            triageMode = read.mode;
            triageTopic = read.topic;
            body = read.body;
          } else {
            // Stream ended mid-tag: nothing usable was produced.
            triageMode = "skip";
            body = "";
          }
        }

        // [SKIP] — the moment didn't warrant anything. Stay quiet: no live
        // response, no message in the thread. The heard line is NOT lost, because
        // the transcript was committed separately when the speech was recognized.
        if (useTriage && (triageMode === "skip" || !body.trim())) {
          setResponse("");
          return;
        }

        // Everything committed and rendered from here on is the body, never the
        // raw tagged text.
        fullResponse = body;

        if (fullResponse) {
          const timestamp = Date.now();
          // Captured speech carries a speaker → it's part of the transcript.
          // Typed questions / quick actions have no speaker → interactive chat.
          const origin: "transcript" | "chat" = speaker ? "transcript" : "chat";
          setConversation((prev) => {
            // If this exact utterance is already the most recent user turn (e.g.
            // a forced "Answer now" on the latest speech, or a chat question we
            // committed up-front above), don't duplicate it — just add the
            // fresh answer.
            const latestUser = prev.messages.find((m) => m.role === "user");
            const dupUser =
              !!latestUser &&
              latestUser.content === transcription &&
              (latestUser.origin ?? "transcript") === origin;
            // Belt-and-suspenders: if BOTH the user utterance and the AI reply
            // exactly match the last committed turn, this is the same turn
            // being committed twice (e.g. a stray duplicate event listener) —
            // skip it entirely instead of showing "Suggested reply" twice.
            // Transcript turns only: a chat question is committed exactly once,
            // up-front, so asking the same thing twice must still get an answer.
            const latestAssistant = prev.messages.find(
              (m) => m.role === "assistant"
            );
            // `skipUserCommit` turns can't satisfy `dupUser` (the committed heard
            // lines are individual fragments, while this turn's text is the
            // assembly of them), so accept it as the same signal: for live
            // copilot output, a character-identical repeat back-to-back is
            // always noise, never something the user wants twice.
            const dupAssistant =
              !isChatTurn &&
              (dupUser || skipUserCommit) &&
              !!latestAssistant &&
              latestAssistant.content === fullResponse &&
              (latestAssistant.origin ?? "transcript") === origin;
            if (dupAssistant) return prev;
            // Chat questions are already in the thread (committed when asked);
            // so are heard lines, when the transcript writer got there first.
            const userTurn = isChatTurn || dupUser || skipUserCommit
              ? []
              : [
                  {
                    id: generateMessageId("user", timestamp),
                    role: "user" as const,
                    content: transcription,
                    timestamp,
                    speaker: speaker || undefined,
                    origin,
                    displayLabel: displayLabel || undefined,
                  },
                ];
            return {
              ...prev,
              messages: [
                ...userTurn,
                {
                  id: generateMessageId("assistant", timestamp + 1),
                  role: "assistant" as const,
                  content: fullResponse,
                  timestamp: timestamp + 1,
                  origin,
                  citations: turnCitations.length ? turnCitations : undefined,
                  // Only live copilot turns carry a mode; chat answers and forced
                  // "Answer now" replies are always plain answers. The topic is
                  // persisted with it so the card keeps its real headline in
                  // history instead of falling back to the generic label.
                  ...(useTriage && triageMode !== "skip"
                    ? { triageMode, ...(triageTopic ? { triageTopic } : {}) }
                    : {}),
                },
                ...prev.messages,
              ],
              updatedAt: timestamp,
              title: prev.title || generateConversationTitle(transcription),
            };
          });
        }
      } catch (err) {
        setError("Failed to get AI response");
      } finally {
        // Only this turn's stream stops — the other one may still be running.
        setProcessing(false);
        // No auto-restart - user manually controls when to start next recording
      }
    },
    [
      selectedAIProvider,
      allAiProviders,
      conversation.messages,
      conversation.title,
      conversation.id,
      scenarioKey,
      systemPrompt,
    ]
  );

  /**
   * A complete turn came out of the aggregator. Run the free, deterministic
   * prefilters first — pure backchannel ("yeah", "mm-hmm", "got it") and STT
   * re-deliveries are never worth a network call — then hand the whole turn to
   * the copilot, which decides whether to answer, note, ask, or stay silent.
   */
  const handleAssembledTurn = useCallback(
    async (turn: AssembledTurn) => {
      const pre = prefilterTurn(turn.text, {
        previousTurns: recentTurnsRef.current,
      });
      if (!pre.pass) {
        console.debug(`Copilot skipped turn (${pre.reason}):`, turn.text);
        return;
      }
      // Remember it for the duplicate check on later turns (last 4 is plenty —
      // repeats come from STT re-delivery, which is immediate).
      recentTurnsRef.current = [...recentTurnsRef.current, turn.text].slice(-4);

      const effectiveSystemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

      const attachedImages = pendingImagesRef.current;
      await processWithAIRef.current?.(
        turn.text,
        effectiveSystemPrompt,
        conversationMessagesRef.current,
        attachedImages,
        turn.speaker || "Them",
        undefined,
        // The transcript already has these fragments; only the answer is new.
        { skipUserCommit: true, turnParts: turn.parts }
      );
      if (attachedImages.length > 0) {
        pendingImagesRef.current = [];
        setPendingImages([]);
      }
    },
    [systemPrompt]
  );

  // Keep the indirection refs pointing at the current closures — the aggregator
  // was constructed once and fires from a timer, so it must not hold onto the
  // handler (and prompt state) from whichever render created it.
  useEffect(() => {
    handleAssembledTurnRef.current = handleAssembledTurn;
  }, [handleAssembledTurn]);
  useEffect(() => {
    processWithAIRef.current = processWithAI;
  }, [processWithAI]);

  // Seed live scenario from the selected persona until auto-detect has
  // classified from transcript (scenarioLenRef > 0). Persona changes update
  // the badge/mode until then.
  useEffect(() => {
    if (scenarioLenRef.current > 0) return;
    const hint = resolveLiveScenario({
      detected: null,
      personaPrompt: systemPrompt,
      usePersona: true,
    });
    const next = hint === "generic" ? null : hint;
    if (next !== scenarioKey) setScenarioKey(next);
  }, [systemPrompt, conversation.id, scenarioKey]);

  // Force a live copilot answer right now (the "Answer now" button) — don't
  // wait for the utterance/silence to complete. Answers the latest thing heard,
  // using the whole conversation as context.
  const answerNow = useCallback(async () => {
    if (isAIProcessing) return;
    const effectiveSystemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

    // Prefer the aggregator's buffer: mid-sentence it holds the whole turn so
    // far, while `lastTranscription` is only the newest fragment. Reset it after
    // taking the text so the same turn doesn't get answered twice — once now,
    // once again when its silence timer expires.
    const aggregator = getTurnAggregator();
    let basis = aggregator.pendingText.trim();
    const pendingSpeaker = aggregator.pendingSpeaker;
    if (basis) aggregator.reset();
    if (!basis) basis = (lastTranscription || "").trim();
    if (!basis) {
      const latestHeard = [...conversation.messages]
        .filter(
          (m) => m.role === "user" && (m.origin ?? "transcript") !== "chat"
        )
        .sort((a, b) => b.timestamp - a.timestamp)[0];
      basis = (latestHeard?.content || "").trim();
    }
    if (!basis) return;

    const previousMessages = conversation.messages;
    await processWithAI(
      basis,
      effectiveSystemPrompt,
      previousMessages,
      [],
      pendingSpeaker || lastSpeaker || "Them",
      undefined,
      // Heard lines are committed by the transcript writer now, so "Answer now"
      // must never re-commit its basis as another user bubble.
      { forced: true, skipUserCommit: true }
    );
  }, [
    isAIProcessing,
    systemPrompt,
    lastTranscription,
    lastSpeaker,
    conversation.messages,
    processWithAI,
  ]);

  // Generate live, context-aware insight actions from the conversation so far.
  // These replace the static "transforms" and adapt to the scenario (interview,
  // support, meeting, etc.).
  const generateLiveInsights = useCallback(async () => {
    if (insightsBusyRef.current) return;

    // Build a transcript of what's been heard (captured speech only — exclude
    // the user's typed chat questions).
    const heard = [...conversation.messages]
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((m) => m.role === "user" && (m.origin ?? "transcript") !== "chat")
      .map((m) => m.content)
      .join("\n");
    const transcript = (
      heard + (lastTranscription ? `\n${lastTranscription}` : "")
    )
      .trim()
      .slice(-4000);

    if (transcript.length < 40) return;

    const provider = allAiProviders.find(
      (p) => p.id === selectedAIProvider.provider
    );
    if (!selectedAIProvider.provider || !provider) return;

    insightsBusyRef.current = true;
    setInsightsLoading(true);
    try {
      const systemPrompt =
        "You help a user during a live conversation they are hearing in real time. " +
        "From the transcript, produce 3-5 SHORT, natural follow-up questions the user would most likely want answered next, tailored specifically to THIS conversation. " +
        "Each must be answerable from the conversation or general knowledge. Phrase them as real questions (e.g. 'What is the purpose of X?', 'Which options can be selected?', 'What are the next steps?'). " +
        'Return ONLY a compact JSON array, no prose, no code fences: [{"label":"the question, <= 9 words, ends with ?","prompt":"the same question, optionally expanded, for the assistant to answer"}]';

      let full = "";
      for await (const chunk of fetchAIResponse({
        provider,
        selectedProvider: selectedAIProvider,
        systemPrompt,
        userMessage: `Conversation transcript so far:\n${transcript}`,
        disableMemory: true,
      })) {
        full += chunk;
      }

      const jsonText = full
        .trim()
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim();
      const start = jsonText.indexOf("[");
      const end = jsonText.lastIndexOf("]");
      if (start !== -1 && end !== -1) {
        const parsed = JSON.parse(jsonText.slice(start, end + 1));
        if (Array.isArray(parsed)) {
          const cleaned = parsed
            .filter((i) => i && typeof i.label === "string" && typeof i.prompt === "string")
            .slice(0, 5)
            .map((i) => ({ label: i.label.trim(), prompt: i.prompt.trim() }));
          if (cleaned.length) {
            setLiveInsights(cleaned);
            lastInsightLenRef.current = transcript.length;
          }
        }
      }
    } catch (err) {
      console.warn("Failed to generate live insights:", err);
    } finally {
      insightsBusyRef.current = false;
      setInsightsLoading(false);
    }
  }, [
    conversation.messages,
    lastTranscription,
    selectedAIProvider,
    allAiProviders,
  ]);

  // Session-level Deepgram Text Intelligence (topics / intents / sentiment /
  // summary) over the running transcript. Runs occasionally (debounced) so it
  // never slows the live answer path. No-ops server-side when the admin has all
  // analytic features off.
  const generateSttIntelligence = useCallback(async () => {
    if (intelBusyRef.current) return;
    const heard = [...conversation.messages]
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((m) => m.role === "user" && (m.origin ?? "transcript") !== "chat")
      .map((m) => m.content)
      .join("\n");
    const transcript = (
      heard + (lastTranscription ? `\n${lastTranscription}` : "")
    )
      .trim()
      .slice(-6000);
    if (transcript.length < 120) return;

    intelBusyRef.current = true;
    try {
      const intel = await backendReadIntelligence(transcript);
      if (intel && Object.keys(intel).length > 0) {
        setSttIntelligence(intel);
        lastIntelLenRef.current = transcript.length;
      }
    } catch {
      // best-effort; never break the live session on an intelligence hiccup
    } finally {
      intelBusyRef.current = false;
    }
  }, [conversation.messages, lastTranscription]);

  // Classify the conversation scenario so processWithAI can tailor the system
  // prompt. Runs once enough is said, then re-checks as the conversation grows.
  const maybeDetectScenario = useCallback(async () => {
    if (scenarioBusyRef.current) return;

    const heard = [...conversation.messages]
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((m) => m.role === "user" && (m.origin ?? "transcript") !== "chat")
      .map((m) => m.content)
      .join("\n");
    const transcript = (
      heard + (lastTranscription ? `\n${lastTranscription}` : "")
    )
      .trim()
      .slice(-3000);

    if (transcript.length < 60) return;
    // Re-classify only after another ~400 chars once we have a scenario.
    if (scenarioKey && transcript.length - scenarioLenRef.current < 400) return;

    const provider = allAiProviders.find(
      (p) => p.id === selectedAIProvider.provider
    );
    if (!selectedAIProvider.provider || !provider) return;

    scenarioBusyRef.current = true;
    try {
      const key = await detectScenario({
        transcript,
        provider,
        selectedProvider: selectedAIProvider,
      });
      if (key) {
        setScenarioKey(key);
        scenarioLenRef.current = transcript.length;
      }
    } finally {
      scenarioBusyRef.current = false;
    }
  }, [
    conversation.messages,
    lastTranscription,
    selectedAIProvider,
    allAiProviders,
    scenarioKey,
  ]);

  // Give the conversation (and its memory space) a short, descriptive LLM title
  // instead of the raw first utterance. Runs once per conversation.
  const maybeTitleConversation = useCallback(async () => {
    if (sessionTitledRef.current) return;

    const heard = [...conversation.messages]
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((m) => m.role === "user" && (m.origin ?? "transcript") !== "chat")
      .map((m) => m.content)
      .join("\n");
    const transcript = (
      heard + (lastTranscription ? `\n${lastTranscription}` : "")
    )
      .trim()
      .slice(-3000);
    if (transcript.length < 80) return;

    const provider = allAiProviders.find(
      (p) => p.id === selectedAIProvider.provider
    );
    if (!selectedAIProvider.provider || !provider) return;

    // Claim the slot up front so we don't fire multiple title requests.
    sessionTitledRef.current = true;
    try {
      const title = await generateConversationLabel({
        transcript,
        provider,
        selectedProvider: selectedAIProvider,
      });
      if (title) {
        // Updating the title renames the conversation's memory space via the
        // rename effect, so the dropdown shows the descriptive title.
        setConversation((prev) => ({ ...prev, title }));
      } else {
        sessionTitledRef.current = false; // allow a later retry
      }
    } catch {
      sessionTitledRef.current = false;
    }
  }, [
    conversation.messages,
    lastTranscription,
    selectedAIProvider,
    allAiProviders,
  ]);

  // Debounced trigger: regenerate insights when meaningfully more has been said.
  useEffect(() => {
    if (!capturing) return;
    const heardLen = conversation.messages
      .filter((m) => m.role === "user")
      .reduce((n, m) => n + m.content.length, 0);
    // Only regenerate after ~200 new chars of speech since last time.
    if (heardLen - lastInsightLenRef.current < 200 && liveInsights.length > 0) {
      return;
    }
    if (insightTimerRef.current) clearTimeout(insightTimerRef.current);
    insightTimerRef.current = setTimeout(() => {
      generateLiveInsights();
      maybeDetectScenario();
      maybeTitleConversation();
    }, 3000);
    return () => {
      if (insightTimerRef.current) clearTimeout(insightTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, conversation.messages.length]);

  // Debounced trigger for the session-level Deepgram intelligence pass. Runs
  // less often than insights (~400 new chars) since it analyzes the whole
  // transcript and is purely informational.
  useEffect(() => {
    if (!capturing) return;
    const heardLen = conversation.messages
      .filter((m) => m.role === "user")
      .reduce((n, m) => n + m.content.length, 0);
    if (heardLen - lastIntelLenRef.current < 400) return;
    if (intelTimerRef.current) clearTimeout(intelTimerRef.current);
    intelTimerRef.current = setTimeout(() => {
      generateSttIntelligence();
    }, 4000);
    return () => {
      if (intelTimerRef.current) clearTimeout(intelTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, conversation.messages.length]);

  const startCapture = useCallback(async () => {
    try {
      setError("");

      // Account Pro/trial unlocks even when the anonymous device trial ended.
      if (!hasActiveLicense) {
        setError(
          "Your ChannelPulse trial has ended. Open the Dashboard to upgrade."
        );
        setIsPopoverOpen(true);
        return;
      }

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (!hasAccess) {
        setSetupRequired(true);
        setIsPopoverOpen(true);
        return;
      }

      // Set up conversation — a fresh conversation gets its own scenario
      // (detected lazily on the first exchange).
      const conversationId = generateConversationId("sysaudio");
      setConversation({
        id: conversationId,
        title: "",
        messages: [],
        createdAt: 0,
        updatedAt: 0,
      });
      setScenarioKey(null);
      scenarioLenRef.current = 0;
      sessionTitledRef.current = false;

      setCapturing(true);
      setIsPaused(false);

      // Auto-detect (VAD): start recording immediately.
      // Stop any existing capture
      await invoke<string>("stop_system_audio_capture");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      // Start capture with VAD config
      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setIsPopoverOpen(true);
    }
  }, [vadConfig, selectedAudioDevices.output.id, hasActiveLicense]);

  const stopCapture = useCallback(async () => {
    try {
      // Abort any ongoing AI requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      // Stop the audio capture
      await invoke<string>("stop_system_audio_capture");

      // Drop any half-assembled turn: its silence timer would otherwise fire
      // after the session ended and answer into a stopped overlay.
      turnAggregatorRef.current?.reset();
      recentTurnsRef.current = [];

      // Reset ALL states
      setCapturing(false);
      setIsProcessing(false);
      setIsAIProcessing(false);
      setLastTranscription("");
      setLastAIResponse("");
      setError("");
      setIsPopoverOpen(false);
      setIsPaused(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to stop capture: ${errorMessage}`);
      console.error("Stop capture error:", err);
    }
  }, []);

  // Pause listening: stop the audio stream but keep the session + transcript.
  const pauseCapture = useCallback(async () => {
    try {
      await invoke("stop_system_audio_capture");
      setIsPaused(true);
    } catch (err) {
      console.error("Pause capture error:", err);
    }
  }, []);

  // Resume listening after a pause (restarts the stream in auto-detect mode).
  const resumeCapture = useCallback(async () => {
    try {
      setIsPaused(false);
      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;
      await invoke("start_system_audio_capture", {
        vadConfig,
        deviceId,
      });
    } catch (err) {
      console.error("Resume capture error:", err);
      setError(`Failed to resume: ${err}`);
    }
  }, [vadConfig, selectedAudioDevices.output.id]);

  const handleSetup = useCallback(async () => {
    try {
      const platform = navigator.platform.toLowerCase();

      if (platform.includes("mac") || platform.includes("win")) {
        await invoke("request_system_audio_access");
      }

      // Delay to give the user time to grant permissions in the system dialog.
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (hasAccess) {
        setSetupRequired(false);
        await startCapture();
      } else {
        setSetupRequired(true);
        setError("Permission not granted. Please try the manual steps.");
      }
    } catch (err) {
      setError("Failed to request access. Please try the manual steps below.");
      setSetupRequired(true);
    }
  }, [startCapture]);

  useEffect(() => {
    const shouldOpenPopover =
      capturing ||
      setupRequired ||
      isAIProcessing ||
      isChatProcessing ||
      !!lastAIResponse ||
      !!chatResponse ||
      !!error;
    setIsPopoverOpen(shouldOpenPopover);
    resizeWindow(shouldOpenPopover);
  }, [
    capturing,
    setupRequired,
    isAIProcessing,
    isChatProcessing,
    lastAIResponse,
    chatResponse,
    error,
    resizeWindow,
  ]);

  useEffect(() => {
    globalShortcuts.registerSystemAudioCallback(async () => {
      if (capturing) {
        await stopCapture();
      } else {
        await startCapture();
      }
    });
  }, [startCapture, stopCapture]);

  // Let the dashboard start listening remotely via a localStorage signal.
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "channelpulse-start-listening" && e.newValue) {
        if (!capturing) startCapture();
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [capturing, startCapture]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      invoke("stop_system_audio_capture").catch(() => {});
    };
  }, []);

  // Debounced save to prevent race conditions and improve performance
  useEffect(() => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Only debounce if there are messages to save
    if (
      !conversation.id ||
      conversation.updatedAt === 0 ||
      conversation.messages.length === 0
    ) {
      return;
    }

    // Debounce saves (only save 500ms after last change)
    saveTimeoutRef.current = setTimeout(async () => {
      // Don't save if already saving (prevent concurrent saves)
      if (isSavingRef.current) {
        return;
      }

      try {
        isSavingRef.current = true;
        await saveConversation(conversation);
      } catch (error) {
        console.error("Failed to save system audio conversation:", error);
      } finally {
        isSavingRef.current = false;
      }
    }, CONVERSATION_SAVE_DEBOUNCE_MS);

    // Cleanup on unmount or dependency change
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [conversation]);

  const startNewConversation = useCallback(() => {
    const newId = generateConversationId("sysaudio");
    setConversation({
      id: newId,
      title: "",
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    });
    // Supersede anything in flight so a late turn can't repopulate the live
    // slots we're about to clear.
    turnSeqRef.current.chat += 1;
    turnSeqRef.current.transcript += 1;
    // A buffered turn belongs to the conversation we're leaving.
    turnAggregatorRef.current?.reset();
    recentTurnsRef.current = [];
    setLastTranscription("");
    setLastAIResponse("");
    setChatQuestion("");
    setChatResponse("");
    setChatCitations([]);
    setError("");
    setSetupRequired(false);
    setIsProcessing(false);
    setIsAIProcessing(false);
    setIsChatProcessing(false);
    // Keep the panel open — this is triggered from inside the open overlay, so
    // closing it here would collapse the window back to the floating bar.
    setIsPopoverOpen(true);
    setLiveInsights([]);
    lastInsightLenRef.current = 0;
    setSttEntities([]);
    setSttIntelligence({});
    lastIntelLenRef.current = 0;
    // Fresh conversation → fresh scenario/title.
    setScenarioKey(null);
    scenarioLenRef.current = 0;
    sessionTitledRef.current = false;
  }, []);

  // Update VAD configuration
  const updateVadConfiguration = useCallback(async (config: VadConfig) => {
    try {
      setVadConfig(config);
      safeLocalStorage.setItem("vad_config", JSON.stringify(config));
      await invoke("update_vad_config", { config });
    } catch (error) {
      console.error("Failed to update VAD config:", error);
    }
  }, []);

  // Keyboard arrow key support for scrolling (local shortcut)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      // The transcript's thread is its own scroller now (ResultsSection's
      // `fill` mode) — the Radix ScrollArea that used to wrap it was removed
      // because it stopped the thread from filling the panel. Prefer that
      // thread; fall back to the Radix viewport, which is still what the setup
      // /permission flow renders.
      const scrollElement = (document.querySelector("[data-thread-scroll]") ??
        scrollAreaRef.current?.querySelector(
          "[data-radix-scroll-area-viewport]"
        )) as HTMLElement | null;

      if (!scrollElement) return;

      const scrollAmount = 100; // pixels to scroll

      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollElement.scrollBy({ top: scrollAmount, behavior: "smooth" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollElement.scrollBy({ top: -scrollAmount, behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen]);

  return {
    capturing,
    isProcessing,
    isAIProcessing,
    lastTranscription,
    lastSpeaker,
    lastDisplayLabel,
    lastCitations,
    lastAIResponse,
    lastTriageMode,
    lastTriageTopic,
    // Chat panel's own live turn (see the state block above).
    isChatProcessing,
    chatQuestion,
    chatDisplayLabel,
    chatCitations,
    chatResponse,
    error,
    // Exposed so the mic listener can report its own failures in the same place
    // the system-audio path reports its own, instead of only to the console.
    setError,
    setupRequired,
    startCapture,
    stopCapture,
    pauseCapture,
    resumeCapture,
    isPaused,
    handleSetup,
    isPopoverOpen,
    setIsPopoverOpen,
    // Conversation management
    conversation,
    setConversation,
    // Write a heard line into the transcript without waiting on the copilot.
    // Exposed for MicListener, which had no way to do this and so lost every
    // utterance the copilot declined to answer — see the note on the [SKIP]
    // early-return in processWithAI, whose "the heard line is NOT lost"
    // guarantee only ever held for callers that commit the line first.
    commitHeardLine,
    // AI processing
    processWithAI,
    startNewConversation,
    // Window resize
    resizeWindow,
    quickActions,
    liveInsights,
    insightsLoading,
    // Deepgram Speech Intelligence signals (entities + topics/intents/etc.)
    sttEntities,
    sttIntelligence,
    // Auto-detected scenario for the current conversation
    scenarioKey,
    generateLiveInsights,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick,
    // Force an on-demand copilot answer without waiting for silence.
    answerNow,
    // VAD configuration
    vadConfig,
    updateVadConfiguration,
    // Mic + attachments
    micEnabled,
    setMicEnabled,
    pendingImages,
    addPendingImage,
    removePendingImage,
    clearPendingImages,
    // Scroll area ref for keyboard navigation
    scrollAreaRef,
  };
}
