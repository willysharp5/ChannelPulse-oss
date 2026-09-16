import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertBanner,
  Badge,
  Button,
  toast,
} from "@/components";
import { useApp } from "@/contexts";
import {
  evaluateCodingSubmission,
  evaluateDesignSubmission,
  generateCodingHints,
  formatCodingAnswer,
  formatDesignAnswer,
  generateAssessment,
  getEffectiveQuestionCount,
  getInterviewVoiceLabel,
  INTERVIEW_VOICES,
  isCodingInterview,
  isSystemDesignInterview,
  persistPracticeSession,
  saveInterviewResult,
  setInterviewTemplateVoice,
  streamNextQuestion,
  type CodingLanguage,
  type CodingVerdict,
  type DesignSubmission,
  type InterviewAssessment,
  type InterviewHistoryMessage,
  type InterviewTemplate,
  type InterviewTurn,
  type InterviewVoiceId,
} from "@/lib/interview";
import {
  cancelSpeech,
  pauseSpeech,
  resumeSpeech,
  pullSpeakableChunks,
  splitLeadChunk,
  speakSequence,
} from "@/lib/tts";
import {
  Loader2,
  Volume2,
  VolumeX,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock,
} from "lucide-react";
import { BehavioralWorkbench } from "./BehavioralWorkbench";
import { CodeWorkbench, type CodeSubmission } from "./CodeWorkbench";
import { SystemDesignWorkbench } from "./SystemDesignWorkbench";
import { AssessmentReport } from "./AssessmentReport";
import { cn } from "@/lib/utils";

type Phase =
  | "loading-question"
  | "awaiting-answer"
  | "grading-code"
  | "assessing"
  | "done"
  | "error";

interface PracticeSessionProps {
  template: InterviewTemplate;
  onExit: () => void;
  onRestart: () => void;
  /**
   * Wall-clock ms timestamp this session must end at (full interview loops).
   * There is no pause: when it passes, whatever the candidate has typed is
   * committed and the session is assessed, exactly like a real round ending.
   */
  deadlineAt?: number;
  /**
   * Called once the session has been assessed and saved — the loop board uses
   * it to record the stage's grade. `assessment` is null when the round ended
   * with nothing to grade.
   */
  onCompleted?: (result: {
    assessment: InterviewAssessment | null;
    turns: InterviewTurn[];
    resultId?: string;
    timedOut: boolean;
  }) => void;
}

