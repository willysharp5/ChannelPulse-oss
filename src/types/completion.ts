// Completion-related types

/** A numbered source backing part of an AI answer (web result, memory, file). */
export interface Citation {
  n: number;
  type: "web" | "memory" | "file" | "profile" | "transcript";
  title: string;
  url?: string;
  snippet?: string;
}

export interface AttachedFile {
  id: string;
  name: string;
  type: string;
  base64: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  attachedFiles?: AttachedFile[];
  /** Who said it, for source-based diarization (e.g. "You", "Them"). */
  speaker?: string;
  /**
   * Where this turn came from, so the overlay can separate the passive
   * listening record from the interactive chat:
   * - "transcript": captured speech + the AI's live answers to the conversation
   * - "chat": questions the user typed / quick actions, and their answers
   */
  origin?: "transcript" | "chat";
  /**
   * Short label to show for a user message when the actual `content` sent to
   * the model is a longer expanded prompt (e.g. a quick action). The full
   * prompt stays in `content`; the UI shows this and reveals `content` on demand.
   */
  displayLabel?: string;
  /** Numbered sources the assistant's answer drew on ([1], [2], …). */
  citations?: Citation[];
  /**
   * For a live-copilot assistant turn: which kind of help this is. Drives the
   * icon and how the turn reads back in history — a note is not a suggested reply.
   * - "answer" — words the user can say out loud (the classic suggested reply)
   * - "note"   — facts worth remembering; nothing was asked of the user
   * - "action" — a commitment, owner, or deadline; the to-do
   * - "ask"    — questions the user could ask right now
   * Absent on chat answers and on turns predating triage (treated as "answer").
   * See `src/lib/live/triage.ts`.
   */
  triageMode?: "answer" | "note" | "action" | "ask";
  /**
   * The model's own short headline for this turn ("Q3 churn number", "Send
   * revised SOW by Friday"). This is what the overlay shows above the content —
   * the generic mode label is only a fallback for when it's missing, because a
   * topic tells the user what the card is about and "Worth noting" doesn't.
   */
  triageTopic?: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface CompletionState {
  input: string;
  response: string;
  isLoading: boolean;
  error: string | null;
  attachedFiles: AttachedFile[];
  currentConversationId: string | null;
  conversationHistory: ChatMessage[];
}

// Provider-related types
export interface Message {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
        source?: any;
        inline_data?: any;
      }>;
}
