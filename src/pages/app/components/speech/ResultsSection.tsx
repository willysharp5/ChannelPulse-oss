import { ChatConversation } from "@/types";
import type { Citation } from "@/types/completion";
import { Markdown, CopyButton, ContextUsed } from "@/components";
import {
  BotIcon,
  HeadphonesIcon,
  Loader2,
  SparklesIcon,
  EyeIcon,
  EyeOffIcon,
  ChevronsDownIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronRightIcon,
  MessageCircleIcon,
  UserIcon,
  CopyIcon,
  CheckIcon,
  WandSparklesIcon,
  NotebookPenIcon,
  HelpCircleIcon,
  ListChecksIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TRIAGE_LABELS,
  type TriageMode as TriageModeAll,
} from "@/lib/live/triage";
import { getResponseSettings, updateAutoScroll, updateShowTranscript } from "@/lib";
import { useCopyToClipboard } from "@/hooks";
import { cn } from "@/lib/utils";

/**
 * Renders a chat question. When a short `displayLabel` differs from the full
 * `content` sent to the model (e.g. a quick action's expanded prompt), it shows
 * the one-liner with a collapsible "Show prompt" to reveal what was sent.
 */
const ChatQuestionBody = ({
  content,
  displayLabel,
}: {
  content: string;
  displayLabel?: string;
}) => {
  const [open, setOpen] = useState(false);
  const hasHiddenPrompt = !!displayLabel && displayLabel.trim() !== content.trim();

  if (!hasHiddenPrompt) {
    return <p className="whitespace-pre-wrap break-words text-sm">{content}</p>;
  }

  return (
    <div>
      <p className="whitespace-pre-wrap break-words text-sm">{displayLabel}</p>
      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-1 inline-flex items-center gap-0.5 text-3xs text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronUpIcon className="size-3" />
        ) : (
          <ChevronRightIcon className="size-3" />
        )}
        {open ? "Hide prompt" : "Show prompt"}
      </button>
      {open && (
        <p className="mt-1 whitespace-pre-wrap break-words rounded-md border border-border/50 bg-background/50 p-2 text-2xs text-muted-foreground">
          {content}
        </p>
      )}
    </div>
  );
};

/**
 * Turn inline [n] references into markdown links (#cite-n) that the Markdown
 * renderer replaces with clickable numbered citation chips — so the source sits
 * right next to the text instead of in a separate list.
 */
