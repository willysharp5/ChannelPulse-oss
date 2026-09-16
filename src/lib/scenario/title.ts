import { fetchAIResponse } from "@/lib/functions/ai-response.function";
import type { TYPE_PROVIDER } from "@/types";

const ERROR_PREFIXES = [
  "API request failed",
  "Network error",
  "Streaming not supported",
  "Failed to parse",
  "Error in fetchAIResponse",
  "ChannelPulse API Error",
  "Provider not provided",
  "Selected provider not provided",
];

/**
 * Ask the model for a short, specific title describing what a conversation is
 * about — used to name the conversation and its memory space. Returns a concise
 * Title-Case string (never the raw utterance). Best-effort → null on failure.
 */
export async function generateConversationLabel(params: {
  transcript: string;
  provider: TYPE_PROVIDER;
  selectedProvider: { provider: string; variables: Record<string, string> };
}): Promise<string | null> {
  const transcript = (params.transcript ?? "").trim().slice(-3000);
  if (transcript.length < 40) return null;

  try {
    let full = "";
    for await (const chunk of fetchAIResponse({
      provider: params.provider,
      selectedProvider: params.selectedProvider,
      systemPrompt:
        "You name a conversation like a chat-thread title. Output 3-6 words, Title Case, describing the TOPIC or subject. " +
        "No quotes, no trailing punctuation, no emojis. Do NOT echo a whole sentence and do NOT start with 'Discussing'/'Talking About'/'I will'. " +
        "Examples: 'Back Office Agents Demo', 'Series A Fundraising Plan', 'Kubernetes Migration Q&A', 'Interview: Senior Backend Role'. " +
        "Reply with ONLY the title.",
      userMessage: `Conversation so far:\n${transcript}`,
      disableMemory: true,
    })) {
      full += chunk;
    }

    let title = full.trim();
    if (!title || ERROR_PREFIXES.some((p) => title.startsWith(p))) return null;

    // Strip surrounding quotes/markdown and trailing punctuation.
    title = title
      .replace(/^["'`#*\s]+/, "")
      .replace(/["'`.*\s]+$/, "")
      .trim();
    if (!title) return null;

    // Keep it tight: at most 6 words / 48 chars.
    const trimmed = title.split(/\s+/).slice(0, 6).join(" ");
    return trimmed.slice(0, 48);
  } catch {
    return null;
  }
}
