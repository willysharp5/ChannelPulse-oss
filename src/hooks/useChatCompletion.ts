import { useState, useCallback, useRef, useEffect } from "react";
import { useApp } from "@/contexts";
import { MAX_FILES, CHAT_ANALYSIS_SYSTEM_PROMPT } from "@/config";
import { px } from "@/lib/prompts/overrides";
import {
  fetchAIResponse,
  saveConversation,
  getConversationById,
  generateConversationTitle,
  shouldUseChannelPulseAPI,
  MESSAGE_ID_OFFSET,
  generateMessageId,
  generateRequestId,
  getResponseSettings,
} from "@/lib";
import {
  buildTranscriptContext,
  toChatAnalysisHistory,
  transcriptCitation,
} from "@/lib/chat/transcript";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatConversation, ChatMessage, Citation } from "@/types/completion";

// Types for completion
interface AttachedFile {
  id: string;
  name: string;
  type: string;
  base64: string;
  size: number;
}

interface ChatCompletionState {
  input: string;
  isLoading: boolean;
  error: string | null;
  attachedFiles: AttachedFile[];
}

export const useChatCompletion = (
  conversationId: string,
  messages: ChatConversation | null,
  setMessages: (messages: ChatConversation | null) => void
) => {
  const {
    selectedAIProvider,
    allAiProviders,
    screenshotConfiguration,
    setScreenshotConfiguration,
    selectedSttProvider,
    allSttProviders,
    selectedAudioDevices,
    hasActiveLicense,
  } = useApp();

  const [state, setState] = useState<ChatCompletionState>({
    input: "",
    isLoading: false,
    error: null,
    attachedFiles: [],
  });

  const [micOpen, setMicOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isFilesPopoverOpen, setIsFilesPopoverOpen] = useState(false);
  const [isScreenshotLoading, setIsScreenshotLoading] = useState(false);

  // Suggested follow-up questions, generated from the conversation.
  const [suggestions, setSuggestions] = useState<
    { label: string; prompt: string }[]
  >([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const suggestBusyRef = useRef(false);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generateSuggestions = useCallback(async () => {
    if (suggestBusyRef.current) return;
    const msgs = messages?.messages || [];
    const transcript = msgs
      .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
      .join("\n")
      .slice(-4000);
    if (transcript.length < 40) return;

    const useChannelPulseAPI = await shouldUseChannelPulseAPI();
    const provider = allAiProviders.find(
      (p) => p.id === selectedAIProvider.provider
    );
    if (!provider && !useChannelPulseAPI) return;

    suggestBusyRef.current = true;
    setSuggestLoading(true);
    try {
      let full = "";
      for await (const chunk of fetchAIResponse({
        provider: useChannelPulseAPI ? undefined : provider,
        selectedProvider: selectedAIProvider,
        systemPrompt:
          "From this conversation, produce 3-5 SHORT, natural follow-up questions the user might want answered next, tailored to it. " +
          'Return ONLY a compact JSON array, no prose, no code fences: [{"label":"the question, <= 9 words, ends with ?","prompt":"the same question, optionally expanded, for the assistant to answer"}]',
        userMessage: `Conversation:\n${transcript}`,
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
            .filter(
              (i) =>
                i && typeof i.label === "string" && typeof i.prompt === "string"
            )
            .slice(0, 5)
            .map((i) => ({ label: i.label.trim(), prompt: i.prompt.trim() }));
          if (cleaned.length) setSuggestions(cleaned);
        }
      }
    } catch {
      // best-effort
    } finally {
      suggestBusyRef.current = false;
      setSuggestLoading(false);
    }
  }, [messages, selectedAIProvider, allAiProviders]);

  // Regenerate suggestions shortly after the conversation changes.
  useEffect(() => {
    const len = (messages?.messages || []).reduce(
      (n, m) => n + m.content.length,
      0
    );
    if (len === 0 || state.isLoading) return;
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    suggestTimerRef.current = setTimeout(generateSuggestions, 1200);
    return () => {
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages?.messages.length, state.isLoading]);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const isProcessingScreenshotRef = useRef(false);
  const screenshotConfigRef = useRef(screenshotConfiguration);
  const hasCheckedPermissionRef = useRef(false);
  const screenshotInitiatedByThisContext = useRef(false);

  useEffect(() => {
    screenshotConfigRef.current = screenshotConfiguration;
  }, [screenshotConfiguration]);

  const scrollToBottom = () => {
    const responseSettings = getResponseSettings();
    if (responseSettings.autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };

  const setInput = useCallback((value: string) => {
    setState((prev) => ({ ...prev, input: value }));
  }, []);

  const addFile = useCallback(async (file: File) => {
    try {
      const base64 = await fileToBase64(file);
      const attachedFile: AttachedFile = {
        id: Date.now().toString(),
        name: file.name,
        type: file.type,
        base64,
        size: file.size,
      };

      setState((prev) => ({
        ...prev,
        attachedFiles: [...prev.attachedFiles, attachedFile],
      }));
    } catch (error) {
      console.error("Failed to process file:", error);
    }
  }, []);

  const removeFile = useCallback((fileId: string) => {
    setState((prev) => ({
      ...prev,
      attachedFiles: prev.attachedFiles.filter((f) => f.id !== fileId),
    }));
  }, []);

  const clearFiles = useCallback(() => {
    setState((prev) => ({ ...prev, attachedFiles: [] }));
  }, []);

  const submit = useCallback(
    async (speechText?: string, extraImageBase64?: string) => {
      const input = speechText || state.input;

      if (!input.trim()) {
        return;
      }

      // hasActiveLicense includes account Pro/trial — not just the device trial.
      if (!hasActiveLicense) {
        setState((prev) => ({
          ...prev,
          error:
            "Your ChannelPulse trial has ended. Open the Dashboard to upgrade.",
        }));
        return;
      }

      if (speechText) {
        setState((prev) => ({
          ...prev,
          input: speechText,
        }));
      }

      // Generate unique request ID
      const requestId = generateRequestId();
      currentRequestIdRef.current = requestId;

      // Cancel any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      try {
        // History + explicit transcript block so chat grounds in what was said
        // (works for live overlay sessions opened later in /chats too).
        const prior = messages?.messages || [];
        const messageHistory = toChatAnalysisHistory(prior, conversationId);
        const transcriptBlock = buildTranscriptContext(prior, conversationId);
        const transcriptCite = transcriptCitation(prior, conversationId);

        // Handle image attachments
        const imagesBase64: string[] = [];
        if (state.attachedFiles.length > 0) {
          state.attachedFiles.forEach((file) => {
            if (file.type.startsWith("image/")) {
              imagesBase64.push(file.base64);
            }
          });
        }
        // Passed directly by callers (e.g. auto-mode screenshot capture) that
        // can't rely on `state.attachedFiles` having been updated yet — avoids
        // a stale-closure race where the just-captured image never reaches
        // the request because this `submit` closure predates the setState.
        if (extraImageBase64 && !imagesBase64.includes(extraImageBase64)) {
          imagesBase64.push(extraImageBase64);
        }

        const useChannelPulseAPI = await shouldUseChannelPulseAPI();
        // Check if AI provider is configured
        if (!selectedAIProvider.provider && !useChannelPulseAPI) {
          setState((prev) => ({
            ...prev,
            error: "Please select an AI provider in settings",
          }));
          return;
        }

        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        if (!provider && !useChannelPulseAPI) {
          setState((prev) => ({
            ...prev,
            error: "Invalid provider selected",
          }));
          return;
        }

        // Add user message to UI immediately
        const timestamp = Date.now();
        const userMsg: ChatMessage = {
          id: generateMessageId("user", timestamp),
          role: "user",
          content: input,
          timestamp,
          origin: "chat",
        };

        const updatedMessages = {
          ...messages!,
          messages: [...(messages?.messages || []), userMsg],
        };
        setMessages(updatedMessages);

        // Clear input and set loading state
        setState((prev) => ({
          ...prev,
          input: "",
          isLoading: true,
          error: null,
          attachedFiles: [],
        }));

        // Scroll to bottom after adding user message
        setTimeout(scrollToBottom, 100);

        let fullResponse = "";
        let turnCitations: Citation[] = transcriptCite ? [transcriptCite] : [];

        try {
          // Use the fetchAIResponse function with signal
          for await (const chunk of fetchAIResponse({
            provider: useChannelPulseAPI ? undefined : provider,
            selectedProvider: selectedAIProvider,
            systemPrompt: px("chat.analysis", CHAT_ANALYSIS_SYSTEM_PROMPT),
            history: messageHistory,
            userMessage: input,
            imagesBase64,
            signal,
            extraContext: transcriptBlock || undefined,
            // Web research (Firecrawl) is always available in the chat.
            useWeb: true,
            onCitations: (c) => {
              turnCitations = transcriptCite ? [transcriptCite, ...c] : c;
            },
          })) {
            // Only update if this is still the current request
            if (currentRequestIdRef.current !== requestId) {
              return; // Request was superseded, stop processing
            }

            // Check if request was aborted
            if (signal.aborted) {
              return; // Request was cancelled, stop processing
            }

            fullResponse += chunk;

            // Update the last message (assistant's response) in real-time
            const assistantMsg: ChatMessage = {
              id: generateMessageId("assistant", timestamp + MESSAGE_ID_OFFSET),
              role: "assistant",
              content: fullResponse,
              timestamp: timestamp + MESSAGE_ID_OFFSET,
              origin: "chat",
              citations: turnCitations.length ? turnCitations : undefined,
            };

            const updatedWithResponse = {
              ...updatedMessages,
              messages: [...updatedMessages.messages, assistantMsg],
            };

            // Check if assistant message already exists
            const lastMessage =
              updatedWithResponse.messages[
                updatedWithResponse.messages.length - 1
              ];
            if (lastMessage.role === "assistant") {
              // Update existing assistant message
              updatedWithResponse.messages[
                updatedWithResponse.messages.length - 1
              ] = assistantMsg;
            } else {
              // Add new assistant message
              updatedWithResponse.messages.push(assistantMsg);
            }

            setMessages(updatedWithResponse);

            // Auto-scroll during streaming
            scrollToBottom();
          }
        } catch (e: any) {
          // Only show error if this is still the current request and not aborted
          if (currentRequestIdRef.current === requestId && !signal.aborted) {
            setState((prev) => ({
              ...prev,
              isLoading: false,
              error: e.message || "An error occurred",
            }));
          }
          return;
        }

        // Only proceed if this is still the current request
        if (currentRequestIdRef.current !== requestId || signal.aborted) {
          return;
        }

        setState((prev) => ({ ...prev, isLoading: false }));

        // Focus input after AI response is complete
        setTimeout(() => {
          inputRef.current?.focus();
        }, 100);

        // Save the conversation after successful completion
        if (fullResponse) {
          const assistantMsg: ChatMessage = {
            id: generateMessageId("assistant", timestamp + MESSAGE_ID_OFFSET),
            role: "assistant",
            content: fullResponse,
            timestamp: timestamp + MESSAGE_ID_OFFSET,
            origin: "chat",
            citations: turnCitations.length ? turnCitations : undefined,
          };

          const newMessages = [
            ...(messages?.messages || []),
            userMsg,
            assistantMsg,
          ];

          // Get existing conversation if updating
          let existingConversation = null;
          if (conversationId) {
            try {
              existingConversation = await getConversationById(conversationId);
            } catch (error) {
              console.error("Failed to get existing conversation:", error);
            }
          }

          const title =
            existingConversation?.title ||
            messages?.title ||
            generateConversationTitle(input);

          const conversation: ChatConversation = {
            id: conversationId,
            title,
            messages: newMessages,
            createdAt:
              existingConversation?.createdAt ||
              messages?.createdAt ||
              timestamp,
            updatedAt: timestamp,
          };

          try {
            await saveConversation(conversation);

            // Reload conversation from database to ensure consistency
            const updatedConversation = await getConversationById(
              conversationId
            );
            if (updatedConversation) {
              setMessages(updatedConversation);
            }
          } catch (error) {
            console.error("Failed to save conversation:", error);
            setState((prev) => ({
              ...prev,
              error: "Failed to save conversation. Please try again.",
            }));
          }
        }
      } catch (error) {
        // Only show error if not aborted
        if (!signal?.aborted && currentRequestIdRef.current === requestId) {
          setState((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : "An error occurred",
            isLoading: false,
          }));
        }
      }
    },
    [
      state.input,
      state.attachedFiles,
      selectedAIProvider,
      allAiProviders,
      messages,
      conversationId,
      setMessages,
      hasActiveLicense,
    ]
  );

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    currentRequestIdRef.current = null;
    setState((prev) => ({ ...prev, isLoading: false }));
  }, []);

  // Helper function to convert file to base64
  const fileToBase64 = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string)?.split(",")[1] || "";
        resolve(base64);
      };
      reader.onerror = reject;
    });
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    files.forEach((file) => {
      if (
        file.type.startsWith("image/") &&
        state.attachedFiles.length < MAX_FILES
      ) {
        addFile(file);
      }
    });

    // Reset input so same file can be selected again
    e.target.value = "";
  };

  const handleScreenshotSubmit = useCallback(
    async (base64: string, prompt?: string) => {
      if (state.attachedFiles.length >= MAX_FILES) {
        setState((prev) => ({
          ...prev,
          error: `You can only upload ${MAX_FILES} files`,
        }));
        return;
      }

      try {
        if (prompt) {
          // Auto mode: Submit directly to AI with screenshot
          const attachedFile: AttachedFile = {
            id: Date.now().toString(),
            name: `screenshot_${Date.now()}.png`,
            type: "image/png",
            base64: base64,
            size: base64.length,
          };

          // Store files temporarily (for the attachment thumbnail/history) and
          // submit immediately, passing the fresh base64 directly so the
          // request doesn't depend on this setState having landed yet.
          setState((prev) => ({
            ...prev,
            attachedFiles: [...prev.attachedFiles, attachedFile],
            input: prompt,
          }));

          await submit(prompt, base64);
        } else {
          // Manual mode: Add to attached files and show the thumbnail so the
          // user can see what was captured before typing their own question.
          const attachedFile: AttachedFile = {
            id: Date.now().toString(),
            name: `screenshot_${Date.now()}.png`,
            type: "image/png",
            base64: base64,
            size: base64.length,
          };

          setState((prev) => ({
            ...prev,
            attachedFiles: [...prev.attachedFiles, attachedFile],
          }));
          setIsFilesPopoverOpen(true);
        }
      } catch (error) {
        console.error("Failed to process screenshot:", error);
        setState((prev) => ({
          ...prev,
          error:
            error instanceof Error
              ? error.message
              : "An error occurred processing screenshot",
          isLoading: false,
        }));
      }
    },
    [state.attachedFiles.length, submit]
  );

  const onRemoveAllFiles = () => {
    clearFiles();
    setIsFilesPopoverOpen(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!state.isLoading && state.input.trim()) {
        submit();
      }
    }
  };

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      // Check if clipboard contains images
      const items = e.clipboardData?.items;
      if (!items) return;

      const hasImages = Array.from(items).some((item) =>
        item.type.startsWith("image/")
      );

      // If we have images, prevent default text pasting and process images
      if (hasImages) {
        e.preventDefault();

        const processedFiles: File[] = [];

        Array.from(items).forEach((item) => {
          if (
            item.type.startsWith("image/") &&
            state.attachedFiles.length + processedFiles.length < MAX_FILES
          ) {
            const file = item.getAsFile();
            if (file) {
              processedFiles.push(file);
            }
          }
        });

        // Process all files
        await Promise.all(processedFiles.map((file) => addFile(file)));
      }
    },
    [state.attachedFiles.length, addFile]
  );

  const captureScreenshot = useCallback(async () => {
    if (!handleScreenshotSubmit) return;

    const config = screenshotConfigRef.current;

    // Mark that this context initiated the screenshot
    screenshotInitiatedByThisContext.current = true;

    setIsScreenshotLoading(true);

    try {
      // Check screen recording permission on macOS
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac") && !hasCheckedPermissionRef.current) {
        const {
          checkScreenRecordingPermission,
          requestScreenRecordingPermission,
        } = await import("tauri-plugin-macos-permissions-api");

        const hasPermission = await checkScreenRecordingPermission();

        if (!hasPermission) {
          // Request permission
          await requestScreenRecordingPermission();

          // Wait a moment and check again
          await new Promise((resolve) => setTimeout(resolve, 2000));

          const hasPermissionNow = await checkScreenRecordingPermission();

          if (!hasPermissionNow) {
            setState((prev) => ({
              ...prev,
              error:
                "Screen Recording permission required. Open System Settings, search for 'Screen & System Audio Recording', and enable ChannelPulse. If you don't see ChannelPulse in the list, click the '+' button to add it. If it's already listed, make sure it's enabled. Then restart the app.",
            }));
            setIsScreenshotLoading(false);
            screenshotInitiatedByThisContext.current = false;
            return;
          }
        }
        hasCheckedPermissionRef.current = true;
      }

      if (config.enabled) {
        const base64 = await invoke("capture_to_base64");

        // Always attach-and-wait here, regardless of the Settings > Screenshot
        // Processing Mode (auto/manual) toggle: the chat capture button should
        // show the screenshot in the chat input as an attachment so the user
        // can type their own accompanying question before sending — never
        // auto-submit it on their behalf.
        await handleScreenshotSubmit(base64 as string);
        // Reset flag after processing
        screenshotInitiatedByThisContext.current = false;
      } else {
        // Selection Mode: Open overlay to select an area
        // Only allow if user has active license
        if (!hasActiveLicense) {
          setState((prev) => ({
            ...prev,
            error: "Selection mode requires an active license",
          }));
          setIsScreenshotLoading(false);
          screenshotInitiatedByThisContext.current = false;
          return;
        }
        isProcessingScreenshotRef.current = false;
        await invoke("start_screen_capture");
      }
    } catch (error) {
      console.error("Screenshot capture failed:", error);
      setState((prev) => ({
        ...prev,
        error: `Failed to capture screenshot: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }));
      isProcessingScreenshotRef.current = false;
      screenshotInitiatedByThisContext.current = false;
    } finally {
      if (config.enabled) {
        setIsScreenshotLoading(false);
      }
    }
  }, [handleScreenshotSubmit, hasActiveLicense]);

  useEffect(() => {
    let unlisten: any;

    const setupListener = async () => {
      unlisten = await listen("captured-selection", async (event: any) => {
        // Only process if this context initiated the screenshot
        if (!screenshotInitiatedByThisContext.current) {
          return;
        }

        if (isProcessingScreenshotRef.current) {
          return;
        }

        isProcessingScreenshotRef.current = true;
        const base64 = event.payload;
        const config = screenshotConfigRef.current;

        try {
          if (config.mode === "auto") {
            // Auto mode: Submit directly to AI with the configured prompt
            await handleScreenshotSubmit(base64 as string, config.autoPrompt);
          } else if (config.mode === "manual") {
            // Manual mode: Add to attached files without prompt
            await handleScreenshotSubmit(base64 as string);
          }
        } catch (error) {
          console.error("Error processing selection:", error);
        } finally {
          setIsScreenshotLoading(false);
          screenshotInitiatedByThisContext.current = false;
          setTimeout(() => {
            isProcessingScreenshotRef.current = false;
          }, 100);
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleScreenshotSubmit]);

  useEffect(() => {
    const unlisten = listen("capture-closed", () => {
      setIsScreenshotLoading(false);
      isProcessingScreenshotRef.current = false;
      screenshotInitiatedByThisContext.current = false;
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      currentRequestIdRef.current = null;
    };
  }, []);

  return {
    input: state.input,
    setInput,
    isLoading: state.isLoading,
    error: state.error,
    attachedFiles: state.attachedFiles,
    addFile,
    removeFile,
    clearFiles,
    submit,
    cancel,
    setState,
    isRecording,
    setIsRecording,
    micOpen,
    setMicOpen,
    screenshotConfiguration,
    setScreenshotConfiguration,
    handleScreenshotSubmit,
    handleFileSelect,
    handleKeyPress,
    handlePaste,
    isFilesPopoverOpen,
    setIsFilesPopoverOpen,
    onRemoveAllFiles,
    inputRef,
    captureScreenshot,
    isScreenshotLoading,
    messagesEndRef,
    selectedSttProvider,
    allSttProviders,
    selectedAudioDevices,
    hasActiveLicense,
    // Parity with the overlay chat
    suggestions,
    suggestLoading,
  };
};