const linkifyCitations = (text: string, citations?: Citation[]): string => {
  if (!citations || citations.length === 0) return text;
  const nums = new Set(citations.map((c) => c.n).filter((n) => n > 0));
  return text.replace(/\[(\d{1,3})\](?!\()/g, (full, d) => {
    const n = parseInt(d, 10);
    return nums.has(n) ? `[${n}](#cite-${n})` : full;
  });
};

/** Small inline copy button for a single message (shows on row hover). */
const CopyLine = ({ text }: { text: string }) => {
  const { isCopied, handleCopy } = useCopyToClipboard({ text });
  return (
    <button
      onClick={handleCopy}
      title="Copy: paste into Chat to ask about this"
      className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100"
    >
      {isCopied ? (
        <CheckIcon className="size-3" />
      ) : (
        <CopyIcon className="size-3" />
      )}
    </button>
  );
};

type Variant = "transcript" | "chat";

/**
 * Which kind of help a live copilot turn is. The copilot no longer replies to
 * everything with a "Suggested reply" — it answers, notes, flags an action, or
 * proposes questions — and that decides the card's icon.
 * See `src/lib/live/triage.ts`.
 */
type TriageMode = Exclude<TriageModeAll, "skip">;

const TRIAGE_ICON: Record<TriageMode, typeof WandSparklesIcon> = {
  answer: WandSparklesIcon,
  note: NotebookPenIcon,
  action: ListChecksIcon,
  ask: HelpCircleIcon,
};

/**
 * What goes in a copilot card's header.
 *
 * The headline is the model's own TOPIC whenever it gave one ("Q3 churn number",
 * "Send revised SOW by Friday") — that says what the card is actually about,
 * which a generic "Worth noting" never did. The mode survives as the icon, and
 * as the headline of last resort for turns that arrived without a topic.
 *
 * With no mode AND no topic the headline is empty on purpose: that is the live
 * card before the tag has streamed in, and the old code guessed "Suggested
 * reply" there, so every note visibly flipped its label mid-stream.
 */
const triageHeader = (mode?: TriageMode, topic?: string) => ({
  headline: topic?.trim() || (mode ? TRIAGE_LABELS[mode] : ""),
  Icon: mode ? TRIAGE_ICON[mode] : SparklesIcon,
});

/**
 * How far from the bottom still counts as "at the bottom". Generous on purpose:
 * a streaming answer can grow by a whole line between a scroll event being
 * queued and it being handled, and that must not read as the user scrolling away.
 */
const BOTTOM_SLACK = 48;

type Props = {
  /**
   * The in-flight turn, for THIS stream only. The transcript instance is fed the
   * copilot's live slot, the chat instance the chat panel's — they are separate
   * pieces of state in `useSystemAudio`, so neither instance can ever render the
   * other stream's question or answer.
   *
   * Both streams commit the question to `conversation` before the answer starts,
   * so this is no longer rendered — it only tells the panel to stay mounted while
   * a turn is in flight.
   */
  liveQuestion: string;
  /** Sources for the in-flight turn. */
  liveCitations?: Citation[];
  liveResponse: string;
  /**
   * Which kind of help the in-flight copilot turn is producing. Undefined until
   * the mode tag streams in — deliberately, so the header stays blank instead of
   * showing a guess it has to correct. Transcript stream only.
   */
  liveTriageMode?: TriageMode;
  /**
   * The in-flight turn's topic, arriving with the mode in the same tag. This is
   * the headline the card shows. Transcript stream only.
   */
  liveTriageTopic?: string;
  isProcessing: boolean;
  /** Is THIS stream answering right now? */
  isLiveProcessing: boolean;
  conversation: ChatConversation;
  /**
   * Which stream to show:
   * - "transcript": captured speech + the AI's live answers to the conversation
   * - "chat": questions the user typed / quick actions and their answers
   */
  variant?: Variant;
  /**
   * A capture session is active (listening/paused). Keeps the transcript panel
   * mounted with a placeholder instead of vanishing between/at the start of
   * turns, so it doesn't flicker out while you're mid-conversation.
   */
  active?: boolean;
  /**
   * Take all the height the parent offers instead of capping the thread at a
   * fraction of the viewport.
   *
   * The transcript panel is a flex column with a definite height, so the thread
   * can simply flex into whatever is left — and it has to, because a fixed cap
   * there left a band of dead space under the card whenever the panel was
   * taller than the cap, which is exactly what happens as soon as anyone drags
   * the panel open.
   *
   * The chat sidebar is the opposite case: its card sits inside an auto-height
   * scroller, where a flexed child has nothing to flex against and would
   * collapse to nothing. That is why this is a prop and not the default.
   */
  fill?: boolean;
};

/**
 * Persistent, auto-scrolling thread. In "transcript" mode it shows the running
 * transcript + AI answers to the conversation; in "chat" mode it shows the
 * interactive Q&A. The live in-flight turn renders in whichever stream it
 * belongs to (captured speech → transcript, typed → chat).
 */
export const ResultsSection = ({
  liveQuestion,
  liveCitations,
  liveResponse,
  liveTriageMode,
  liveTriageTopic,
  isProcessing,
  isLiveProcessing,
  conversation,
  variant = "transcript",
  active = false,
  fill = false,
}: Props) => {
  const isChat = variant === "chat";
  const scrollRef = useRef<HTMLDivElement>(null);
  // Wraps the thread itself so a ResizeObserver can watch its height — Markdown,
  // mermaid diagrams, code blocks and images all lay out *after* React commits,
  // so scrolling only on commit reliably lands a few lines short of the end.
  const contentRef = useRef<HTMLDivElement>(null);
  // Sentinel at the very end of the thread. Scrolling it into view scrolls
  // EVERY scrollable ancestor (the inner thread AND the outer panel scroll
  // area), so following still works when the inner list isn't the one that
  // overflows.
  const endRef = useRef<HTMLDivElement>(null);
  // Toggle to hide the "Heard" transcription and show only AI answers.
  // Persisted (like autoScroll) so the choice survives the panel content
  // unmounting when you close/reopen it — otherwise hidden transcript lines
  // came straight back on every reopen.
  const [showTranscript, setShowTranscript] = useState<boolean>(
    () => getResponseSettings().showTranscript
  );
  // Persisted user preference for following new content.
  const [autoScroll, setAutoScroll] = useState<boolean>(
    () => getResponseSettings().autoScroll
  );
  // Are we still following the newest content? Kept in a ref *and* state: the
  // ref is what the scroll effects read, so a stale render can never wedge
  // following off; the state only drives the "jump to latest" button.
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  // Purely geometric: is there content below the fold right now? Drives the
  // "jump to latest" button, which stays useful even with auto-scroll off.
  const [atBottom, setAtBottom] = useState(true);
  // Last scrollTop we saw, so a user scrolling *up* can be told apart from
  // content growing underneath them.
  const lastTopRef = useRef(0);

  // Committed messages for this stream, chronological. Legacy messages with no
  // `origin` are treated as transcript so old data still shows up.
  const messages = useMemo(() => {
    const sorted = [...conversation.messages]
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((m) => (m.origin ?? "transcript") === variant);
    // The AI-only toggle only applies to the transcript stream.
    return !isChat && !showTranscript
      ? sorted.filter((m) => m.role === "assistant")
      : sorted;
  }, [conversation.messages, showTranscript, variant, isChat]);

  // This stream's turn is committed to `messages` only once its answer lands, so
  // we render a live block for it while the AI is answering. No cross-checking
  // against a speaker any more: the props ARE this stream's, so the other
  // stream's turn can neither appear here nor suppress ours.
  const showLiveTurn = isLiveProcessing;
  // Transcription-in-progress only ever belongs to the transcript stream.
  const transcribing = !isChat && isProcessing && !isLiveProcessing;

  // While a capture session is active, keep the transcript panel mounted even
  // with nothing yet, so it doesn't disappear as turns start/finish.
  const keepAliveForSession = !isChat && active;
  const hasAnything =
    messages.length > 0 ||
    showLiveTurn ||
    transcribing ||
    keepAliveForSession ||
    (!isChat && !!liveQuestion);

  const setPinnedBoth = useCallback((next: boolean) => {
    if (pinnedRef.current === next) return;
    pinnedRef.current = next;
    setPinned(next);
  }, []);

  // Pending scroll frame, so the work below runs at most once per frame.
  const scrollFrameRef = useRef<number | null>(null);

  // Scroll the thread to the bottom, and re-arm following. Coalesced into an
  // animation frame: while a response streams this is called from both the
  // commit effect and the ResizeObserver, several times per token, and every
  // call reads scrollHeight — i.e. forces a synchronous layout. One per frame
  // looks identical and keeps the overlay responsive to typing.
  const scrollToBottom = useCallback(
    (smooth = false) => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const behavior: ScrollBehavior = smooth ? "smooth" : "auto";
        const el = scrollRef.current;
        // Only reach for the end sentinel when the thread itself isn't the
        // scrolling element — scrollIntoView also moves the outer panel, and
        // with two ResultsSections (Transcript + Chat) inside that one panel
        // they'd otherwise yank it away from each other on every token.
        const innerScrolls = !!el && el.scrollHeight - el.clientHeight > 1;
        if (el) {
          el.scrollTo({ top: el.scrollHeight, behavior });
          lastTopRef.current = el.scrollTop;
        }
        if (!innerScrolls) {
          endRef.current?.scrollIntoView({ behavior, block: "end" });
        }
        setPinnedBoth(true);
        setAtBottom(true);
      });
    },
    [setPinnedBoth]
  );

  // Drop a queued scroll if the panel closes mid-stream.
  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    []
  );

  // Tell "the user scrolled up to read" apart from "the thread grew underneath
  // us": only an upward move away from the bottom stops following, and arriving
  // back at the bottom resumes it. Previously *any* scroll event that measured
  // far from the bottom unpinned — but a streaming answer can grow between a
  // scroll event being queued and handled, so following died mid-transcript and
  // never came back.
  //
  // Safe to call from the ResizeObserver too: when only the height changed `top`
  // is unchanged, so neither branch fires and following is left alone — just
  // `atBottom` (the button) updates.
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const distance = el.scrollHeight - top - el.clientHeight;
    const nearBottom = distance <= BOTTOM_SLACK;
    if (nearBottom) setPinnedBoth(true);
    else if (top < lastTopRef.current - 1) setPinnedBoth(false);
    lastTopRef.current = top;
    setAtBottom(nearBottom);
  }, [setPinnedBoth]);

  const toggleAutoScroll = () => {
    const next = !autoScroll;
    setAutoScroll(next);
    updateAutoScroll(next);
    if (next) scrollToBottom();
  };

  // Follow the newest content as it commits. Deliberately does NOT depend on the
  // pinned *state* — it reads the ref — so a re-render can't leave this effect
  // skipped forever.
  useEffect(() => {
    if (!autoScroll || !pinnedRef.current) return;
    scrollToBottom();
  }, [
    hasAnything,
    messages.length,
    liveResponse,
    liveQuestion,
    isLiveProcessing,
    transcribing,
    autoScroll,
    scrollToBottom,
  ]);

  // …and again whenever the thread's height actually changes, which is what
  // catches late layout the commit above can't see: Markdown/mermaid rendering,
  // code blocks, images and web fonts all grow the thread afterwards.
  useEffect(() => {
    if (!hasAnything) return;
    const content = contentRef.current;
    const el = scrollRef.current;
    if (!content || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (autoScroll && pinnedRef.current) scrollToBottom();
      else measure();
    });
    observer.observe(content);
    // The viewport too — resizing the window changes how much of it fits.
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoScroll, hasAnything, measure, scrollToBottom]);

  if (!hasAnything) return null;

  return (
    <div
      className={cn(
        "flex select-text flex-col rounded-lg border border-border/50 bg-muted/20",
        fill && "min-h-0 flex-1"
      )}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {isChat ? (
            <MessageCircleIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <SparklesIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          )}
          <h4 className="truncate text-xs font-medium">
            {isChat ? "Chat" : "Transcript"}
          </h4>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={toggleAutoScroll}
            title={
              autoScroll
                ? "Auto-scroll on, following new messages"
                : "Auto-scroll off, stay where you are"
            }
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-3xs hover:bg-accent",
              autoScroll
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ChevronsDownIcon className="h-3 w-3" />
            Auto-scroll
          </button>
          {!isChat && (
            <button
              onClick={() =>
                setShowTranscript((s) => {
                  const next = !s;
                  updateShowTranscript(next);
                  return next;
                })
              }
              title={
                showTranscript
                  ? "Hide transcript (show AI answers only)"
                  : "Show transcript"
              }
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-3xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {showTranscript ? (
                <EyeIcon className="h-3 w-3" />
              ) : (
                <EyeOffIcon className="h-3 w-3" />
              )}
              Transcript
            </button>
          )}
          {liveResponse && <CopyButton content={liveResponse} />}
        </div>
      </div>

      {/* Scrolling thread */}
      <div className={cn("relative", fill && "flex min-h-0 flex-1 flex-col")}>
      <div
        ref={scrollRef}
        onScroll={measure}
        // Tagged so the panel's arrow-key handler can find the thread. It used
        // to look for the Radix scroll viewport that wrapped this card; the
        // transcript no longer has one, because that wrapper is what stopped
        // the thread from filling the panel.
        data-thread-scroll=""
        className={cn(
          "overflow-y-auto p-3",
          fill ? "min-h-0 flex-1" : "max-h-[52vh]"
        )}
      >
      <div ref={contentRef} className="space-y-2.5">
        {messages.map((m) => (
          <Bubble
            key={m.id}
            role={m.role}
            content={m.content}
            speaker={m.speaker}
            displayLabel={m.displayLabel}
            citations={m.citations}
            triageMode={m.triageMode}
            triageTopic={m.triageTopic}
            variant={variant}
          />
        ))}

        {/* Live in-flight turn */}
        {showLiveTurn && (
          <>
            {/* Neither stream renders its question here any more: heard lines are
                committed the moment speech is recognized (independently of
                whether the copilot answers) and chat questions are committed when
                asked — so both are already in `messages` above. Rendering them
                here too showed them twice. */}
            <div
              className={cn(
                "rounded-md p-2.5",
                isChat
                  ? "bg-background/60"
                  : "border border-primary/40 bg-primary/10"
              )}
            >
              <div className="mb-1 flex min-w-0 items-center gap-1.5">
                {isChat ? (
                  <>
                    <BotIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="text-3xs font-medium uppercase tracking-wide text-muted-foreground">
                      AI
                    </span>
                  </>
                ) : (
                  (() => {
                    // The headline is the model's topic; it and the icon appear
                    // together the moment the tag resolves, so nothing here ever
                    // renders a label that later changes.
                    const { headline, Icon } = triageHeader(
                      liveTriageMode,
                      liveTriageTopic
                    );
                    return (
                      <>
                        <Icon className="h-3 w-3 shrink-0 text-primary" />
                        {headline && (
                          <span className="truncate text-2xs font-semibold text-primary">
                            {headline}
                          </span>
                        )}
                      </>
                    );
                  })()
                )}
              </div>
              {liveResponse ? (
                <div className="prose prose-sm max-w-none break-words text-sm dark:prose-invert">
                  <Markdown citations={isChat ? liveCitations : undefined}>
                    {isChat
                      ? linkifyCitations(liveResponse, liveCitations)
                      : liveResponse}
                  </Markdown>
                  <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-primary align-middle" />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-3xs text-muted-foreground">
                    Generating…
                  </span>
                </div>
              )}
              <ContextUsed citations={liveCitations} compact />
            </div>
          </>
        )}

        {/* STT in progress */}
        {transcribing && (
          <div className="flex items-center gap-2 py-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="text-3xs text-muted-foreground">
              Transcribing…
            </span>
          </div>
        )}

        {/* Idle listening — nothing captured yet this session. */}
        {keepAliveForSession &&
          messages.length === 0 &&
          !showLiveTurn &&
          !transcribing && (
            <div className="flex items-center gap-2 py-4 text-muted-foreground">
              <HeadphonesIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="text-2xs">
                Listening… captured speech will show up here.
              </span>
            </div>
          )}

        {/* Bottom sentinel for reliable scroll-to-latest across containers. */}
        <div ref={endRef} />
      </div>
      </div>

      {/* Jump to latest — shown whenever there's content below the fold. */}
      {(!pinned || !atBottom) && (
        <button
          onClick={() => {
            // Also resume auto-follow so it keeps up with streaming output.
            if (!autoScroll) {
              setAutoScroll(true);
              updateAutoScroll(true);
            }
            scrollToBottom(true);
          }}
          title="Jump to latest"
          aria-label="Jump to latest"
          className="absolute bottom-2 left-1/2 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md hover:bg-accent"
        >
          <ChevronDownIcon className="h-4 w-4" />
        </button>
      )}
      </div>
    </div>
  );
};