export function PracticeSession({
  template,
  onExit,
  onRestart,
  deadlineAt,
  onCompleted,
}: PracticeSessionProps) {
  const { selectedAIProvider, allAiProviders } = useApp();

  const [phase, setPhase] = useState<Phase>("loading-question");
  const [currentQuestion, setCurrentQuestion] = useState("");
  /** Furthest question index reached (0-based). */
  const [liveSlot, setLiveSlot] = useState(0);
  /** Question index currently shown — can be earlier than liveSlot. */
  const [viewSlot, setViewSlot] = useState(0);
  /** Question text for the live (furthest) slot — kept while browsing past Qs. */
  const liveQuestionRef = useRef("");
  const [turns, setTurns] = useState<InterviewTurn[]>([]);
  const [history, setHistory] = useState<InterviewHistoryMessage[]>([]);
  const [assessment, setAssessment] = useState<InterviewAssessment | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  // Read the question aloud (with follow-along highlight) in every mode,
  // including system design — the user can mute/stop from the header.
  const [muted, setMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // Interviewer speech is paused (position kept) — lets you start answering a
  // long question without waiting for it to finish, then resume if you want.
  const [paused, setPaused] = useState(false);
  const [voice, setVoice] = useState<InterviewVoiceId>(template.voice);
  // Latest coding grade for the current question, shown inline in the editor.
  const [codeVerdict, setCodeVerdict] = useState<CodingVerdict | null>(null);
  // Latest system-design grade, shown inline in the design workbench.
  const [designVerdict, setDesignVerdict] = useState<CodingVerdict | null>(
    null
  );
  // Whether the current coding/design question already has a graded turn
  // recorded (so re-submitting replaces it instead of appending a duplicate).
  const gradedCurrentRef = useRef(false);
  // On-demand "Get hints" is loading (separate from AI grading).
  const [hintsLoading, setHintsLoading] = useState(false);

  // In-progress drafts per question slot (in memory). Each workbench
  // (behavioral / coding / system-design) continuously pushes its content here
  // via onDraft, so nothing is lost as you type — it survives navigating
  // between questions and is committed to `turns` on advance. No save button.
  const draftsRef = useRef<Record<number, Omit<InterviewTurn, "question">>>({});
  const viewSlotRef = useRef(0);
  const liveSlotRef = useRef(0);
  // Tiny, non-intrusive "auto-saving → saved" indicator (backend save is
  // instant/in-memory; this just reassures the user).
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setLiveDraft = useCallback(
    (draft: Omit<InterviewTurn, "question"> | null) => {
      const slot = viewSlotRef.current;
      const has = !!(draft && draft.answer.trim());
      if (has) draftsRef.current[slot] = draft!;
      else delete draftsRef.current[slot];
      if (!has) {
        // Nothing meaningful to save (empty/starter) — don't flash the indicator.
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        setSaveState((prev) => (prev === "idle" ? prev : "idle"));
        return;
      }
      // Avoid per-keystroke re-renders: setState bails when the value is equal,
      // so repeated "saving" during a typing burst renders at most once, then
      // settles to "saved" ~0.8s after typing stops.
      setSaveState((prev) => (prev === "saving" ? prev : "saving"));
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveState("saved"), 800);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const onBehavioralDraft = useCallback(
    (text: string) => {
      const t = text.trim();
      // Editing a previously answered question → auto-save the update in place
      // (no "Update" button needed). Live question → stage as a draft that
      // "Next" commits.
      if (viewSlotRef.current < liveSlotRef.current) {
        if (t)
          setTurns((prev) =>
            prev.map((turn, i) =>
              i === viewSlotRef.current ? { ...turn, answer: t } : turn
            )
          );
        return;
      }
      setLiveDraft(t ? { answer: t } : null);
    },
    [setLiveDraft]
  );
  const onCodingDraft = useCallback(
    (sub: CodeSubmission | null) =>
      setLiveDraft(
        sub && sub.code.trim()
          ? {
              answer: formatCodingAnswer(sub),
              coding: {
                language: sub.language,
                code: sub.code,
                stdout: sub.run?.stdout ?? "",
                stderr: sub.run?.stderr ?? "",
                timedOut: sub.run?.timedOut,
              },
            }
          : null
      ),
    [setLiveDraft]
  );
  const onDesignDraft = useCallback(
    (
      d: {
        sceneJson: string;
        elementSummary: string;
        notesAndComments: string;
      } | null
    ) =>
      setLiveDraft(
        d
          ? {
              answer: formatDesignAnswer({
                imageBase64: null,
                elementSummary: d.elementSummary,
                notesAndComments: d.notesAndComments,
                sceneJson: d.sceneJson,
              }),
              design: {
                elementSummary: d.elementSummary,
                sceneJson: d.sceneJson,
                hasImage: false,
                imageBase64: null,
              },
            }
          : null
      ),
    [setLiveDraft]
  );

  const totalQuestions = getEffectiveQuestionCount(template);
  const reviewingPast = viewSlot < liveSlot;
  // Choose the answer workbench PER prepared question from its category, so a
  // mixed interview can ask a behavioral question (spoken) then a coding one.
  // Falls back to the template-level mode for AI-generated (beyond prepared).
  const preparedCategories = template.customQuestionCategories ?? [];
  const preparedCount = template.customQuestions?.length ?? 0;
  const currentPreparedCategory =
    viewSlot < preparedCount ? preparedCategories[viewSlot] : undefined;
  const templateCoding = isCodingInterview(template);
  const templateDesign = isSystemDesignInterview(template);
  const codingMode = currentPreparedCategory
    ? currentPreparedCategory === "coding"
    : templateCoding;
  const designMode = currentPreparedCategory
    ? currentPreparedCategory === "system_design"
    : templateDesign;
  // Spoken behavioral interview (not coding/design) — uses its own
  // side-by-side workbench (Question + Coach tabs + answer area).
  const behavioralMode = !codingMode && !designMode;

  const viewedTurn =
    viewSlot < turns.length ? turns[viewSlot] : null;

  const upsertTurnAt = (slot: number, newTurn: InterviewTurn) => {
    setTurns((prev) => {
      if (slot < prev.length) {
        const copy = prev.slice();
        copy[slot] = newTurn;
        return copy;
      }
      if (slot === prev.length) return [...prev, newTurn];
      return prev;
    });
    setHistory((prev) => {
      let userSeen = -1;
      let replaced = false;
      const next = prev.map((m) => {
        if (m.role === "user") {
          userSeen += 1;
          if (userSeen === slot) {
            replaced = true;
            return { ...m, content: newTurn.answer };
          }
        }
        return m;
      });
      return replaced ? next : [...next, { role: "user", content: newTurn.answer }];
    });
  };

  /** Jump to a reachable question (past or live). */
  const goToSlot = (slot: number) => {
    if (slot < 0 || slot > liveSlot) return;
    if (
      phase === "loading-question" ||
      phase === "grading-code" ||
      phase === "assessing"
    ) {
      return;
    }
    if (slot === viewSlot) return;
    cancelSpeech();
    setPaused(false);
    setIsSpeaking(false);
    setHighlight(null);
    // Keep the current slot's draft (auto-save survives navigation); just point
    // future draft writes at the slot we're moving to and reset the indicator.
    viewSlotRef.current = slot;
    setSaveState("idle");
    setViewSlot(slot);

    if (slot === liveSlot) {
      const q = liveQuestionRef.current;
      setCurrentQuestion(q);
      questionRef.current = q;
      const t = turns[slot];
      // Live slot may already be graded (coding/design) — restore that verdict.
      if (t && (t.coding || t.design)) {
        setCodeVerdict(t.coding?.verdict ?? null);
        setDesignVerdict(t.design?.verdict ?? null);
        gradedCurrentRef.current = true;
      } else {
        setCodeVerdict(null);
        setDesignVerdict(null);
        gradedCurrentRef.current = false;
      }
    } else {
      const t = turns[slot];
      if (!t) return;
      setCurrentQuestion(t.question);
      questionRef.current = t.question;
      setCodeVerdict(t.coding?.verdict ?? null);
      setDesignVerdict(t.design?.verdict ?? null);
      gradedCurrentRef.current = !!(t.coding || t.design);
    }
    setPhase("awaiting-answer");
  };

  // Follow-along highlight: the sentence currently being spoken, as an index
  // range into the current question text.
  const [highlight, setHighlight] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const questionRef = useRef("");
  const spokenOffsetRef = useRef(0);
  // Absolute char ranges for each word in the phrase currently being spoken.
  const phraseWordsRef = useRef<{ start: number; end: number }[]>([]);

  // Called as each sentence begins: locate it in the question and tokenize it
  // into words so playback progress can advance the highlight word-by-word.
  const applyPhrase = useCallback((phrase: string) => {
    const q = questionRef.current;
    const p = phrase.trim();
    if (!q || !p) {
      phraseWordsRef.current = [];
      return;
    }
    let base = q.indexOf(p, spokenOffsetRef.current);
    if (base === -1) base = q.indexOf(p);
    if (base === -1) {
      phraseWordsRef.current = [];
      return;
    }
    spokenOffsetRef.current = base + p.length;

    const words: { start: number; end: number }[] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(p)) !== null) {
      words.push({ start: base + m.index, end: base + m.index + m[0].length });
    }
    phraseWordsRef.current = words;
    if (words.length > 0) {
      setHighlight({ start: words[0].start, end: words[0].end });
    }
  }, []);

  // Advance the highlighted word based on how far into the sentence's audio we are.
  const applyProgress = useCallback((fraction: number) => {
    const words = phraseWordsRef.current;
    if (words.length === 0) return;
    const idx = Math.min(
      words.length - 1,
      Math.max(0, Math.floor(fraction * words.length))
    );
    const w = words[idx];
    setHighlight({ start: w.start, end: w.end });
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef(
    `interview-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`
  );
  const startedRef = useRef(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const llmConfig = {
    provider: allAiProviders.find((p) => p.id === selectedAIProvider.provider),
    selectedProvider: selectedAIProvider,
  };

  const speakQuestion = useCallback(
    async (text: string, signal?: AbortSignal) => {
      if (mutedRef.current || !text.trim()) return;
      // Reset the highlighter to the start of this text.
      questionRef.current = text;
      spokenOffsetRef.current = 0;
      phraseWordsRef.current = [];
      setHighlight(null);
      const { chunks } = pullSpeakableChunks(text, { flush: true });
      const primed = splitLeadChunk(chunks.length ? chunks : [text]);
      setIsSpeaking(true);
      try {
        await speakSequence(primed, {
          voice,
          signal,
          onStart: () => {
            setIsSpeaking(true);
            setPaused(false);
          },
          onPhrase: applyPhrase,
          onProgress: applyProgress,
          onEnd: () => {
            setIsSpeaking(false);
            setPaused(false);
            setHighlight(null);
          },
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.warn("TTS failed:", err);
      } finally {
        setIsSpeaking(false);
      }
    },
    [voice, applyPhrase, applyProgress]
  );

  const loadNextQuestion = useCallback(
    async (
      nextHistory: InterviewHistoryMessage[],
      answeredCount: number
    ) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setPhase("loading-question");
      setCurrentQuestion("");
      setError(null);
      cancelSpeech();
      setPaused(false);
      // Reset coding/design grade state for the new question.
      gradedCurrentRef.current = false;
      setCodeVerdict(null);
      setDesignVerdict(null);
      // Reset follow-along highlighting for the new question.
      questionRef.current = "";
      spokenOffsetRef.current = 0;
      phraseWordsRef.current = [];
      setHighlight(null);

      // Watchdog: if the backend never responds (network hiccup, stalled
      // stream, etc.), abort and surface a real error instead of spinning on
      // "Preparing your question…" forever.
      let timedOut = false;
      const FIRST_CHUNK_TIMEOUT_MS = 25000;
      const watchdog = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, FIRST_CHUNK_TIMEOUT_MS);

      try {
        // Bridge: LLM stream → complete sentences → TTS (with prefetch).
        // Speech starts as soon as the first sentence arrives.
        const sentenceQueue: string[] = [];
        let streamDone = false;
        let wake: (() => void) | null = null;
        const notify = () => {
          wake?.();
          wake = null;
        };
        // Queue a chunk; split the very first one into a short lead so speech
        // starts almost immediately (tiny first TTS request).
        let queuedAny = false;
        const pushChunk = (chunk: string) => {
          if (!queuedAny) {
            queuedAny = true;
            for (const p of splitLeadChunk([chunk])) sentenceQueue.push(p);
          } else {
            sentenceQueue.push(chunk);
          }
          notify();
        };

        const phraseStream = (async function* () {
          while (!ac.signal.aborted) {
            if (sentenceQueue.length > 0) {
              yield sentenceQueue.shift()!;
              continue;
            }
            if (streamDone) return;
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        })();

        const speechPromise = mutedRef.current
          ? Promise.resolve()
            : speakSequence(phraseStream, {
              voice,
              signal: ac.signal,
              onStart: () => {
                setIsSpeaking(true);
                setPaused(false);
              },
              onPhrase: applyPhrase,
              onProgress: applyProgress,
              onEnd: () => {
                setIsSpeaking(false);
                setPaused(false);
                setHighlight(null);
              },
            }).catch((err) => {
              if (err instanceof DOMException && err.name === "AbortError") {
                return;
              }
              console.warn("TTS stream failed:", err);
              setIsSpeaking(false);
            });

        let full = "";
        let pending = "";
        let consumed = 0;

        for await (const { full: nextFull } of streamNextQuestion({
          config: llmConfig,
          template,
          history: nextHistory,
          answeredCount,
          signal: ac.signal,
        })) {
          clearTimeout(watchdog);
          if (ac.signal.aborted) break;
          full = nextFull;
          setCurrentQuestion(full);
          questionRef.current = full;

          pending += full.slice(consumed);
          consumed = full.length;

          const { chunks, rest } = pullSpeakableChunks(pending);
          pending = rest;
          for (const chunk of chunks) pushChunk(chunk);
        }

        const { chunks: tail } = pullSpeakableChunks(pending, { flush: true });
        for (const chunk of tail) pushChunk(chunk);

        streamDone = true;
        notify();

        if (ac.signal.aborted) return;

        const question = full.trim();
        if (!question) {
          throw new Error("The interviewer returned an empty question.");
        }

        setCurrentQuestion(question);
        questionRef.current = question;
        liveQuestionRef.current = question;
        setLiveSlot(answeredCount);
        setViewSlot(answeredCount);
        viewSlotRef.current = answeredCount;
        liveSlotRef.current = answeredCount;
        setSaveState("idle");
        setHistory([
          ...nextHistory,
          { role: "assistant", content: question },
        ]);
        setPhase("awaiting-answer");
        // Typing / answer interaction stays available while speech finishes
        // (same as coding & system-design workbenches).
        void speechPromise;
      } catch (err) {
        if (timedOut) {
          console.error("loadNextQuestion timed out waiting for a response");
          setError(
            "The interviewer is taking too long to respond. Check your connection and try again."
          );
          setPhase("error");
          setIsSpeaking(false);
          return;
        }
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error(err);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to generate the next question."
        );
        setPhase("error");
        setIsSpeaking(false);
      } finally {
        clearTimeout(watchdog);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template, selectedAIProvider, allAiProviders, voice]
  );

  useEffect(() => {
    // Start once. IMPORTANT: the cleanup must be registered on EVERY mount
    // (not gated by the started guard), so exiting the screen always stops any
    // in-progress speech — otherwise the interviewer keeps talking after exit.
    if (!startedRef.current) {
      startedRef.current = true;
      void loadNextQuestion([], 0);
    }

    return () => {
      // Release the guard so a StrictMode remount restarts the load. In dev,
      // React mounts → cleans up → remounts every effect; the cleanup below
      // aborts the in-flight first question, and without this reset the guard
      // blocked the restart, so `phase` stayed "loading-question" forever —
      // that was the real cause of the "Preparing your question…" hang (the
      // abort path returns silently by design, so the 25s watchdog never
      // fired). On a genuine unmount nothing re-runs, so this is a no-op.
      startedRef.current = false;
      abortRef.current?.abort();
      cancelSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Safety net, independent of abort propagation: "loading-question" must never
  // be terminal. Any cause — a stalled stream, a signal some layer ignores, an
  // abort with no follow-up load — surfaces as a real error with a retry
  // instead of an endless spinner.
  useEffect(() => {
    if (phase !== "loading-question") return;
    const t = setTimeout(() => {
      setError(
        "The interviewer didn't respond. Check your connection and try again."
      );
      setPhase("error");
      setIsSpeaking(false);
    }, 30000);
    return () => clearTimeout(t);
  }, [phase]);

  const finishAndAssess = async (
    finalTurns: InterviewTurn[],
    opts: { timedOut?: boolean } = {}
  ) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    cancelSpeech();
    setPhase("assessing");
    setError(null);

    try {
      const report = await generateAssessment({
        config: llmConfig,
        template,
        turns: finalTurns,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setAssessment(report);

      // Save the result so it's viewable later in the Results tab.
      let resultId: string | undefined;
      try {
        const saved = saveInterviewResult({
          templateId: template.id,
          templateTitle: template.title,
          assessment: report,
          // Align bank ids to answered turns when this session came from the bank.
          bankQuestionIds: template.bankQuestionIds?.slice(0, finalTurns.length),
          // Drop bulky scene JSON; keep PNG + summary for the Results UI.
          turns: finalTurns.map((t) =>
            t.design
              ? {
                  ...t,
                  design: {
                    elementSummary: t.design.elementSummary,
                    sceneJson: "",
                    hasImage: t.design.hasImage,
                    imageBase64: t.design.imageBase64 ?? null,
                    verdict: t.design.verdict,
                  },
                }
              : t
          ),
        });
        resultId = saved.id;
      } catch {
        // best-effort
      }

      await persistPracticeSession({
        template,
        turns: finalTurns,
        assessment: report,
        conversationId: conversationIdRef.current,
      });

      setPhase("done");
      // Loop stages record their grade here (no-op for standalone practice).
      onCompleted?.({
        assessment: report,
        turns: finalTurns,
        resultId,
        timedOut: opts.timedOut ?? false,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error(err);
      setError(
        err instanceof Error ? err.message : "Failed to generate assessment."
      );
      setPhase("error");
    }
  };

  const advanceAfterTurn = async (
    nextTurns: InterviewTurn[],
    nextHistory: InterviewHistoryMessage[]
  ) => {
    if (nextTurns.length >= getEffectiveQuestionCount(template)) {
      await finishAndAssess(nextTurns);
    } else {
      await loadNextQuestion(nextHistory, nextTurns.length);
    }
  };

  const handleCodingSubmit = async (submission: CodeSubmission) => {
    if (phase !== "awaiting-answer") return;
    cancelSpeech();
    setPhase("grading-code");
    setError(null);

    const answerText = formatCodingAnswer({
      language: submission.language,
      code: submission.code,
      run: submission.run,
    });
    const slot = viewSlot;

    try {
      const verdict = await evaluateCodingSubmission({
        config: llmConfig,
        question: currentQuestion,
        code: submission.code,
        language: submission.language,
        run: submission.run,
        roleLevel: template.roleLevel,
        signal: abortRef.current?.signal,
      });

      const newTurn: InterviewTurn = {
        question: currentQuestion,
        answer: answerText,
        coding: {
          language: submission.language,
          code: submission.code,
          stdout: submission.run?.stdout ?? "",
          stderr: submission.run?.stderr ?? "",
          timedOut: submission.run?.timedOut,
          verdict,
        },
      };

      // Record / replace this slot's turn — stay in the editor for another try.
      upsertTurnAt(slot, newTurn);
      gradedCurrentRef.current = true;
      setCodeVerdict(verdict);
      setPhase("awaiting-answer");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error(err);
      setError(
        err instanceof Error ? err.message : "Failed to grade your solution."
      );
      setPhase("error");
    }
  };

  // Move on after the candidate is done with the current coding question.
  const continueCoding = async () => {
    if (reviewingPast) {
      goToSlot(viewSlot + 1);
      return;
    }
    setCodeVerdict(null);
    gradedCurrentRef.current = false;
    await advanceAfterTurn(turns, history);
  };

  // On-demand coaching hints — no pass/fail grade, available before submitting.
  const handleCodingHints = async (code?: string) => {
    if (phase !== "awaiting-answer" || hintsLoading) return;
    setHintsLoading(true);
    try {
      const tips = await generateCodingHints({
        config: llmConfig,
        question: currentQuestion,
        code,
        language: "javascript",
        roleLevel: template.roleLevel,
        signal: abortRef.current?.signal,
      });
      setCodeVerdict({
        passed: false,
        score: 0,
        feedback: "",
        strengths: [],
        improvements: [],
        hints: tips.hints,
        hintDiagrams: [],
        modelAnswer: tips.modelAnswer,
        tipsOnly: true,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error(err);
      toast("Couldn’t fetch hints", {
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setHintsLoading(false);
    }
  };

  const handleDesignSubmit = async (submission: DesignSubmission) => {
    if (phase !== "awaiting-answer") return;
    cancelSpeech();
    setPhase("grading-code");
    setError(null);

    const answerText = formatDesignAnswer(submission);
    const slot = viewSlot;

    try {
      const verdict = await evaluateDesignSubmission({
        config: llmConfig,
        question: currentQuestion,
        submission,
        roleLevel: template.roleLevel,
        signal: abortRef.current?.signal,
      });

      const newTurn: InterviewTurn = {
        question: currentQuestion,
        answer: answerText,
        design: {
          elementSummary: submission.elementSummary,
          sceneJson: submission.sceneJson,
          hasImage: !!submission.imageBase64,
          imageBase64: submission.imageBase64,
          verdict,
        },
      };

      upsertTurnAt(slot, newTurn);
      gradedCurrentRef.current = true;
      setDesignVerdict(verdict);
      setPhase("awaiting-answer");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error(err);
      setError(
        err instanceof Error ? err.message : "Failed to grade your design."
      );
      setPhase("error");
    }
  };

  // Move on after the candidate is done with the current design question.
  const continueDesign = async () => {
    if (reviewingPast) {
      goToSlot(viewSlot + 1);
      return;
    }
    setDesignVerdict(null);
    gradedCurrentRef.current = false;
    await advanceAfterTurn(turns, history);
  };

  const handleReplay = () => {
    if (!currentQuestion || phase !== "awaiting-answer") return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPaused(false);
    void speakQuestion(currentQuestion, ac.signal);
  };

  // Pause the interviewer mid-sentence (keeps position). This also frees the
  // answer input so you can start replying without waiting for a long question.
  const handlePause = () => {
    if (pauseSpeech()) {
      setPaused(true);
      setIsSpeaking(false);
    }
  };

  // Resume from where it was paused.
  const handleResume = () => {
    if (resumeSpeech()) {
      setPaused(false);
      setIsSpeaking(true);
    }
  };

  // Hard-stop the interviewer — called when the user starts recording their
  // answer so narration and the mic never run at the same time. cancelSpeech()
  // reliably stops both cloud audio and the browser TTS fallback (whose pause()
  // is unreliable in Chromium/webview).
  const handleStopSpeech = () => {
    cancelSpeech();
    setIsSpeaking(false);
    setPaused(false);
  };

  const handleEndEarly = async () => {
    if (turns.length === 0) {
      onExit();
      return;
    }
    await finishAndAssess(turns);
  };

  // Forward navigation: revisit a later known question, continue after a
  // coding/design grade, or skip the live unanswered question.
  const goForward = () => {
    if (phase !== "awaiting-answer") return;
    if (viewSlot < liveSlot) {
      goToSlot(viewSlot + 1);
      return;
    }
    if ((codingMode || designMode) && gradedCurrentRef.current) {
      if (codingMode) void continueCoding();
      else void continueDesign();
      return;
    }
    void skipToNext();
  };

  // Advance to the next question. Auto-saves whatever the current workbench has
  // (typed answer / code / diagram) so nothing is lost — same across all three
  // modes. Only records "(skipped)" when there's genuinely nothing to save.
  const skipToNext = async () => {
    if (phase !== "awaiting-answer") return;
    if (reviewingPast) {
      goToSlot(viewSlot + 1);
      return;
    }
    cancelSpeech();
    const draft = draftsRef.current[viewSlot];
    const hasDraft = !!(draft && draft.answer.trim());
    const newTurn: InterviewTurn = hasDraft
      ? { ...draft, question: currentQuestion }
      : { question: currentQuestion, answer: "(skipped)" };
    const answerContent = hasDraft ? draft.answer.trim() : "(skipped)";
    // This slot is now committed to `turns`; drop its in-progress draft.
    delete draftsRef.current[viewSlot];
    const nextTurns = [...turns, newTurn];
    const nextHistory: InterviewHistoryMessage[] = [
      ...history,
      { role: "user", content: answerContent },
    ];
    setTurns(nextTurns);
    setHistory(nextHistory);
    await advanceAfterTurn(nextTurns, nextHistory);
  };

  // ── Timed rounds (interview loops) ────────────────────────────────────────
  // `deadlineAt` is a wall clock, not a countdown we own: reloading, closing the
  // app, or walking away does not buy time back. When it passes, whatever is in
  // the workbench is committed and the round is graded on that.
  const [msLeft, setMsLeft] = useState<number | null>(
    deadlineAt ? deadlineAt - Date.now() : null
  );
  useEffect(() => {
    if (!deadlineAt) {
      setMsLeft(null);
      return;
    }
    const tick = () => setMsLeft(deadlineAt - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadlineAt]);

  const timedOutRef = useRef(false);
  useEffect(() => {
    if (!deadlineAt || msLeft === null || msLeft > 0) return;
    if (timedOutRef.current) return;
    if (phase === "assessing" || phase === "done") return;
    timedOutRef.current = true;
    cancelSpeech();

    // Commit the in-progress answer first — a real interviewer scores what you
    // had at time, not nothing (same draft-commit rule as skipToNext).
    // Only the live slot's draft can be committed — a draft on a slot they were
    // browsing would get attached to the wrong question.
    const onLiveSlot = viewSlotRef.current === liveSlotRef.current;
    const draft = onLiveSlot ? draftsRef.current[liveSlotRef.current] : undefined;
    const hasDraft = !!(draft && draft.answer.trim());
    const finalTurns =
      hasDraft && draft
        ? [
            ...turns,
            { ...draft, question: liveQuestionRef.current || currentQuestion },
          ]
        : turns;

    if (finalTurns.length === 0) {
      // Nothing to grade — the round is simply lost.
      onCompleted?.({
        assessment: null,
        turns: [],
        timedOut: true,
      });
      onExit();
      return;
    }
    setTurns(finalTurns);
    void finishAndAssess(finalTurns, { timedOut: true });
  }, [deadlineAt, msLeft, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeLabel =
    msLeft === null
      ? null
      : (() => {
          const secs = Math.max(0, Math.ceil(msLeft / 1000));
          const m = Math.floor(secs / 60);
          const s = secs % 60;
          return `${m}:${String(s).padStart(2, "0")}`;
        })();

  if (phase === "done" && assessment) {
    return (
      <AssessmentReport
        assessment={assessment}
        templateTitle={template.title}
        coding={codingMode || designMode}
        onPracticeAgain={onRestart}
        onBackToSetup={onExit}
      />
    );
  }

  const progressLabel = `Q${viewSlot + 1} / ${totalQuestions}`;
  const canNavigate = phase === "awaiting-answer";
  const canGoPrev = canNavigate && viewSlot > 0;
  const canGoNext =
    canNavigate &&
    (viewSlot < liveSlot ||
      ((codingMode || designMode) && gradedCurrentRef.current) ||
      turns.length < totalQuestions);
  // Prefer a committed turn; otherwise re-hydrate from the in-progress draft so
  // typed/coded/drawn work survives navigating away and back to a question.
  const slotDraft = draftsRef.current[viewSlot];
  const prefillAnswer =
    viewedTurn &&
    !viewedTurn.coding &&
    !viewedTurn.design &&
    viewedTurn.answer !== "(skipped)"
      ? viewedTurn.answer
      : slotDraft && !slotDraft.coding && !slotDraft.design
        ? slotDraft.answer
        : "";
  const prefillCode = viewedTurn?.coding?.code ?? slotDraft?.coding?.code;
  const prefillLanguage =
    viewedTurn?.coding?.language ?? slotDraft?.coding?.language;
  const prefillScene = viewedTurn?.design?.sceneJson ?? slotDraft?.design?.sceneJson;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{template.title}</h2>
            <Badge variant="secondary">{template.roleLevel}</Badge>
            {codingMode ? (
              <Badge variant="outline">Coding</Badge>
            ) : null}
            {designMode ? (
              <Badge variant="outline">System design</Badge>
            ) : null}
            <Badge variant="outline" className="tabular-nums">
              {progressLabel}
            </Badge>
            {timeLabel ? (
              <Badge
                variant={
                  msLeft !== null && msLeft <= 5 * 60_000
                    ? "destructive"
                    : "secondary"
                }
                className="tabular-nums"
                title="Time left in this round; it can't be paused"
              >
                <Clock className="mr-1 h-3 w-3" />
                {timeLabel} left
              </Badge>
            ) : null}
            {reviewingPast ? (
              <Badge variant="secondary">Reviewing</Badge>
            ) : null}
            {saveState !== "idle" ? (
              <span
                className="inline-flex items-center gap-1 text-2xs text-muted-foreground"
                aria-live="polite"
              >
                {saveState === "saving" ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    Saved
                  </>
                )}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {designMode
              ? "Read the problem on the left, sketch your architecture on the canvas, then submit for an AI pass/fail."
              : codingMode
                ? "Solve each problem in the editor, run it, then submit for an AI pass/fail before the next question."
                : "Listen to the question, then record or type your answer. The interviewer adapts to what you say."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-lg border border-border/60 overflow-hidden">
            {INTERVIEW_VOICES.map((v) => (
              <button
                key={v.id}
                type="button"
                title={v.description}
                disabled={isSpeaking}
                onClick={() => {
                  setVoice(v.id);
                  setInterviewTemplateVoice(template.id, v.id);
                }}
                className={cn(
                  "px-2.5 py-1.5 text-xs font-medium transition-colors",
                  voice === v.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted/60 text-muted-foreground"
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const next = !muted;
              setMuted(next);
              if (next) {
                cancelSpeech();
                setPaused(false);
              }
            }}
            title={muted ? "Unmute interviewer" : "Mute interviewer"}
          >
            {muted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
            {muted ? "Muted" : getInterviewVoiceLabel(voice)}
          </Button>
        </div>
      </div>

      {/* Question navigation — End & assess on the far left; paging on the right. */}
      {phase !== "done" && phase !== "assessing" && liveSlot >= 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="bg-blue-600 text-white hover:bg-blue-600/90 focus-visible:ring-blue-600/40"
            onClick={handleEndEarly}
            disabled={
              phase === "loading-question" || phase === "grading-code"
            }
            title="Finish now and get your assessment"
          >
            <SkipForward className="h-4 w-4" />
            End &amp; assess
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={!canGoPrev}
            onClick={() => goToSlot(viewSlot - 1)}
            title="Previous question"
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <div className="flex flex-wrap items-center gap-1">
            {Array.from({ length: liveSlot + 1 }, (_, i) => {
              const answered = i < turns.length;
              const active = i === viewSlot;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!canNavigate}
                  title={`Question ${i + 1}${answered ? " (answered)" : ""}`}
                  onClick={() => goToSlot(i)}
                  className={cn(
                    "flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-medium tabular-nums transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : answered
                        ? "bg-muted text-foreground hover:bg-muted/80"
                        : "border border-border/60 text-muted-foreground hover:bg-muted/40",
                    !canNavigate && "opacity-50"
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!canGoNext}
            onClick={() => goForward()}
            title={
              (codingMode || designMode) &&
              gradedCurrentRef.current &&
              turns.length >= totalQuestions
                ? "See final assessment"
                : "Next question (your answer is auto-saved)"
            }
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      {error ? (
        <AlertBanner
          variant="error"
          title="Something went wrong"
          description={error}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadNextQuestion(history, turns.length)}
            >
              Retry
            </Button>
          }
          onClose={() => setError(null)}
        />
      ) : null}

      {designMode ? (
        phase === "loading-question" && !currentQuestion ? (
          <div className="flex h-[min(50vh,420px)] items-center justify-center gap-2 rounded-xl border border-border/60 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing your design prompt…
          </div>
        ) : phase === "assessing" ? (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reviewing your designs and preparing feedback…
          </div>
        ) : currentQuestion &&
          (phase === "awaiting-answer" || phase === "grading-code") ? (
          <SystemDesignWorkbench
            key={viewSlot}
            question={currentQuestion}
            speaking={isSpeaking}
            paused={paused}
            onPauseSpeech={handlePause}
            onResumeSpeech={handleResume}
            onReplaySpeech={handleReplay}
            canReplay={!muted && phase === "awaiting-answer" && !!currentQuestion}
            guideMarkdown={
              (template.customModelAnswers ?? [])[viewSlot] || ""
            }
            problemKey={viewSlot}
            initialSceneJson={prefillScene}
            highlight={highlight}
            disabled={phase !== "awaiting-answer"}
            busy={phase === "grading-code"}
            feedback={designVerdict}
            onSubmit={handleDesignSubmit}
            onDraft={onDesignDraft}
          />
        ) : null
      ) : codingMode ? (
        // The coding question lives in the workbench's Problem tab (read &
        // highlighted there) — only show a status placeholder here.
        phase === "loading-question" && !currentQuestion ? (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing your problem…
          </div>
        ) : phase === "assessing" ? (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reviewing your solutions and preparing feedback…
          </div>
        ) : null
      ) : behavioralMode ? (
        phase === "awaiting-answer" && currentQuestion ? (
          <BehavioralWorkbench
            key={viewSlot}
            question={currentQuestion}
            config={llmConfig}
            roleLevel={template.roleLevel}
            highlight={highlight}
            speaking={isSpeaking}
            paused={paused}
            onPauseSpeech={handlePause}
            onResumeSpeech={handleResume}
            onReplaySpeech={handleReplay}
            onStopSpeech={handleStopSpeech}
            canReplay={!muted && phase === "awaiting-answer" && !!currentQuestion}
            initialText={prefillAnswer}
            onDraft={onBehavioralDraft}
          />
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {phase === "assessing"
              ? "Reviewing your answers and preparing feedback…"
              : "Preparing your question…"}
          </div>
        )
      ) : null}

      {codingMode && (phase === "awaiting-answer" || phase === "grading-code") ? (
        <CodeWorkbench
          key={viewSlot}
          question={currentQuestion}
          highlight={highlight}
          speaking={isSpeaking}
          paused={paused}
          onPauseSpeech={handlePause}
          onResumeSpeech={handleResume}
          onReplaySpeech={handleReplay}
          canReplay={!muted && phase === "awaiting-answer" && !!currentQuestion}
          disabled={phase !== "awaiting-answer"}
          busy={phase === "grading-code"}
          feedback={codeVerdict}
          initialCode={prefillCode}
          initialLanguage={prefillLanguage as CodingLanguage | undefined}
          roundLanguage={template.codingLanguage}
          onSubmit={handleCodingSubmit}
          onRequestHints={(code) => void handleCodingHints(code)}
          hintsLoading={hintsLoading}
          onDraft={onCodingDraft}
        />
      ) : null}

    </div>
  );
}
