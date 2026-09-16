import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/contexts";
import { STORAGE_KEYS } from "@/config";
import { onSyncedKeys } from "@/lib/sync/kv";
import {
  buildScorecardTranscript,
  canGrade,
  fingerprintConversation,
  generateScorecard,
  isInterviewPracticeConversation,
  readScorecard,
  ScorecardError,
  writeScorecard,
  type Scorecard,
  type ScorecardKind,
  type ScorecardTranscript,
} from "@/lib/scorecard";
import type { ChatConversation } from "@/types/completion";

/**
 * Owns the scorecard for one conversation: cache lookup, the single
 * auto-generation, and manual regenerate / re-grade-as.
 *
 * Auto-generation is guarded per conversation id rather than by a boolean, so
 * React 19's double-invoked effects can't fire two grading calls and navigating
 * between conversations still generates for each one.
 */

export type ScorecardStatus =
  | "idle"
  | "too-short"
  | "not-generated"
  | "loading"
  | "ready"
  | "error";

export interface UseScorecardResult {
  status: ScorecardStatus;
  scorecard: Scorecard | null;
  /** Indexed transcript, for matching evidence quotes back to real lines. */
  transcript: ScorecardTranscript;
  error: string | null;
  /** The cached card was graded from an older version of this conversation. */
  stale: boolean;
  generatedAt: number | null;
  /** Which review is showing (or would be generated for a practice session). */
  kind: ScorecardKind | null;
  generate: (forceKind?: ScorecardKind) => void;
}

export function useScorecard(
  conversation: ChatConversation | null
): UseScorecardResult {
  const { selectedAIProvider, allAiProviders, hasActiveLicense } = useApp();

  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [status, setStatus] = useState<ScorecardStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);

  /** Conversation ids we've already auto-generated for in this mount. */
  const autoTried = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const conversationId = conversation?.id ?? null;

  const transcript = useMemo(
    () =>
      conversation
        ? buildScorecardTranscript(conversation)
        : { lines: [], text: "", wordCount: 0 },
    [conversation]
  );

  const fingerprint = conversation ? fingerprintConversation(conversation) : "";

  // Load from cache (or decide there's nothing to grade) whenever the
  // conversation changes.
  useEffect(() => {
    if (!conversation) {
      setScorecard(null);
      setStatus("idle");
      return;
    }

    const cached = readScorecard(conversation.id);
    if (cached) {
      setScorecard(cached.scorecard);
      setGeneratedAt(cached.generatedAt);
      setStale(cached.fingerprint !== fingerprint);
      setError(null);
      setStatus("ready");
      return;
    }

    setScorecard(null);
    setGeneratedAt(null);
    setStale(false);
    setError(null);
    setStatus(canGrade(transcript) ? "not-generated" : "too-short");
    // fingerprint/transcript are derived from `conversation`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, fingerprint]);

  // A card graded on another device can land mid-visit. Adopt it instead of
  // spending a grading call to produce the same review — but never interrupt a
  // run already in flight, which is about to write a fresher card anyway.
  const statusRef = useRef<ScorecardStatus>("idle");
  statusRef.current = status;
  useEffect(() => {
    if (!conversationId) return;
    return onSyncedKeys([STORAGE_KEYS.CONVERSATION_SCORECARDS], () => {
      if (statusRef.current === "loading") return;
      const cached = readScorecard(conversationId);
      if (!cached) return;
      setScorecard(cached.scorecard);
      setGeneratedAt(cached.generatedAt);
      setStale(cached.fingerprint !== fingerprint);
      setError(null);
      setStatus("ready");
    });
  }, [conversationId, fingerprint]);

  const run = useCallback(
    async (forceKind?: ScorecardKind) => {
      if (!conversation) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus("loading");
      setError(null);

      try {
        const result = await generateScorecard({
          config: {
            provider: allAiProviders.find(
              (p) => p.id === selectedAIProvider.provider
            ),
            selectedProvider: selectedAIProvider,
          },
          conversation,
          forceKind,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setScorecard(result.scorecard);
        setStale(false);
        setStatus("ready");
        const record = writeScorecard({
          conversationId: conversation.id,
          scorecard: result.scorecard,
          fingerprint: fingerprintConversation(conversation),
        });
        setGeneratedAt(record.generatedAt);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(
          err instanceof ScorecardError
            ? err.message
            : err instanceof Error && err.message
              ? err.message
              : "Something went wrong building the review."
        );
        setStatus("error");
      }
    },
    [conversation, allAiProviders, selectedAIProvider]
  );

  // One automatic pass per conversation, so opening a finished conversation
  // lands on a scorecard rather than an empty state.
  useEffect(() => {
    if (!conversation || !hasActiveLicense) return;
    if (status !== "not-generated") return;
    if (autoTried.current.has(conversation.id)) return;
    autoTried.current.add(conversation.id);
    void run();
  }, [conversation, hasActiveLicense, status, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = useCallback(
    (forceKind?: ScorecardKind) => {
      if (conversationId) autoTried.current.add(conversationId);
      void run(forceKind);
    },
    [conversationId, run]
  );

  const kind: ScorecardKind | null =
    scorecard?.kind ??
    (conversation && isInterviewPracticeConversation(conversation)
      ? "interview"
      : null);

  return {
    status,
    scorecard,
    transcript,
    error,
    stale,
    generatedAt,
    kind,
    generate,
  };
}
