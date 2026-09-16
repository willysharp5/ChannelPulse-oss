import type { ChatMessage, Message } from "@/types";
import type { Citation } from "@/types/completion";

/** Optional fields persisted in messages.meta JSON. */
export type MessageMeta = {
  speaker?: string;
  origin?: "transcript" | "chat";
  displayLabel?: string;
  citations?: Citation[];
  triageMode?: "answer" | "note" | "action" | "ask";
  triageTopic?: string;
};

export function serializeMessageMeta(message: ChatMessage): string | null {
  const meta: MessageMeta = {};
  if (message.speaker) meta.speaker = message.speaker;
  if (message.origin) meta.origin = message.origin;
  if (message.displayLabel) meta.displayLabel = message.displayLabel;
  if (message.citations?.length) meta.citations = message.citations;
  if (message.triageMode) meta.triageMode = message.triageMode;
  if (message.triageTopic) meta.triageTopic = message.triageTopic;
  return Object.keys(meta).length ? JSON.stringify(meta) : null;
}

export function applyMessageMeta(
  message: ChatMessage,
  metaJson: string | null | undefined
): ChatMessage {
  if (!metaJson) return message;
  try {
    const meta = JSON.parse(metaJson) as MessageMeta;
    return {
      ...message,
      ...(meta.speaker ? { speaker: meta.speaker } : {}),
      ...(meta.origin ? { origin: meta.origin } : {}),
      ...(meta.displayLabel ? { displayLabel: meta.displayLabel } : {}),
      ...(meta.citations?.length ? { citations: meta.citations } : {}),
      ...(meta.triageMode ? { triageMode: meta.triageMode } : {}),
      ...(meta.triageTopic ? { triageTopic: meta.triageTopic } : {}),
    };
  } catch {
    return message;
  }
}

function isSysaudioConversation(conversationId?: string | null): boolean {
  return !!conversationId && conversationId.startsWith("sysaudio_conv");
}

/**
 * Whether this message is heard speech (part of the live transcript), vs a
 * typed chat question / quick action.
 */
export function isHeardTranscriptMessage(
  message: ChatMessage,
  conversationId?: string | null
): boolean {
  if (message.role !== "user") return false;
  if (message.origin === "chat") return false;
  if (message.origin === "transcript") return true;
  // Legacy rows had no origin. For overlay sessions, treat unlabeled user
  // lines without a quick-action label as heard speech.
  if (isSysaudioConversation(conversationId) && !message.displayLabel) {
    return true;
  }
  return false;
}

/**
 * Build a transcript block for chat-analysis prompts so the model grounds
 * answers in what was actually said (with speakers when known).
 */
export function buildTranscriptContext(
  messages: ChatMessage[],
  conversationId?: string | null
): string {
  const lines = [...messages]
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((m) => isHeardTranscriptMessage(m, conversationId))
    .map((m) => {
      const text = (m.content || "").trim();
      if (!text) return "";
      const who = (m.speaker || "Speaker").trim() || "Speaker";
      return `${who}: ${text}`;
    })
    .filter(Boolean);

  if (lines.length === 0) return "";

  return [
    "--- Conversation transcript (ground answers in this; attribute speakers) ---",
    lines.join("\n"),
    "--- End transcript ---",
  ].join("\n");
}

/** Format a message for the model history with origin/speaker cues. */
export function formatMessageForHistory(message: ChatMessage): string {
  const content = message.content || "";
  const origin = message.origin ?? "transcript";

  if (message.role === "user") {
    if (origin === "chat") {
      const label = message.displayLabel?.trim();
      return label && label !== content.trim()
        ? `[Chat question: ${label}]\n${content}`
        : `[Chat question]\n${content}`;
    }
    const who = message.speaker?.trim();
    return who ? `[Heard | ${who}]: ${content}` : `[Heard]: ${content}`;
  }

  if (message.role === "assistant") {
    if (origin === "chat") return content;
    // Label by triage mode so the model can see what it already did here — a
    // note is not a suggested reply, and mislabeling them made it repeat itself.
    // The topic goes in the tag too: it's the cheapest way for the model to see
    // which subjects it has already covered, so it doesn't re-cover them.
    const kind =
      message.triageMode === "note"
        ? "Note"
        : message.triageMode === "action"
          ? "Action"
          : message.triageMode === "ask"
            ? "Questions to ask"
            : "Suggested reply";
    const topic = message.triageTopic?.trim();
    const tag = topic ? `[${kind}: ${topic}]` : `[${kind}]`;
    return `${tag}\n${content}`;
  }

  return content;
}

/**
 * Map conversation messages → OpenAI-style history for chat / live turns.
 *
 * Sorted oldest-first, like every other consumer here: the overlay stores
 * `conversation.messages` newest-first (new turns are prepended), so passing it
 * straight through handed the model the conversation in reverse — the oldest
 * exchange ended up immediately before the new question, and prior chat Q&A read
 * as if the answers came before their questions.
 */
export function toHistoryMessages(messages: ChatMessage[]): Message[] {
  return [...messages]
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: formatMessageForHistory(m),
    }));
}

/**
 * History for chat-analysis: prefer chat Q&A turns when origin meta exists,
 * so the transcript block isn't duplicated as every prior user line. Falls
 * back to the full thread for legacy conversations without origin.
 */
export function toChatAnalysisHistory(
  messages: ChatMessage[],
  _conversationId?: string | null
): Message[] {
  const hasOrigin = messages.some((m) => m.origin != null);
  if (!hasOrigin) {
    return toHistoryMessages(messages);
  }
  const chatOnly = messages.filter((m) => m.origin === "chat");
  // Always include prior chat Q&A; if this is the first chat question, history
  // may be empty — the transcript block still grounds the answer.
  return toHistoryMessages(chatOnly);
}

export function conversationHasTranscript(
  messages: ChatMessage[],
  conversationId?: string | null
): boolean {
  return messages.some((m) => isHeardTranscriptMessage(m, conversationId));
}

/** Citation chip so the UI shows when the transcript grounded a chat answer. */
export function transcriptCitation(
  messages: ChatMessage[],
  conversationId?: string | null
): Citation | null {
  const lines = messages.filter((m) =>
    isHeardTranscriptMessage(m, conversationId)
  );
  if (lines.length === 0) return null;
  const speakers = [
    ...new Set(lines.map((m) => m.speaker?.trim()).filter(Boolean) as string[]),
  ];
  return {
    n: -1,
    type: "transcript",
    title: "Conversation transcript",
    snippet: `${lines.length} line${lines.length === 1 ? "" : "s"}${
      speakers.length ? ` · ${speakers.join(", ")}` : ""
    }`,
  };
}

/**
 * Infer origin for legacy rows that predate messages.meta (overlay sessions).
 */
export function withInferredOrigins(
  messages: ChatMessage[],
  conversationId?: string | null
): ChatMessage[] {
  if (!conversationId?.startsWith("sysaudio_conv")) return messages;
  return messages.map((m) => {
    if (m.origin) return m;
    if (m.role === "user" && !m.displayLabel) {
      return { ...m, origin: "transcript" as const };
    }
    if (m.role === "user" && m.displayLabel) {
      return { ...m, origin: "chat" as const };
    }
    // Assistant replies without origin: treat as transcript suggested replies
    // when they sit next to heard speech; default transcript for overlay.
    if (m.role === "assistant") {
      return { ...m, origin: "transcript" as const };
    }
    return m;
  });
}
