import {
  buildDynamicMessages,
  deepVariableReplacer,
  extractVariables,
  getByPath,
  getStreamingContent,
} from "./common.function";
import { Message, TYPE_PROVIDER } from "@/types";
import type { Citation } from "@/types/completion";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import curl2Json from "@bany/curl-to-json";
import { getResponseSettings, RESPONSE_LENGTHS, LANGUAGES } from "@/lib";
import {
  MARKDOWN_FORMATTING_INSTRUCTIONS,
  PLAIN_STYLE_RULE,
} from "@/config/constants";
import { px } from "@/lib/prompts/overrides";
import { retrieveContext } from "@/lib/memory/retrieve";

/**
 * ChannelPulse OSS is local-first: chat runs entirely against the user's own
 * provider — a local runtime like Ollama, a hosted OpenAI-compatible endpoint
 * such as Kimi/Moonshot, or any vendor reachable with the user's own API key.
 * Providers are described as cURL templates (see ai-providers.constants.ts) and
 * the user's keys are stored on-device. There is no managed backend proxy.
 *
 * `task` is accepted for signature compatibility with call sites that hint a
 * per-task model to a managed backend; in OSS it is ignored. Not exported — the
 * public `ChatTask` continues to come from the backend module's barrel so this
 * revived local executor doesn't create a duplicate export.
 */
type ChatTask = "triage" | "grading";

function buildEnhancedSystemPrompt(
  baseSystemPrompt?: string,
  retrievedContext?: string,
  skipLengthWrapper?: boolean
): string {
  const responseSettings = getResponseSettings();
  const prompts: string[] = [];

  if (baseSystemPrompt) {
    prompts.push(baseSystemPrompt);
  }

  if (retrievedContext && retrievedContext.trim()) {
    prompts.push(retrievedContext);
  }

  // The interview copilot defines its own (richer) length rules, so skip the
  // generic short/medium/auto wrapper for those turns — it would otherwise
  // contradict and shorten the answer.
  if (!skipLengthWrapper) {
    const lengthOption = RESPONSE_LENGTHS.find(
      (l) => l.id === responseSettings.responseLength
    );
    if (lengthOption?.prompt?.trim()) {
      prompts.push(lengthOption.prompt);
    }
  }

  const languageOption = LANGUAGES.find(
    (l) => l.id === responseSettings.language
  );
  if (languageOption?.prompt?.trim()) {
    prompts.push(languageOption.prompt);
  }

  // Add markdown formatting instructions
  prompts.push(px("format.markdown", MARKDOWN_FORMATTING_INSTRUCTIONS));

  return prompts.join(" ");
}

/**
 * Public entry point. Wraps the core request with automatic context retrieval
 * (selected files + optional web search). Gated by the user's Memory & Context
 * settings and can be skipped per-call via `disableMemory`.
 */
export async function* fetchAIResponse(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  systemPrompt?: string;
  history?: Message[];
  userMessage: string;
  imagesBase64?: string[];
  signal?: AbortSignal;
  /** Skip context retrieval for this call (e.g. prompt generation). */
  disableMemory?: boolean;
  /** Force web search on/off for this call, overriding the global setting. */
  useWeb?: boolean;
  /** Extra context injected verbatim, in addition to auto-retrieval. */
  extraContext?: string;
  /** Receives the numbered sources used to build the context, for [n] citations. */
  onCitations?: (citations: Citation[]) => void;
  /**
   * Skip response-length / language / markdown wrappers. Use for internal JSON
   * grading so a user's "Short" setting doesn't truncate the payload.
   */
  structured?: boolean;
  maxTokens?: number;
  /** Skip the generic response-length wrapper (interview mode sets its own). */
  skipLengthWrapper?: boolean;
  /** Ignored in OSS (managed per-task model hint). */
  task?: ChatTask;
}): AsyncIterable<string> {
  const { userMessage, signal, disableMemory, useWeb, extraContext } = params;

  // Build retrieved context (memory + optional web). Best-effort.
  let retrieved = extraContext?.trim() || "";
  if (!disableMemory) {
    try {
      const auto = await retrieveContext(userMessage, { useWeb });
      if (auto.text) retrieved = [retrieved, auto.text].filter(Boolean).join("\n\n");
      if (auto.citations.length > 0) params.onCitations?.(auto.citations);
    } catch (err) {
      console.warn("Context retrieval failed:", err);
    }
  }

  // NOTE: Conversations are not stored as memory cards — each session stays
  // independent. Context retrieval above only draws on the user's profile
  // and optional live web search.
  for await (const chunk of fetchAIResponseCore({
    provider: params.provider,
    selectedProvider: params.selectedProvider,
    systemPrompt: params.systemPrompt,
    history: params.history,
    userMessage,
    imagesBase64: params.imagesBase64,
    signal,
    retrievedContext: retrieved,
    structured: params.structured,
    maxTokens: params.maxTokens,
    skipLengthWrapper: params.skipLengthWrapper,
  })) {
    yield chunk;
  }
}

