import { useState, useCallback, useEffect, useRef } from "react";
import {
  Button,
  Popover,
  PopoverAnchor,
  PopoverContent,
  ScrollArea,
  CopyButton,
  Tooltip,
} from "@/components";
import {
  HeadphonesIcon,
  AlertCircleIcon,
  LoaderIcon,
  CameraIcon,
  PlusIcon,
  XIcon,
  MicIcon,
  MicOffIcon,
  PaperclipIcon,
  ArrowUpIcon,
  Maximize2,
  Minimize2,
  SparklesIcon,
  PauseIcon,
  PlayIcon,
  WandSparklesIcon,
  MessageCircleIcon,
  SearchIcon,
  EyeIcon,
  EyeOffIcon,
  StarIcon,
  ListChecksIcon,
  WorkflowIcon,
  PinIcon,
  ActivityIcon,
  AudioWaveformIcon,
  FileTextIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { expandQuickAction, SCENARIO_PROMPTS, STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage";
import { setSyncedItem } from "@/lib/sync/kv";
import { PinnedStrip, ReferencePanel } from "@/components/reference";
import {
  listReferenceDocs,
  readReferencePins,
  type ReferencePin,
} from "@/lib/reference";
import { ResultsSection } from "./ResultsSection";
import { SettingsPanel } from "./SettingsPanel";
import { PermissionFlow } from "./PermissionFlow";
import { useSystemAudioType, restoreWindowSize } from "@/hooks";
import { useApp } from "@/contexts";
import { cn } from "@/lib/utils";

// Persisted details-panel layout: which side rails are open, their widths, and
// whether the panel is maximized. Stored so closing and reopening the panel
// restores the same layout instead of snapping back to transcript-only.
// expandedWidth/Height capture the ACTUAL window size the panel had when it was
// last closed — including a size the user dragged to by hand or maximized to —
// so reopening restores that exact size rather than a recomputed preset.
type PanelLayout = {
  chatOpen: boolean;
  chatWide: boolean;
  refOpen: boolean;
  refWide: boolean;
  isMaximized: boolean;
  expandedWidth?: number;
  expandedHeight?: number;
};

const readPanelLayout = (): Partial<PanelLayout> => {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.PANEL_LAYOUT);
    return raw ? (JSON.parse(raw) as Partial<PanelLayout>) : {};
  } catch {
    return {};
  }
};

const writePanelLayout = (layout: PanelLayout): void => {
  safeLocalStorage.setItem(STORAGE_KEYS.PANEL_LAYOUT, JSON.stringify(layout));
};

// Pick a fitting icon for a live-insight based on its label keywords.
const insightIcon = (label: string): React.ElementType => {
  const l = label.toLowerCase();
  if (/(diagram|visual|flow|chart|map)/.test(l)) return WorkflowIcon;
  if (/(say|respond|reply|answer|pitch)/.test(l)) return WandSparklesIcon;
  if (/(question|ask|follow)/.test(l)) return MessageCircleIcon;
  if (/(fact|verify|check|accurate|research)/.test(l)) return SearchIcon;
  if (/(recap|summary|summarize|overview)/.test(l)) return EyeIcon;
  if (/(strength|highlight|impact|achievement|star|standout)/.test(l))
    return StarIcon;
  if (/(step|action|next|todo|task)/.test(l)) return ListChecksIcon;
  return SparklesIcon;
};

// A labeled row of small chips for a live Deepgram signal (topics, mentions…).
const SignalGroup = ({ label, items }: { label: string; items: string[] }) => (
  <div className="space-y-1">
    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
    <div className="flex flex-wrap gap-1">
      {items.map((t, i) => (
        <span
          key={`${label}-${i}-${t}`}
          className="max-w-full truncate rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[10px]"
          title={t}
        >
          {t}
        </span>
      ))}
    </div>
  </div>
);

