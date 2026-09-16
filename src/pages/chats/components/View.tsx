import {
  Badge,
  Card,
  Empty,
  Button,
  Markdown,
  Textarea,
  GetLicense,
  CopyButton,
  Scorecard,
  ScorecardEmpty,
  ScorecardErrorState,
  ScorecardLoading,
} from "@/components";
import { linkifyCitations } from "@/components/Markdown";
import { getConversationById } from "@/lib";
import { safeLocalStorage } from "@/lib/storage";
import { setSyncedItem } from "@/lib/sync/kv";
import { STORAGE_KEYS } from "@/config";
import { cn } from "@/lib/utils";
import { scorecardToMarkdown, type ScorecardKind } from "@/lib/scorecard";
import { ChatConversation } from "@/types";
import {
  Download,
  MessageCircleIcon,
  MessageCircleReplyIcon,
  Trash2,
  SparklesIcon,
  UserIcon,
  SendIcon,
  Check,
  Loader2,
  PinIcon,
  ChevronDown,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import moment from "moment";
import { useParams, useNavigate } from "react-router-dom";
import { PageLayout } from "@/layouts";
import { useHistory, useChatCompletion, useScorecard } from "@/hooks";
import { useApp } from "@/contexts";
import {
  DeleteConfirmationDialog,
  ChatScreenshot,
  ChatFiles,
  ContextUsed,
} from ".";
import { ScorecardToolbar, type ConversationView } from "./ScorecardToolbar";

const View = () => {
  const { conversationId } = useParams();
  const { hasActiveLicense, supportsImages } = useApp();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatConversation | null>(null);

  const {
    handleDeleteConfirm,
    confirmDelete,
    cancelDelete,
    deleteConfirm,
    handleAttachToOverlay,
    handleDownload,
    isDownloaded,
    isAttached,
  } = useHistory();

  const completion = useChatCompletion(
    conversationId as string,
    messages,
    setMessages
  );

  // A finished conversation opens on its scorecard; the raw thread is one click
  // away because the evidence popovers quote it.
  const [view, setView] = useState<ConversationView>("scorecard");
  const scorecard = useScorecard(messages);
  // Mirror of `view` read by the auto-follow observer below without
  // re-subscribing it on every toggle.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  // Set when "Jump to transcript" is driving the flip, so the effect that
  // normally lands the thread at its latest message doesn't fight the jump.
  const skipTranscriptAutoScroll = useRef(false);

  /**
   * "Jump to transcript" from an evidence popover: flip views, then scroll to
   * that message and flash it. Waits a frame for the thread to mount.
   */
  const jumpToTranscript = useCallback((messageId: string) => {
    skipTranscriptAutoScroll.current = true;
    setView("transcript");
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(messageId)}"]`
      );
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("cp-flash");
      setTimeout(() => el.classList.remove("cp-flash"), 1600);
    });
  }, []);

  const scorecardMarkdown = scorecard.scorecard
    ? scorecardToMarkdown(scorecard.scorecard)
    : null;
  const gradeAs = (kind: ScorecardKind) => scorecard.generate(kind);

  // Pinned suggestions (max 2), shared with the overlay chat.
  const MAX_PINNED = 2;
  const [pinned, setPinned] = useState<{ label: string; prompt: string }[]>([]);
  useEffect(() => {
    try {
      const raw = safeLocalStorage.getItem(
        STORAGE_KEYS.PINNED_CHAT_SUGGESTIONS
      );
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setPinned(arr.slice(0, MAX_PINNED));
      }
    } catch {
      // ignore
    }
  }, []);
  const persistPinned = (next: { label: string; prompt: string }[]) => {
    setPinned(next);
    // Synced across devices + shared with the overlay chat (see src/lib/sync/kv.ts).
    setSyncedItem(STORAGE_KEYS.PINNED_CHAT_SUGGESTIONS, JSON.stringify(next));
  };
  const isPinned = (label: string) =>
    pinned.some((p) => p.label.trim().toLowerCase() === label.trim().toLowerCase());
  const togglePin = (s: { label: string; prompt: string }) => {
    if (isPinned(s.label)) {
      persistPinned(
        pinned.filter(
          (p) => p.label.trim().toLowerCase() !== s.label.trim().toLowerCase()
        )
      );
    } else if (pinned.length < MAX_PINNED) {
      persistPinned([...pinned, { label: s.label, prompt: s.prompt }]);
    }
  };

  const pinnedSet = new Set(pinned.map((p) => p.label.trim().toLowerCase()));
  const dynamicSuggestions = (completion.suggestions || [])
    .filter((s) => !pinnedSet.has(s.label.trim().toLowerCase()))
    .slice(0, Math.max(0, 4 - pinned.length));
  const hasSuggestions =
    hasActiveLicense && (pinned.length > 0 || dynamicSuggestions.length > 0);

  // Show a "scroll to bottom" button when the user has scrolled up, and keep
  // following new content while it streams (unless the user scrolls up).
  const [atBottom, setAtBottom] = useState(true);
  // Mirror of atBottom read by the MutationObserver without re-subscribing.
  const followRef = useRef(true);
  useEffect(() => {
    followRef.current = atBottom;
  }, [atBottom]);

  useEffect(() => {
    const el = completion.messagesEndRef.current?.closest(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLElement | null;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      setAtBottom(dist < 80);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });

    // Follow streaming output: whenever the thread grows/changes and we're
    // pinned to the bottom, stick to the bottom. Coalesce to one scroll per
    // animation frame (after paint) so rapid streaming re-renders don't cause a
    // mid-render reflow that flashes blank text.
    // Transcript only: the scorecard is a document you read top-down, so
    // following its own render would dump you at the bottom of an unread review.
    let raf = 0;
    const observer = new MutationObserver(() => {
      if (viewRef.current !== "transcript" || !followRef.current || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.scrollTop = el.scrollHeight;
      });
    });
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages?.messages.length]);

  // The scroll container both views live in. messagesEndRef renders in both, so
  // this resolves whichever one is showing.
  const getViewport = () =>
    completion.messagesEndRef.current?.closest(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLElement | null;

  // Jump to latest AND resume auto-follow so it keeps up with streaming.
  const scrollToBottom = () => {
    followRef.current = true;
    setAtBottom(true);
    const el = getViewport();
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else completion.messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    const getMessages = async () => {
      const conversation = await getConversationById(conversationId as string);
      setMessages(conversation || null);
    };
    getMessages();
  }, [conversationId]);

  // A scorecard opens at the top, every time: on first load, on a view flip
  // back from the transcript, and when a freshly generated card replaces the
  // skeleton (the swap changes the content height, so the position has to be
  // reset after it paints). Flipping TO the transcript restores the thread's
  // latest-at-bottom convention, unless an evidence popover is jumping to a
  // specific message.
  useEffect(() => {
    if (view === "scorecard") {
      requestAnimationFrame(() => getViewport()?.scrollTo({ top: 0 }));
      return;
    }
    if (skipTranscriptAutoScroll.current) {
      skipTranscriptAutoScroll.current = false;
      return;
    }
    requestAnimationFrame(() => {
      const el = getViewport();
      if (el) el.scrollTop = el.scrollHeight;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scorecard.status]);

  const handleDelete = async () => {
    await confirmDelete();
    navigate(-1);
  };

  /**
   * The message thread, memoized on the data it actually depends on.
   *
   * Every bubble holds a `<Markdown>` (Streamdown re-parses its source on each
   * render), so rebuilding the list is expensive. Without this, scroll-driven
   * state — `atBottom`, which shows the "scroll to latest" button — re-rendered
   * a few hundred markdown trees mid-scroll, which is what made a long
   * transcript stutter as you crossed the threshold. Returning the identical
   * element array lets React skip the whole subtree.
   */
  const transcriptMessages = useMemo(() => {
    if (view !== "transcript") return null;
    return messages?.messages.map((message, index, array) => {
      const isUser = message.role === "user";
      const isStreaming =
        completion.isLoading && !isUser && index === array.length - 1;
      const showDate =
        index === 0 ||
        moment(message.timestamp).format("YYYY-MM-DD") !==
          moment(array[index - 1]?.timestamp).format("YYYY-MM-DD");

      return (
        // data-message-id is the landing target for "Jump to transcript" in the
        // scorecard's evidence popovers. cp-thread-message contains layout so
        // one bubble changing can't reflow the whole thread (see global.css).
        <div
          key={message.id}
          data-message-id={message.id}
          className="cp-thread-message"
        >
          {/* Date separator */}
          {showDate && (
            <Badge
              variant={"outline"}
              className="flex items-center justify-center my-4 w-fit mx-auto"
            >
              {moment(message.timestamp).format("ddd, MMM D")}
            </Badge>
          )}

          {/* Message */}
          <div
            className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
          >
            {/* Avatar - Left side for bot */}
            {!isUser && (
              <div className="flex-shrink-0">
                <div className="size-7 lg:size-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <SparklesIcon className="size-3 lg:size-4 text-primary" />
                </div>
              </div>
            )}

            {/* Message content */}
            <div
              className={`flex flex-col gap-1 max-w-[70%] ${
                isUser ? "items-end" : "items-start"
              }`}
            >
              {/* transition-colors, not transition-all: `all` animates layout
                  properties too, so hovering a bubble mid-scroll kicked off
                  reflows across the thread. */}
              <Card
                className={`group p-3 text-sm lg:text-base transition-colors shadow-none ${
                  isUser
                    ? "!bg-primary text-primary-foreground !border-primary rounded-tr-sm"
                    : "!bg-muted/50 dark:!bg-muted/30 rounded-tl-sm"
                }`}
              >
                {isUser ? (
                  <Markdown>{message.content}</Markdown>
                ) : (
                  <>
                    <Markdown citations={message.citations}>
                      {linkifyCitations(message.content, message.citations)}
                    </Markdown>
                    {isStreaming && (
                      <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-primary align-middle" />
                    )}
                  </>
                )}
              </Card>
              <div
                className={`flex items-center gap-1 ${
                  isUser ? "flex-row-reverse" : ""
                }`}
              >
                <Badge
                  variant="outline"
                  className={`text-xs lg:text-sm bg-transparent border-none ${
                    isUser ? "-mr-1" : "-ml-1"
                  }`}
                >
                  {moment(message.timestamp).format("hh:mm A")}
                </Badge>
                <CopyButton content={message.content} />
              </div>
              {!isUser && <ContextUsed citations={message.citations} />}
            </div>

            {/* Avatar - Right side for user */}
            {isUser && (
              <div className="flex-shrink-0">
                <div className="size-7 lg:size-8 rounded-full bg-primary flex items-center justify-center">
                  <UserIcon className="size-3 lg:size-4 text-primary-foreground" />
                </div>
              </div>
            )}
          </div>
        </div>
      );
    });
  }, [view, messages?.messages, completion.isLoading]);

  return (
    <PageLayout
      isMainTitle={false}
      allowBackButton={true}
      title={messages?.title || ""}
      description={`${messages?.messages.length} messages in this conversation`}
      rightSlot={
        <div className="flex flex-row items-center gap-2">
          <Button
            variant="outline"
            title="Open this conversation in overlay"
            className="text-xs lg:text-sm h-7 lg:h-8"
            onClick={() =>
              conversationId && handleAttachToOverlay(conversationId)
            }
            disabled={isAttached}
          >
            {isAttached ? (
              <>
                <Check className="size-3 lg:size-4 text-green-600" />
                Attached
              </>
            ) : (
              <>
                Open in Overlay{" "}
                <MessageCircleReplyIcon className="size-3 lg:size-4" />
              </>
            )}
          </Button>
          <Button
            variant={"outline"}
            title="Download conversation as markdown"
            className="text-xs lg:text-sm h-7 lg:h-8"
            onClick={(e) => handleDownload(messages, e)}
            disabled={isDownloaded}
          >
            {isDownloaded ? (
              <>
                <Check className="size-3 lg:size-4 text-green-600" />
                Downloaded
              </>
            ) : (
              <>
                Download <Download className="size-3 lg:size-4" />
              </>
            )}
          </Button>
          <Button
            variant="destructive"
            title="Delete conversation"
            onClick={() =>
              conversationId && handleDeleteConfirm(conversationId)
            }
            className="text-xs lg:text-sm h-7 lg:h-8"
          >
            Delete <Trash2 className="size-3 lg:size-4" />
          </Button>
        </div>
      }
    >
      {messages?.messages.length === 0 ? (
        <Empty
          isLoading={false}
          icon={MessageCircleIcon}
          title="No messages found"
          description="Start a new message to get started"
        />
      ) : (
        <div
          className={cn(
            // cp-thread drops the per-bubble backdrop-filter that made long
            // transcripts scroll badly — see global.css.
            "cp-thread flex flex-col gap-4 px-2",
            hasSuggestions ? "pb-52" : "pb-28"
          )}
        >
          <ScorecardToolbar
            view={view}
            onViewChange={setView}
            kind={scorecard.kind}
            markdown={scorecardMarkdown}
            generatedAt={scorecard.generatedAt}
            stale={scorecard.stale}
            busy={scorecard.status === "loading"}
            onRegenerate={() => scorecard.generate(scorecard.kind ?? undefined)}
            onGradeAs={gradeAs}
            messageCount={messages?.messages.length ?? 0}
          />

          {view === "scorecard" ? (
            // !messages = the conversation is still loading from SQLite; show the
            // skeleton rather than flashing "No scorecard yet".
            !messages || scorecard.status === "loading" ? (
              <ScorecardLoading kind={scorecard.kind ?? undefined} />
            ) : scorecard.status === "ready" && scorecard.scorecard ? (
              <Scorecard
                scorecard={scorecard.scorecard}
                lines={scorecard.transcript.lines}
                onJumpToTranscript={jumpToTranscript}
              />
            ) : scorecard.status === "error" ? (
              <ScorecardErrorState
                message={
                  scorecard.error || "Something went wrong building the review."
                }
                onRetry={() => scorecard.generate(scorecard.kind ?? undefined)}
              />
            ) : (
              <ScorecardEmpty
                reason={
                  scorecard.status === "too-short"
                    ? "too-short"
                    : hasActiveLicense
                      ? "not-generated"
                      : "signed-out"
                }
                onGenerate={() => scorecard.generate()}
                onViewTranscript={() => setView("transcript")}
              />
            )
          ) : null}

          {transcriptMessages}

          {/* Thinking indicator — shown while the AI works before its answer
              starts streaming. */}
          {view === "transcript" &&
            completion.isLoading &&
            messages?.messages[messages.messages.length - 1]?.role ===
              "user" && (
              <div className="flex justify-start gap-3">
                <div className="flex-shrink-0">
                  <div className="size-7 lg:size-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <SparklesIcon className="size-3 lg:size-4 text-primary" />
                  </div>
                </div>
                <Card className="p-3 shadow-none !bg-muted/50 dark:!bg-muted/30 rounded-tl-sm">
                  <div className="flex items-center gap-2 text-sm lg:text-base text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Thinking…
                  </div>
                </Card>
              </div>
            )}

          <div ref={completion.messagesEndRef} />
        </div>
      )}

      {/* Sticky Footer Input — solid, not translucent: it sits ON TOP of the
          thread/scorecard, so a see-through background let messages and
          timestamps bleed through the composer and the suggestion chips. This is
          the dashboard window, not the overlay panel, so an opaque
          `bg-background` is correct here. */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-border bg-background">
        {/* Transcript only — "latest" means the newest message, which is
            meaningless on a scorecard (and it always opens at the top, so the
            button would otherwise appear immediately). */}
        {view === "transcript" && !atBottom && (
          <button
            onClick={scrollToBottom}
            title="Scroll to latest"
            aria-label="Scroll to latest"
            className="absolute -top-12 right-4 z-20 flex size-9 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md hover:bg-accent"
          >
            <ChevronDown className="size-5" />
          </button>
        )}
        {completion.error && (
          <div className="px-4 pt-3 pb-0">
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-base text-destructive">
              <strong>Error:</strong> {completion.error}
            </div>
          </div>
        )}

        {/* Suggested follow-up questions (pinned first, max 4), mirroring the overlay */}
        {hasActiveLicense &&
          (pinned.length > 0 || dynamicSuggestions.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
              <span className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <SparklesIcon className="size-3 text-primary" />
                Suggested
                {completion.suggestLoading && (
                  <Loader2 className="size-3 animate-spin" />
                )}
              </span>
              {[
                ...pinned.map((s) => ({ s, isP: true })),
                ...dynamicSuggestions.map((s) => ({ s, isP: false })),
              ].map(({ s, isP }) => {
                const atMax = !isP && pinned.length >= MAX_PINNED;
                return (
                  <div
                    key={`${isP ? "pin" : "dyn"}-${s.label}`}
                    className="group inline-flex items-center gap-0.5"
                  >
                    <button
                      onClick={() => {
                        setView("transcript");
                        completion.submit(s.label);
                      }}
                      disabled={completion.isLoading}
                      title={s.prompt}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:bg-accent",
                        isP
                          ? "border-primary/40 bg-primary/10"
                          : "border-border/60 bg-muted/40"
                      )}
                    >
                      {s.label}
                    </button>
                    <button
                      onClick={() => togglePin(s)}
                      disabled={atMax}
                      title={isP ? "Unpin" : atMax ? "Max 2 pinned" : "Pin"}
                      className={cn(
                        "rounded p-1 transition-opacity hover:bg-accent",
                        isP
                          ? "text-primary"
                          : "text-muted-foreground opacity-0 group-hover:opacity-100"
                      )}
                    >
                      <PinIcon className={cn("size-3", isP && "fill-current")} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

        <div className="relative flex items-start gap-2 p-4">
          {!hasActiveLicense && (
            <div className="select-none p-5 z-100 bg-primary/5 border border-primary/20 rounded-xl absolute top-4 left-4 right-4">
              <div className="max-w-sm mx-auto">
                <p className="text-base font-medium text-center">
                  You need an active license to use this feature.
                </p>

                <GetLicense
                  buttonText="Get License"
                  buttonClassName="w-full mt-2"
                />
              </div>
            </div>
          )}
          <div className="flex-1 relative">
            <div className="absolute bottom-2 left-2 flex items-center gap-1 z-10">
              <ChatFiles
                attachedFiles={completion.attachedFiles}
                handleFileSelect={completion.handleFileSelect}
                removeFile={completion.removeFile}
                onRemoveAllFiles={completion.onRemoveAllFiles}
                isLoading={completion.isLoading}
                isFilesPopoverOpen={completion.isFilesPopoverOpen}
                setIsFilesPopoverOpen={completion.setIsFilesPopoverOpen}
                disabled={!hasActiveLicense || !supportsImages}
              />
              <ChatScreenshot
                screenshotConfiguration={completion.screenshotConfiguration}
                attachedFiles={completion.attachedFiles}
                isLoading={completion.isLoading}
                captureScreenshot={completion.captureScreenshot}
                isScreenshotLoading={completion.isScreenshotLoading}
                disabled={!hasActiveLicense || !supportsImages}
              />
            </div>

            <Textarea
              ref={completion.inputRef}
              placeholder="Type a message..."
              className="pr-12 pl-2 resize-none pb-12 pt-3 text-base md:text-base"
              rows={2}
              value={completion.input}
              onChange={(e) => completion.setInput(e.target.value)}
              onKeyDown={(e) => {
                // The answer streams into the thread, so make sure it's visible.
                if (e.key === "Enter" && !e.shiftKey) setView("transcript");
                completion.handleKeyPress(e);
              }}
              onPaste={completion.handlePaste}
              disabled={completion.isLoading || !hasActiveLicense}
            />
            <Button
              size="icon"
              className="size-7 lg:size-9 rounded-lg lg:rounded-xl absolute right-2 bottom-2"
              title="Send message"
              onClick={() => {
                setView("transcript");
                completion.submit();
              }}
              disabled={
                completion.isLoading ||
                !completion.input.trim() ||
                !hasActiveLicense
              }
            >
              {completion.isLoading ? (
                <Loader2 className="size-3 lg:size-4 animate-spin" />
              ) : (
                <SendIcon className="size-3 lg:size-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        deleteConfirm={deleteConfirm}
        cancelDelete={cancelDelete}
        confirmDelete={handleDelete}
      />
    </PageLayout>
  );
};

export default View;