/**
 * One message in the thread. Memoized because a streaming answer re-renders this
 * component's parent on every token, and each committed bubble re-parses its
 * whole body through `Markdown` (remark + shiki + mermaid) when it re-renders —
 * so a long transcript made every token cost a full-thread markdown pass. The
 * props are per-message values that don't change once committed, so the default
 * shallow comparison is enough.
 */
const Bubble = memo(function Bubble({
  role,
  content,
  speaker,
  displayLabel,
  citations,
  triageMode,
  triageTopic,
  variant = "transcript",
}: {
  role: "user" | "assistant" | "system";
  content: string;
  speaker?: string;
  displayLabel?: string;
  citations?: Citation[];
  triageMode?: TriageMode;
  triageTopic?: string;
  variant?: Variant;
}) {
  const isChat = variant === "chat";

  if (role === "assistant") {
    // In the Chat stream this is an analytical answer about the transcript.
    if (isChat) {
      return (
        <div className="group rounded-md bg-background/60 p-2.5">
          <div className="mb-1 flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <BotIcon className="h-3 w-3 text-muted-foreground" />
              <span className="text-3xs font-medium uppercase tracking-wide text-muted-foreground">
                AI
              </span>
            </div>
            <CopyLine text={content} />
          </div>
          <div className="prose prose-sm max-w-none break-words text-sm dark:prose-invert">
            <Markdown citations={citations}>
              {linkifyCitations(content, citations)}
            </Markdown>
          </div>
          <ContextUsed citations={citations} compact />
        </div>
      );
    }
    // In the Transcript stream this is the live copilot's output. Highlighted so
    // it's clearly not the transcript, headlined with the turn's own topic, and
    // iconed by kind — words to say, a fact, an action, or questions to ask.
    // A committed turn with no mode is pre-triage data: it was a suggested reply.
    const { headline, Icon } = triageHeader(triageMode ?? "answer", triageTopic);
    return (
      <div className="group rounded-md border border-primary/40 bg-primary/10 p-2.5">
        <div className="mb-1 flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon className="h-3 w-3 shrink-0 text-primary" />
            <span className="truncate text-2xs font-semibold text-primary">
              {headline}
            </span>
          </div>
          <CopyLine text={content} />
        </div>
        <div className="prose prose-sm max-w-none break-words text-sm dark:prose-invert">
          <Markdown>{content}</Markdown>
        </div>
        <ContextUsed citations={citations} compact />
      </div>
    );
  }

  // A question the user typed / a quick action (chat stream).
  if (isChat) {
    return (
      <div className="group rounded-md border border-border/50 bg-muted/30 p-2.5">
        <div className="mb-1 flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <UserIcon className="h-3 w-3 text-foreground/70" />
            <span className="text-3xs font-medium uppercase tracking-wide text-foreground/70">
              You
            </span>
          </div>
          <CopyLine text={content} />
        </div>
        <ChatQuestionBody content={content} displayLabel={displayLabel} />
      </div>
    );
  }

  // A line of captured speech (transcript stream) — neutral, it's the record.
  return (
    <div className="group rounded-md border border-border/50 bg-muted/20 p-2.5">
      <div className="mb-1 flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <HeadphonesIcon className="h-3 w-3 text-muted-foreground" />
          <span className="text-3xs font-medium uppercase tracking-wide text-muted-foreground">
            {speaker || "Heard"}
          </span>
        </div>
        <CopyLine text={content} />
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{content}</p>
    </div>
  );
});