async function* fetchAIResponseCore(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  systemPrompt?: string;
  history?: Message[];
  userMessage: string;
  imagesBase64?: string[];
  signal?: AbortSignal;
  retrievedContext?: string;
  structured?: boolean;
  maxTokens?: number;
  skipLengthWrapper?: boolean;
}): AsyncIterable<string> {
  try {
    const {
      provider,
      selectedProvider,
      systemPrompt,
      history = [],
      userMessage,
      imagesBase64 = [],
      signal,
      retrievedContext,
      structured,
      maxTokens,
      skipLengthWrapper,
    } = params;

    // Check if already aborted
    if (signal?.aborted) {
      return;
    }

    // Structured (JSON) calls skip the length / language / markdown wrappers so
    // a "Short" setting can't truncate an object mid-key. The punctuation rule
    // still applies: the prose inside those JSON fields is read by the user.
    const enhancedSystemPrompt = structured
      ? [systemPrompt, retrievedContext, PLAIN_STYLE_RULE]
          .filter(Boolean)
          .join("\n\n")
      : buildEnhancedSystemPrompt(
          systemPrompt,
          retrievedContext,
          skipLengthWrapper
        );

    if (!provider) {
      // Names both fixes, because there are two: bring your own provider (what
      // this edition is for), or the hosted app, where the model is managed.
      throw new Error(
        "No AI provider configured. Open Settings and add a provider (Ollama, Kimi, or an API key) — or use the hosted app at channelpulse.us, where the AI is set up for you."
      );
    }
    if (!selectedProvider) {
      throw new Error("Selected provider not provided");
    }

    let curlJson;
    try {
      curlJson = curl2Json(provider.curl);
    } catch (error) {
      throw new Error(
        `Failed to parse curl: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    const extractedVariables = extractVariables(provider.curl);
    const requiredVars = extractedVariables.filter(
      ({ key }) => key !== "SYSTEM_PROMPT" && key !== "TEXT" && key !== "IMAGE"
    );
    for (const { key } of requiredVars) {
      if (
        !selectedProvider.variables?.[key] ||
        selectedProvider.variables[key].trim() === ""
      ) {
        throw new Error(
          `Missing required variable: ${key}. Please configure it in settings.`
        );
      }
    }

    if (!userMessage) {
      throw new Error("User message is required");
    }
    if (imagesBase64.length > 0 && !provider.curl.includes("{{IMAGE}}")) {
      throw new Error(
        `Provider ${provider?.id ?? "unknown"} does not support image input`
      );
    }

    let bodyObj: any = curlJson.data
      ? JSON.parse(JSON.stringify(curlJson.data))
      : {};
    const messagesKey = Object.keys(bodyObj).find((key) =>
      ["messages", "contents", "conversation", "history"].includes(key)
    );

    if (messagesKey && Array.isArray(bodyObj[messagesKey])) {
      const finalMessages = buildDynamicMessages(
        bodyObj[messagesKey],
        history,
        userMessage,
        imagesBase64
      );
      bodyObj[messagesKey] = finalMessages;
    }

    const allVariables = {
      ...Object.fromEntries(
        Object.entries(selectedProvider.variables).map(([key, value]) => [
          key.toUpperCase(),
          value,
        ])
      ),
      SYSTEM_PROMPT: enhancedSystemPrompt || "",
    };

    bodyObj = deepVariableReplacer(bodyObj, allVariables);
    let url = deepVariableReplacer(curlJson.url || "", allVariables);

    const headers = deepVariableReplacer(curlJson.header || {}, allVariables);
    headers["Content-Type"] = "application/json";

    // Optional cap on output length (used by internal JSON grading). Only set
    // when the body doesn't already carry a token limit from the template.
    if (
      typeof maxTokens === "number" &&
      maxTokens > 0 &&
      typeof bodyObj === "object" &&
      bodyObj !== null
    ) {
      const hasTokenKey = Object.keys(bodyObj).some((k) =>
        ["max_tokens", "max_output_tokens", "maxtokens", "max_completion_tokens"].includes(
          k.toLowerCase()
        )
      );
      if (!hasTokenKey) bodyObj.max_tokens = maxTokens;
    }

    if (provider?.streaming) {
      if (typeof bodyObj === "object" && bodyObj !== null) {
        const streamKey = Object.keys(bodyObj).find(
          (k) => k.toLowerCase() === "stream"
        );
        if (streamKey) {
          bodyObj[streamKey] = true;
        } else {
          bodyObj.stream = true;
        }
      }
    }

    // Local runtimes (Ollama, etc.) and same-origin endpoints can use the
    // browser fetch; remote HTTPS endpoints go through the Tauri HTTP plugin so
    // requests aren't subject to browser CORS.
    const fetchFunction = url?.includes("http") ? tauriFetch : fetch;

    let response;
    try {
      response = await fetchFunction(url, {
        method: curlJson.method || "POST",
        headers,
        body: curlJson.method === "GET" ? undefined : JSON.stringify(bodyObj),
        signal,
      });
    } catch (fetchError) {
      // Check if aborted
      if (
        signal?.aborted ||
        (fetchError instanceof Error && fetchError.name === "AbortError")
      ) {
        return; // Silently return on abort
      }
      yield `Network error during API request: ${
        fetchError instanceof Error ? fetchError.message : "Unknown error"
      }`;
      return;
    }

    if (!response.ok) {
      let errorText = "";
      try {
        errorText = await response.text();
      } catch {}
      yield `API request failed: ${response.status} ${response.statusText}${
        errorText ? ` - ${errorText}` : ""
      }`;
      return;
    }

    if (!provider?.streaming) {
      let json;
      try {
        json = await response.json();
      } catch (parseError) {
        yield `Failed to parse non-streaming response: ${
          parseError instanceof Error ? parseError.message : "Unknown error"
        }`;
        return;
      }
      const content =
        getByPath(json, provider?.responseContentPath || "") || "";
      yield content;
      return;
    }

    if (!response.body) {
      yield "Streaming not supported or response body missing";
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      // Check if aborted
      if (signal?.aborted) {
        reader.cancel();
        return;
      }

      let readResult;
      try {
        readResult = await reader.read();
      } catch (readError) {
        // Check if aborted
        if (
          signal?.aborted ||
          (readError instanceof Error && readError.name === "AbortError")
        ) {
          return; // Silently return on abort
        }
        yield `Error reading stream: ${
          readError instanceof Error ? readError.message : "Unknown error"
        }`;
        return;
      }
      const { done, value } = readResult;
      if (done) break;

      // Check if aborted before processing
      if (signal?.aborted) {
        reader.cancel();
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const trimmed = line.substring(5).trim();
          if (!trimmed || trimmed === "[DONE]") continue;
          try {
            const parsed = JSON.parse(trimmed);
            const delta = getStreamingContent(
              parsed,
              provider?.responseContentPath || ""
            );
            if (delta) {
              yield delta;
            }
          } catch (e) {
            // Ignore parsing errors for partial JSON chunks
          }
        }
      }
    }
  } catch (error) {
    throw new Error(
      `Error in fetchAIResponse: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