export const SystemAudio = (props: useSystemAudioType) => {
  const {
    capturing,
    isProcessing,
    isAIProcessing,
    lastTranscription,
    lastCitations,
    lastAIResponse,
    lastTriageMode,
    lastTriageTopic,
    // The chat panel's live turn is separate state from the copilot's, so the
    // two streams can run at once without overwriting each other.
    isChatProcessing,
    chatQuestion,
    chatCitations,
    chatResponse,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    pauseCapture,
    resumeCapture,
    isPaused,
    isPopoverOpen,
    setIsPopoverOpen,
    startNewConversation,
    conversation,
    resizeWindow,
    quickActions,
    liveInsights,
    insightsLoading,
    sttEntities,
    sttIntelligence,
    scenarioKey,
    handleQuickActionClick,
    answerNow,
    vadConfig,
    updateVadConfiguration,
    scrollAreaRef,
    micEnabled,
    setMicEnabled,
    pendingImages,
    addPendingImage,
    removePendingImage,
  } = props;

  const { supportsImages, customizable, togglePrivacyMode } = useApp();
  // Privacy Mode lives in the shared store, so the overlay's toggle and the
  // dashboard's Settings switch are the same setting — read it, never mirror it.
  const privacyOn = customizable.privacyMode.isEnabled;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [followUp, setFollowUp] = useState("");
  const [imagesOpen, setImagesOpen] = useState(false);
  // Rail layout is seeded from the persisted panel layout so reopening the
  // panel restores whatever the user had open (see writePanelLayout calls).
  const initialLayout = useRef(readPanelLayout()).current;
  const [isMaximized, setIsMaximized] = useState(initialLayout.isMaximized ?? false);
  // The transcript is the main view; the chat opens as a separate pop-out.
  const [chatOpen, setChatOpen] = useState(initialLayout.chatOpen ?? false);
  // Whether the docked chat panel is expanded to a wider width.
  const [chatWide, setChatWide] = useState(initialLayout.chatWide ?? false);
  // Reference rail — read your resume / notes beside the live transcript.
  const [refOpen, setRefOpen] = useState(initialLayout.refOpen ?? false);
  const [refWide, setRefWide] = useState(initialLayout.refWide ?? false);
  const [refPins, setRefPins] = useState<ReferencePin[]>([]);
  const [refDocCount, setRefDocCount] = useState(0);
  // Pinned chat suggestions (max 2), persisted across sessions.
  const MAX_PINNED = 2;
  const [pinnedSuggestions, setPinnedSuggestions] = useState<
    { label: string; prompt: string }[]
  >([]);

  useEffect(() => {
    try {
      const raw = safeLocalStorage.getItem(
        STORAGE_KEYS.PINNED_CHAT_SUGGESTIONS
      );
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setPinnedSuggestions(arr.slice(0, MAX_PINNED));
      }
    } catch {
      // ignore malformed data
    }
  }, []);

  const persistPinned = (next: { label: string; prompt: string }[]) => {
    setPinnedSuggestions(next);
    // Synced across devices + shared with the main chat (see src/lib/sync/kv.ts).
    setSyncedItem(STORAGE_KEYS.PINNED_CHAT_SUGGESTIONS, JSON.stringify(next));
  };

  const isPinned = (label: string) =>
    pinnedSuggestions.some(
      (p) => p.label.trim().toLowerCase() === label.trim().toLowerCase()
    );

  const togglePin = (s: { label: string; prompt: string }) => {
    if (isPinned(s.label)) {
      persistPinned(
        pinnedSuggestions.filter(
          (p) => p.label.trim().toLowerCase() !== s.label.trim().toLowerCase()
        )
      );
    } else if (pinnedSuggestions.length < MAX_PINNED) {
      persistPinned([...pinnedSuggestions, { label: s.label, prompt: s.prompt }]);
    }
  };
  // Chat-specific attachments (kept separate from the transcript's pending
  // images so screenshots/uploads land in whichever surface you took them from).
  const [chatImages, setChatImages] = useState<string[]>([]);
  const [isChatShooting, setIsChatShooting] = useState(false);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const addChatImage = (b64: string) => setChatImages((p) => [...p, b64]);
  const removeChatImage = (i: number) =>
    setChatImages((p) => p.filter((_, idx) => idx !== i));

  // When the panel reopens, restore whatever size it had when it was closed.
  // We saved the ACTUAL window dimensions on close (see collapse), so this
  // brings back a size the user dragged to fill the screen or maximized to —
  // not just a recomputed preset. If we somehow have no saved size yet, fall
  // back to the rail-aware preset so an open rail still fits.
  useEffect(() => {
    if (!isPopoverOpen) return;
    const saved = readPanelLayout();
    if (saved.expandedWidth && saved.expandedHeight) {
      // restoreWindowSize marks the size as user-owned so the auto-expand path
      // (resizeWindow(true), fired when capture starts) can't clobber it back
      // to the 675 preset in the same tick the panel reopens.
      void restoreWindowSize(saved.expandedWidth, saved.expandedHeight);
    } else if (chatOpen || refOpen || isMaximized) {
      void applyPanelSize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPopoverOpen]);

  // Pinned reference lines persist across sessions, so load them once. The
  // strip is shown even with the rail closed — that's what pinning is for.
  useEffect(() => {
    setRefPins(readReferencePins());
  }, []);

  // How many reference files exist — drives the toggle's badge. Re-checked each
  // time the panel opens, since Files are managed in the other window.
  useEffect(() => {
    if (!isPopoverOpen) return;
    let cancelled = false;
    listReferenceDocs()
      .then((docs) => {
        if (!cancelled) setRefDocCount(docs.length);
      })
      .catch(() => {
        if (!cancelled) setRefDocCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [isPopoverOpen]);

  // Docked panel widths — normal vs. expanded, per rail.
  const CHAT_W_NORMAL = 380;
  const CHAT_W_WIDE = 680;
  const REF_W_NORMAL = 320;
  const REF_W_WIDE = 560;
  const chatPanelWidth = chatWide ? CHAT_W_WIDE : CHAT_W_NORMAL;
  const refPanelWidth = refWide ? REF_W_WIDE : REF_W_NORMAL;

  // Apply the window size from everything that affects width: whether the panel
  // is maximized, and which side rails are docked and how wide each one is.
  // Widening to the right makes a rail read as one window stretched out.
  // Named options (not positional args) because there are now four inputs and
  // two of them are booleans that would be trivially easy to swap.
  const applyPanelSize = async (
    opts: {
      maximized?: boolean;
      chat?: boolean;
      chatIsWide?: boolean;
      reference?: boolean;
      refIsWide?: boolean;
    } = {}
  ) => {
    const {
      maximized = isMaximized,
      chat = chatOpen,
      chatIsWide = chatWide,
      reference = refOpen,
      refIsWide = refWide,
    } = opts;
    const base = maximized ? 1000 : 600;
    const width =
      base +
      (chat ? (chatIsWide ? CHAT_W_WIDE : CHAT_W_NORMAL) : 0) +
      (reference ? (refIsWide ? REF_W_WIDE : REF_W_NORMAL) : 0);
    try {
      await invoke("set_window_size", { width, height: 600 });
    } catch (err) {
      console.error("Failed to resize window:", err);
    }
  };

  // Save the current rail layout with a patch of whatever just changed (state
  // setters are async, so the changed field is passed explicitly). The stored
  // expandedWidth/Height are carried over unless the patch overrides them, so a
  // rail toggle doesn't wipe the remembered window size.
  const persistLayout = (patch: Partial<PanelLayout>) => {
    const existing = readPanelLayout();
    writePanelLayout({
      chatOpen,
      chatWide,
      refOpen,
      refWide,
      isMaximized,
      expandedWidth: existing.expandedWidth,
      expandedHeight: existing.expandedHeight,
      ...patch,
    });
  };

  // Expand/shrink the window to give the content more room.
  const toggleMaximize = async () => {
    const next = !isMaximized;
    setIsMaximized(next);
    persistLayout({ isMaximized: next });
    await applyPanelSize({ maximized: next });
  };

  // Open/close the docked chat panel and stretch/shrink the window to fit.
  const setChat = async (open: boolean) => {
    setChatOpen(open);
    persistLayout({ chatOpen: open });
    await applyPanelSize({ chat: open });
  };

  // Widen / narrow just the docked chat panel.
  const toggleChatWide = async () => {
    const next = !chatWide;
    setChatWide(next);
    persistLayout({ chatWide: next });
    await applyPanelSize({ chat: true, chatIsWide: next });
  };

  // Open/close the reference rail and stretch/shrink the window to fit.
  const setReference = async (open: boolean) => {
    setRefOpen(open);
    persistLayout({ refOpen: open });
    await applyPanelSize({ reference: open });
  };

  // Widen / narrow just the reference rail.
  const toggleRefWide = async () => {
    const next = !refWide;
    setRefWide(next);
    persistLayout({ refWide: next });
    await applyPanelSize({ reference: true, refIsWide: next });
  };

  const followUpRef = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea up to ~3 lines, then scroll.
  const autoResizeFollowUp = () => {
    const el = followUpRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 72; // ~3 lines
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  };

  // Any interactive request (typed follow-up, quick action, live insight)
  // belongs in the Chat stream — open the chat pop-out so the answer is never
  // mixed into the live transcript.
  const runChat = (
    text: string,
    images: string[] = [],
    displayLabel?: string
  ) => {
    setChat(true);
    handleQuickActionClick(text, images, displayLabel);
  };

  const submitFollowUp = () => {
    const text = followUp.trim();
    if (!text && chatImages.length === 0) return;
    // Sending while a response is generating cancels it and answers this
    // question instead (processWithAI aborts any in-flight request).
    runChat(text || "What's in this image?", chatImages);
    setFollowUp("");
    setChatImages([]);
    if (followUpRef.current) followUpRef.current.style.height = "auto";
  };

  // Screenshot straight into the chat composer.
  const handleChatScreenshot = useCallback(async () => {
    if (isChatShooting) return;
    setIsChatShooting(true);
    try {
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac")) {
        const {
          checkScreenRecordingPermission,
          requestScreenRecordingPermission,
        } = await import("tauri-plugin-macos-permissions-api");
        const hasPermission = await checkScreenRecordingPermission();
        if (!hasPermission) {
          await requestScreenRecordingPermission();
          setIsChatShooting(false);
          return;
        }
      }
      const base64 = await invoke<string>("capture_to_base64");
      addChatImage(base64);
    } catch (err) {
      console.error("Failed to capture screenshot for chat:", err);
    } finally {
      setIsChatShooting(false);
    }
  }, [isChatShooting]);

  const handleChatFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.includes(",") ? result.split(",")[1] : result;
          addChatImage(base64);
        };
        reader.readAsDataURL(file);
      });
      if (chatFileInputRef.current) chatFileInputRef.current.value = "";
    },
    []
  );

  // Collapse the panel back to the minimal floating bar. Before shrinking we
  // snapshot the window's real size and persist it, so reopening restores
  // exactly what the user had — including a size they dragged to fill the
  // screen or maximized to, which the rail presets alone can't reproduce. The
  // rail layout is kept (not reset); only the window shrinks here.
  const collapse = async () => {
    // Snapshot the current expanded size first (await so we read it before the
    // shrink lands). Guard on a real panel height so we never store the bar.
    try {
      const win = getCurrentWebviewWindow();
      const scale = await win.scaleFactor();
      const size = await win.innerSize();
      const w = Math.round(size.width / scale);
      const h = Math.round(size.height / scale);
      if (h > 200) {
        persistLayout({ expandedWidth: w, expandedHeight: h });
      }
    } catch {
      // Not under Tauri (browser dev) — nothing to snapshot.
    }

    setIsPopoverOpen(false);
    if (isMaximized || chatOpen || refOpen) {
      invoke("set_window_size", { width: 600, height: 88 }).catch(() => {});
    } else {
      resizeWindow(false);
    }
  };

  // Screenshot state
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);

  // Do we have any interactive (typed) chat turns yet? Drives the Chat empty state.
  const hasChatMessages = conversation.messages.some(
    (m) => (m.origin ?? "transcript") === "chat"
  );

  // Suggested follow-ups for the chat: AI-generated insights first, topped up
  // with the default questions so there are always 3, and never more than 4.
  const MIN_SUGGESTIONS = 3;
  const MAX_SUGGESTIONS = 4;
  const chatSuggestions = (() => {
    const items = liveInsights
      .slice(0, MAX_SUGGESTIONS)
      .map((i) => ({ label: i.label, prompt: i.prompt }));
    const seen = new Set(items.map((i) => i.label.trim().toLowerCase()));
    for (const action of quickActions) {
      if (items.length >= MIN_SUGGESTIONS) break;
      const key = action.trim().toLowerCase();
      if (seen.has(key)) continue;
      items.push({ label: action, prompt: expandQuickAction(action) });
      seen.add(key);
    }
    return items.slice(0, MAX_SUGGESTIONS);
  })();

  // Pinned suggestions (max 2) stay available even as insights regenerate.
  const pinnedLabelSet = new Set(
    pinnedSuggestions.map((p) => p.label.trim().toLowerCase())
  );
  const dynamicSuggestions = chatSuggestions
    .filter((s) => !pinnedLabelSet.has(s.label.trim().toLowerCase()))
    .slice(0, Math.max(0, MAX_SUGGESTIONS - pinnedSuggestions.length));

  const handleToggleCapture = async () => {
    if (capturing) {
      await stopCapture();
    } else {
      await startCapture();
    }
  };

  // Capture screenshot functionality
  const handleCaptureScreenshot = useCallback(async () => {
    if (isCapturingScreenshot) return;

    setIsCapturingScreenshot(true);
    try {
      // Check screen recording permission on macOS
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac")) {
        const {
          checkScreenRecordingPermission,
          requestScreenRecordingPermission,
        } = await import("tauri-plugin-macos-permissions-api");

        const hasPermission = await checkScreenRecordingPermission();
        if (!hasPermission) {
          await requestScreenRecordingPermission();
          setIsCapturingScreenshot(false);
          return;
        }
      }

      // Capture the current monitor to a base64 PNG.
      const base64 = await invoke<string>("capture_to_base64");

      addPendingImage(base64);
      setImagesOpen(true);
    } catch (err) {
      console.error("Failed to capture screenshot:", err);
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [isCapturingScreenshot, addPendingImage]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.includes(",")
            ? result.split(",")[1]
            : result;
          addPendingImage(base64);
        };
        reader.readAsDataURL(file);
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      setImagesOpen(true);
    },
    [addPendingImage]
  );

  const getButtonIcon = () => {
    if (setupRequired) return <AlertCircleIcon className="text-orange-500" />;
    if (error && !setupRequired)
      return <AlertCircleIcon className="text-red-500" />;
    if (isProcessing) return <LoaderIcon className="animate-spin" />;
    if (capturing) return <XIcon />;
    return <HeadphonesIcon />;
  };

  const getButtonTitle = () => {
    if (setupRequired) return "Setup required - Click for instructions";
    if (error && !setupRequired) return `Error: ${error}`;
    if (isProcessing) return "Transcribing audio...";
    if (capturing) return "Listening. Click to stop";
    return "Start listening";
  };

  return (
    <Popover
      open={isPopoverOpen}
      onOpenChange={(open) => {
        if (capturing && !open) {
          return;
        }
        setIsPopoverOpen(open);
      }}
    >
      {/* Floating icon row: while a conversation is going, show a Pause button
          right next to the main stop button — so you can pause/resume and
          cancel from the floating pill itself (not just inside the panel). */}
      <div className="flex items-center justify-end gap-2">
        {capturing && !setupRequired && (
          <Tooltip label={isPaused ? "Resume listening" : "Pause listening"}>
            <Button
              size="icon"
              variant={isPaused ? "default" : "outline"}
              onClick={() => (isPaused ? resumeCapture() : pauseCapture())}
              className="rounded-full"
            >
              {isPaused ? (
                <PlayIcon className="size-4" />
              ) : (
                <PauseIcon className="size-4" />
              )}
            </Button>
          </Tooltip>
        )}
        <Tooltip label={getButtonTitle()}>
          <PopoverAnchor asChild>
            <Button
              size="icon"
              title={getButtonTitle()}
              onClick={handleToggleCapture}
              className={cn(
                "rounded-full",
                capturing && "bg-muted text-foreground hover:bg-muted/70",
                error && "bg-red-100 hover:bg-red-200"
              )}
            >
              {getButtonIcon()}
            </Button>
          </PopoverAnchor>
        </Tooltip>
      </div>

      {(capturing || setupRequired || error || isPopoverOpen) && (
        <PopoverContent
          align="end"
          side="bottom"
          className="select-none w-screen p-0 border shadow-lg overflow-hidden border-input/50"
          sideOffset={8}
        >
          <div
            className="relative flex h-[calc(100vh-4rem)] overflow-hidden rounded-xl"
            style={{
              // Honor the app-wide transparency setting so the overlay panel
              // (transcript + chat) can be see-through like the rest of the UI.
              backgroundColor: "rgb(from var(--background) r g b / var(--opacity, 1))",
              backdropFilter: "var(--backdrop-blur, none)",
            }}
          >

            {/* Left sidebar */}
            {!setupRequired && (
              <aside className="w-64 shrink-0 border-r border-border/50 bg-muted/20 flex flex-col">
                <div className="p-2">
                  <button
                    onClick={startNewConversation}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <PlusIcon className="size-3.5" /> New conversation
                  </button>
                </div>

                <hr className="border-t border-border/50" />

                <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-2">
                  {/* Default questions — always available */}
                  <div>
                    <p className="flex items-center gap-1.5 px-1 pb-2 text-xs font-semibold">
                      <SparklesIcon className="size-3.5 text-primary" />
                      Default questions
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {quickActions.map((action) => {
                        const Icon = insightIcon(action);
                        return (
                          <button
                            key={action}
                            onClick={() =>
                              runChat(expandQuickAction(action), [], action)
                            }
                            title={action}
                            className="group flex w-full items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-2 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                          >
                            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-background/70 text-foreground/70 group-hover:text-primary">
                              <Icon className="size-3.5" />
                            </span>
                            <span className="flex-1 min-w-0 text-[11px] leading-snug">
                              {action}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Live signals — Deepgram Speech Intelligence (topics,
                      entities, sentiment) detected from what's being heard. */}
                  {(sttIntelligence.topics?.length ||
                    sttIntelligence.intents?.length ||
                    sttIntelligence.sentiment ||
                    sttEntities.length > 0) && (
                    <>
                      <hr className="border-t border-border/50" />
                      <div>
                        <p className="flex items-center gap-1.5 px-1 pb-2 text-xs font-semibold">
                          <ActivityIcon className="size-3.5 text-primary" />
                          Live signals
                        </p>
                        <div className="space-y-2 px-1">
                          {sttIntelligence.topics?.length ? (
                            <SignalGroup
                              label="Topics"
                              items={sttIntelligence.topics}
                            />
                          ) : null}
                          {sttIntelligence.intents?.length ? (
                            <SignalGroup
                              label="Intent"
                              items={sttIntelligence.intents}
                            />
                          ) : null}
                          {sttEntities.length > 0 ? (
                            <SignalGroup
                              label="Mentions"
                              items={sttEntities.slice(-8).map((e) => e.value)}
                            />
                          ) : null}
                          {sttIntelligence.sentiment ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Sentiment
                              </span>
                              <span className="rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[10px] capitalize">
                                {sttIntelligence.sentiment}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </>
                  )}

                  <hr className="border-t border-border/50" />

                  {/* Settings (has its own header) */}
                  <SettingsPanel
                    vadConfig={vadConfig}
                    onUpdateVadConfig={updateVadConfiguration}
                  />
                </div>
              </aside>
            )}

            {/* Main pane */}
            <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
            {/* Header - Mode Switcher + Actions */}
            <div className="flex-shrink-0 p-3 border-b border-border/50">
              <div className="space-y-2">
                {/* Mode switcher + close (top of popover) */}
                <div className="flex items-center gap-2">
                  {!setupRequired ? (
                    <div className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted text-xs font-medium text-foreground">
                      <AudioWaveformIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      Auto-detect
                    </div>
                  ) : (
                    <h2 className="flex-1 font-semibold text-sm">
                      Setup Required
                    </h2>
                  )}
                  <Tooltip
                    label={isMaximized ? "Shrink" : "Expand"}
                    align="end"
                  >
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={toggleMaximize}
                    >
                      {isMaximized ? (
                        <Minimize2 className="h-3.5 w-3.5" />
                      ) : (
                        <Maximize2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </Tooltip>
                  <Tooltip label="Close" align="end">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={collapse}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  </Tooltip>
                </div>

                {/* Title + action icons.
                    The main pane is ~355px wide with the sidebar open, so this
                    row has to survive being narrow: the status + live-mode chip
                    shrink and truncate, the icon group never shrinks, and the
                    whole thing wraps to a second line before anything clips. */}
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {isPaused
                        ? "Paused"
                        : capturing
                        ? "Listening"
                        : "Assistant"}
                    </span>
                    {scenarioKey && scenarioKey !== "generic" && (
                      <span
                        className="inline-flex min-w-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                        title="Live mode from your persona or detected conversation; the assistant is tailored to this"
                      >
                        <SparklesIcon className="size-2.5 shrink-0" />
                        <span className="truncate">
                          {SCENARIO_PROMPTS[scenarioKey]?.label}
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Privacy Mode — right here, because the moment you need it
                      (someone's about to share your screen) is the moment you
                      don't want to go hunting through the dashboard. Same
                      setting as Settings → Privacy Mode; also in this panel's
                      left sidebar under Settings → Privacy. Deliberately not
                      gated on setup: the window is on screen either way. */}
                  <Tooltip
                    label={
                      privacyOn
                        ? "Privacy Mode on. This window is hidden from screen shares and recordings. Click to show it."
                        : "Privacy Mode off. This window shows up in screen shares. Click to hide it."
                    }
                    align="end"
                    wide
                  >
                    <Button
                      size="icon"
                      variant={privacyOn ? "default" : "outline"}
                      onClick={() => void togglePrivacyMode(!privacyOn)}
                      aria-pressed={privacyOn}
                      aria-label={
                        privacyOn ? "Turn off Privacy Mode" : "Turn on Privacy Mode"
                      }
                      className="h-6 w-6"
                    >
                      {privacyOn ? (
                        <EyeOffIcon className="w-3 h-3" />
                      ) : (
                        <EyeIcon className="w-3 h-3" />
                      )}
                    </Button>
                  </Tooltip>

                  {/* Open the Chat pop-out (separate from the transcript) */}
                  {!setupRequired && (
                    <Tooltip label="Chat with data" align="end">
                      <div className="relative">
                        <Button
                          size="icon"
                          variant={chatOpen ? "default" : "outline"}
                          onClick={() => setChat(!chatOpen)}
                          className="h-6 w-6"
                        >
                          <MessageCircleIcon className="w-3 h-3" />
                        </Button>
                        {hasChatMessages && !chatOpen && (
                          <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-semibold text-primary-foreground">
                            {
                              conversation.messages.filter(
                                (m) =>
                                  (m.origin ?? "transcript") === "chat" &&
                                  m.role === "assistant"
                              ).length
                            }
                          </span>
                        )}
                      </div>
                    </Tooltip>
                  )}

                  {/* Reference rail — resume / notes beside the transcript */}
                  {!setupRequired && (
                    <Tooltip
                      label="Reference: your resume & notes"
                      align="end"
                      wide
                    >
                      <div className="relative">
                        <Button
                          size="icon"
                          variant={refOpen ? "default" : "outline"}
                          onClick={() => setReference(!refOpen)}
                          className="h-6 w-6"
                        >
                          <FileTextIcon className="w-3 h-3" />
                        </Button>
                        {refDocCount > 0 && !refOpen && (
                          <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-semibold text-primary-foreground">
                            {refDocCount}
                          </span>
                        )}
                      </div>
                    </Tooltip>
                  )}

                  {/* Mic on/off toggle */}
                  {!setupRequired && (
                    <Tooltip
                      label={micEnabled ? "Mute mic" : "Unmute mic"}
                      align="end"
                    >
                      <Button
                        size="icon"
                        variant={micEnabled ? "default" : "outline"}
                        onClick={() => setMicEnabled(!micEnabled)}
                        className="h-6 w-6"
                      >
                        {micEnabled ? (
                          <MicIcon className="w-3 h-3" />
                        ) : (
                          <MicOffIcon className="w-3 h-3" />
                        )}
                      </Button>
                    </Tooltip>
                  )}

                  {/* Attachments (uploads + screenshots) with count badge */}
                  {!setupRequired && supportsImages && (
                    <Tooltip
                      label={
                        pendingImages.length > 0
                          ? "View attachments"
                          : "Attach image"
                      }
                      align="end"
                    >
                    <Popover
                      open={imagesOpen && pendingImages.length > 0}
                      onOpenChange={setImagesOpen}
                    >
                      <PopoverAnchor asChild>
                        <div className="relative">
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => {
                              if (pendingImages.length === 0) {
                                fileInputRef.current?.click();
                              } else {
                                setImagesOpen((v) => !v);
                              }
                            }}
                            className="h-6 w-6"
                            title={
                              pendingImages.length > 0
                                ? "View attachments"
                                : "Attach an image to send with your next message"
                            }
                          >
                            <PaperclipIcon className="w-3 h-3" />
                          </Button>
                          {pendingImages.length > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                              {pendingImages.length}
                            </span>
                          )}
                        </div>
                      </PopoverAnchor>
                      <PopoverContent
                        align="end"
                        side="bottom"
                        sideOffset={8}
                        className="w-72 p-2"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium">
                            Attachments ({pendingImages.length})
                          </span>
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="text-[11px] text-primary hover:underline"
                          >
                            + Add
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                          {pendingImages.map((img, i) => (
                            <div key={i} className="relative">
                              <img
                                src={`data:image/png;base64,${img}`}
                                alt={`Attachment ${i + 1}`}
                                className="h-20 w-full object-cover rounded border"
                              />
                              <button
                                onClick={() => removePendingImage(i)}
                                className="absolute top-1 right-1 bg-background/90 border rounded-full p-0.5"
                                title="Remove"
                              >
                                <XIcon className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                    </Tooltip>
                  )}

                  {/* Screenshot Button */}
                  {!setupRequired && supportsImages && (
                    <Tooltip label="Screenshot" align="end">
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={handleCaptureScreenshot}
                        disabled={isCapturingScreenshot}
                        className="h-6 w-6"
                      >
                        {isCapturingScreenshot ? (
                          <LoaderIcon className="w-3 h-3 animate-spin" />
                        ) : (
                          <CameraIcon className="w-3 h-3" />
                        )}
                      </Button>
                    </Tooltip>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  </div>
                </div>
              </div>
            </div>

            {/* Content area — the transcript record. */}
            <div className="flex flex-1 flex-col min-h-0">

            {/* Lines pinned from a reference doc — stay visible with the rail
                closed, so a key number is never a panel away mid-answer. */}
            {!setupRequired && (
              <PinnedStrip pins={refPins} onPinsChange={setRefPins} />
            )}

            {/* Global error (shown above both streams) */}
            {error && !setupRequired && (
              <div className="flex-shrink-0 px-2 pt-2">
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                  <AlertCircleIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-medium text-red-800">Error</p>
                    <p className="text-[10px] text-red-700">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Main view is always the Transcript & AI record. The Chat is a
                separate pop-out opened on demand (see below). */}
            {setupRequired ? (
              <ScrollArea className="flex-1 min-h-0" ref={scrollAreaRef}>
                <div className="p-2 space-y-2">
                  <PermissionFlow
                    onPermissionGranted={() => {
                      startCapture();
                    }}
                    onPermissionDenied={() => {
                      // Keep showing setup instructions
                    }}
                  />
                </div>
              </ScrollArea>
            ) : (
              /* A flex column, not a ScrollArea. The transcript card brings its
                 own scroller, so wrapping it in a second one gained nothing and
                 cost the layout: the card could only ever be as tall as its own
                 cap, and any panel height beyond that showed up as a dead band
                 of empty space below the last message. Here the card is a flex
                 child with a definite height to fill, so dragging the panel
                 taller gives the transcript the extra room. */
              <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
                  {/* Force an answer without waiting for the pause in speech.
                      Pinned above the thread rather than scrolling away with it,
                      which is what you want from a button whose whole point is
                      to be reachable mid-conversation. */}
                  {capturing && (
                    <Button
                      variant="outline"
                      onClick={() => answerNow()}
                      disabled={isAIProcessing}
                      className="w-full shrink-0 gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                      title="Answer the latest point now; don't wait for a pause"
                    >
                      <WandSparklesIcon className="size-3.5" />
                      {isAIProcessing ? "Answering…" : "Answer now"}
                    </Button>
                  )}

                  <ResultsSection
                    variant="transcript"
                    fill
                    liveQuestion={lastTranscription}
                    liveCitations={lastCitations}
                    liveResponse={lastAIResponse}
                    liveTriageMode={lastTriageMode}
                    liveTriageTopic={lastTriageTopic}
                    isProcessing={isProcessing}
                    isLiveProcessing={isAIProcessing}
                    conversation={conversation}
                    active={capturing || isPaused}
                  />
              </div>
            )}

            </div>
            </div>

            {/* Chat panel — docked to the right. The window widens to fit it so
                it reads as one window stretched out, side-by-side with the
                transcript rather than covering it. */}
            {!setupRequired && chatOpen && (
              <aside
                style={{
                  width: chatPanelWidth,
                  backgroundColor:
                    "rgb(from var(--background) r g b / var(--opacity, 1))",
                }}
                className="flex shrink-0 flex-col border-l border-border/50"
              >
                <div className="flex flex-shrink-0 items-center justify-between border-b border-border/50 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <MessageCircleIcon className="size-3.5 text-primary" />
                    <span className="text-xs font-medium">Chat with data</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Tooltip
                      label={chatWide ? "Shrink chat" : "Expand chat"}
                      align="end"
                    >
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={toggleChatWide}
                      >
                        {chatWide ? (
                          <Minimize2 className="h-3.5 w-3.5" />
                        ) : (
                          <Maximize2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </Tooltip>
                    <Tooltip label="Close chat" align="end">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => setChat(false)}
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </Button>
                    </Tooltip>
                  </div>
                </div>

                <ScrollArea className="flex-1 min-h-0">
                  <div className="p-2 space-y-2">
                    {!hasChatMessages && !isChatProcessing && (
                      <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
                        <MessageCircleIcon className="size-5 text-muted-foreground" />
                        <p className="text-xs font-medium">
                          Chat with your conversation
                        </p>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          Ask questions about what's been said and any attached
                          files. This stays separate from the live transcript.
                        </p>
                      </div>
                    )}
                    <ResultsSection
                      variant="chat"
                      liveQuestion={chatQuestion}
                      liveCitations={chatCitations}
                      liveResponse={chatResponse}
                      isProcessing={isProcessing}
                      isLiveProcessing={isChatProcessing}
                      conversation={conversation}
                    />
                  </div>
                </ScrollArea>

                {/* Suggested follow-up questions (tailored to the conversation),
                    shown as pills above the input. Pinned ones (max 2) stay put;
                    the rest are dynamic and topped up with default questions. */}
                {(pinnedSuggestions.length > 0 ||
                  dynamicSuggestions.length > 0) && (
                  <div className="flex-shrink-0 space-y-1.5 border-t border-border/50 px-2 pt-2">
                    <div className="flex items-center gap-1.5 px-1">
                      <SparklesIcon className="size-3 text-primary" />
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Suggested
                      </span>
                      {insightsLoading && (
                        <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {[
                        ...pinnedSuggestions.map((s) => ({ s, pinned: true })),
                        ...dynamicSuggestions.map((s) => ({ s, pinned: false })),
                      ].map(({ s, pinned }) => {
                        const atMax =
                          !pinned && pinnedSuggestions.length >= MAX_PINNED;
                        return (
                          <div
                            key={`${pinned ? "pin" : "dyn"}-${s.label}`}
                            className="group flex items-center gap-1"
                          >
                            <button
                              onClick={() => runChat(s.prompt, [], s.label)}
                              title={s.prompt}
                              className={cn(
                                "flex-1 truncate rounded-full border px-3 py-1.5 text-left text-xs transition-colors hover:border-primary/50 hover:bg-accent",
                                pinned
                                  ? "border-primary/40 bg-primary/10"
                                  : "border-border/60 bg-muted/40"
                              )}
                            >
                              {s.label}
                            </button>
                            <button
                              onClick={() => togglePin(s)}
                              disabled={atMax}
                              title={
                                pinned
                                  ? "Unpin"
                                  : atMax
                                  ? "Max 2 pinned"
                                  : "Pin suggestion"
                              }
                              className={cn(
                                "shrink-0 rounded p-1 transition-opacity hover:bg-accent",
                                pinned
                                  ? "text-primary"
                                  : cn(
                                      "text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100",
                                      atMax && "cursor-not-allowed"
                                    )
                              )}
                            >
                              <PinIcon
                                className={cn(
                                  "size-3",
                                  pinned && "fill-current"
                                )}
                              />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex-shrink-0 border-t border-border/50 p-2">
                  {/* Attached image thumbnails */}
                  {chatImages.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {chatImages.map((img, i) => (
                        <div key={i} className="relative">
                          <img
                            src={`data:image/png;base64,${img}`}
                            alt={`Attachment ${i + 1}`}
                            className="h-14 w-14 rounded-md border object-cover"
                          />
                          <button
                            onClick={() => removeChatImage(i)}
                            className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5"
                            title="Remove"
                          >
                            <XIcon className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-end gap-1.5 rounded-2xl border border-input/60 bg-background/40 pl-2 pr-1.5 py-1.5">
                    {/* Attach + screenshot into the chat */}
                    {supportsImages && (
                      <>
                        <Tooltip label="Attach image" align="start" side="top">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            onClick={() => chatFileInputRef.current?.click()}
                          >
                            <PaperclipIcon className="h-4 w-4" />
                          </Button>
                        </Tooltip>
                        <Tooltip
                          label="Screenshot into chat"
                          align="start"
                          side="top"
                        >
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            onClick={handleChatScreenshot}
                            disabled={isChatShooting}
                          >
                            {isChatShooting ? (
                              <LoaderIcon className="h-4 w-4 animate-spin" />
                            ) : (
                              <CameraIcon className="h-4 w-4" />
                            )}
                          </Button>
                        </Tooltip>
                        <input
                          ref={chatFileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleChatFileUpload}
                          className="hidden"
                        />
                      </>
                    )}

                    <textarea
                      ref={followUpRef}
                      rows={1}
                      value={followUp}
                      onChange={(e) => {
                        setFollowUp(e.target.value);
                        autoResizeFollowUp();
                      }}
                      onKeyDown={(e) => {
                        // Enter sends; Shift+Enter inserts a new line.
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          submitFollowUp();
                        }
                      }}
                      placeholder="Ask a question… (Enter to send, Shift+Enter for a new line)"
                      className="flex-1 resize-none bg-transparent text-sm leading-5 outline-none placeholder:text-muted-foreground max-h-[72px] overflow-y-auto py-1 select-text"
                    />
                    {/* Composer sits in the chat panel → copy the chat answer,
                        not whatever the live copilot last suggested. */}
                    {chatResponse && <CopyButton content={chatResponse} />}
                    <Button
                      size="icon"
                      className="h-7 w-7 rounded-full shrink-0"
                      onClick={submitFollowUp}
                      disabled={!followUp.trim() && chatImages.length === 0}
                      title="Send (Enter)"
                    >
                      <ArrowUpIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </aside>
            )}

            {/* Reference rail — docked to the far right so your resume/notes sit
                beside the transcript (and beside the chat) rather than over it. */}
            {!setupRequired && refOpen && (
              <ReferencePanel
                width={refPanelWidth}
                wide={refWide}
                onToggleWide={toggleRefWide}
                onClose={() => setReference(false)}
                pins={refPins}
                onPinsChange={setRefPins}
              />
            )}

            {/* Free-resize handle — drag the bottom-right corner to size the
                window as big (or small) as you want. */}
            {!setupRequired && (
              <div
                data-overlay-interactive="true"
                onMouseDown={(e) => {
                  e.preventDefault();
                  // "SouthEast" = bottom-right resize (ResizeDirection enum value).
                  getCurrentWebviewWindow()
                    .startResizeDragging("SouthEast" as never)
                    .catch(() => {});
                }}
                title="Drag to resize"
                className="absolute bottom-0 right-0 z-40 flex size-4 cursor-nwse-resize items-end justify-end p-[3px] text-muted-foreground/60 hover:text-foreground"
              >
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 9 9"
                  className="pointer-events-none"
                >
                  <path
                    d="M8 2 L2 8 M8 5.5 L5.5 8"
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            )}
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
};
