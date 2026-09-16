import { fetchAIResponse } from "@/lib/functions/ai-response.function";
import { SCENARIO_KEYS, normalizeScenario, type ScenarioKey } from "@/config";
import type { TYPE_PROVIDER } from "@/types";

/**
 * Classify a conversation transcript into one scenario key using the configured
 * AI provider. Best-effort — returns null on any failure or too-short input.
 */
export async function detectScenario(params: {
  transcript: string;
  provider: TYPE_PROVIDER;
  selectedProvider: { provider: string; variables: Record<string, string> };
}): Promise<ScenarioKey | null> {
  const transcript = (params.transcript ?? "").trim().slice(-3000);
  if (transcript.length < 40) return null;

  try {
    let full = "";
    for await (const chunk of fetchAIResponse({
      provider: params.provider,
      selectedProvider: params.selectedProvider,
      systemPrompt:
        `Classify the conversation into exactly one of these keys: ${SCENARIO_KEYS.join(
          ", "
        )}. ` +
        "Use interview_candidate when the listener is being interviewed, interview_interviewer when they are the interviewer. " +
        "Reply with ONLY the key, nothing else.",
      userMessage: `Transcript:\n${transcript}`,
      disableMemory: true,
    })) {
      full += chunk;
    }
    const trimmed = full.trim();
    if (!trimmed) return null;
    return normalizeScenario(trimmed);
  } catch {
    return null;
  }
}
