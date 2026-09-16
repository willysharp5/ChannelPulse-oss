import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  Textarea,
} from "@/components";
import { SparklesIcon } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/contexts";
import { fetchAIResponse } from "@/lib/functions/ai-response.function";

interface GenerateSystemPromptProps {
  onGenerate: (prompt: string, promptName: string) => void;
}

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
 * Pull a { prompt_name, system_prompt } object out of the model's reply,
 * tolerating code fences and surrounding prose.
 */
const parseGenerated = (
  text: string
): { prompt_name: string; system_prompt: string } | null => {
  const cleaned = text.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1));
      if (obj && typeof obj.system_prompt === "string" && obj.system_prompt.trim()) {
        return {
          prompt_name:
            typeof obj.prompt_name === "string" && obj.prompt_name.trim()
              ? obj.prompt_name.trim()
              : "Custom Prompt",
          system_prompt: obj.system_prompt.trim(),
        };
      }
    } catch {
      // fall through to null
    }
  }
  return null;
};

export const GenerateSystemPrompt = ({
  onGenerate,
}: GenerateSystemPromptProps) => {
  const { allAiProviders, selectedAIProvider } = useApp();
  const [userPrompt, setUserPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleGenerate = async () => {
    if (!userPrompt.trim()) {
      setError("Please describe what you want");
      return;
    }

    const provider = allAiProviders?.find(
      (p) => p?.id === selectedAIProvider?.provider
    );

    if (!provider || !selectedAIProvider?.provider) {
      setError(
        "No AI provider configured. Set one up in Dev Space → AI Providers first."
      );
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);

      const instruction = `Write a single, high-quality system prompt for an AI assistant based on this description:\n\n"${userPrompt.trim()}"\n\nRespond with ONLY a raw JSON object (no markdown, no code fences, no commentary) exactly like this:\n{"prompt_name": "<a short 3-5 word title>", "system_prompt": "<the full system prompt as one string>"}`;

      let full = "";
      for await (const chunk of fetchAIResponse({
        provider,
        selectedProvider: selectedAIProvider,
        systemPrompt:
          "You are an expert prompt engineer. You write clear, effective system prompts. Reply with only a compact JSON object and nothing else.",
        userMessage: instruction,
        disableMemory: true,
      })) {
        full += chunk;
      }

      const trimmed = full.trim();

      // Surface provider/network errors that fetchAIResponse yields as content
      if (ERROR_PREFIXES.some((p) => trimmed.startsWith(p))) {
        throw new Error(trimmed);
      }

      const parsed = parseGenerated(trimmed);
      if (parsed) {
        onGenerate(parsed.system_prompt, parsed.prompt_name);
        setIsOpen(false);
        setUserPrompt("");
        return;
      }

      // Fallback: use the raw text as the prompt if the model didn't return JSON
      if (trimmed) {
        const fallbackName =
          userPrompt.trim().split(/\s+/).slice(0, 4).join(" ") ||
          "Custom Prompt";
        onGenerate(trimmed, fallbackName);
        setIsOpen(false);
        setUserPrompt("");
        return;
      }

      throw new Error("The model returned an empty response. Please try again.");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to generate prompt";
      setError(errorMessage);
      console.error("Error generating system prompt:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-label="Generate with AI"
          size="sm"
          variant="outline"
          className="w-fit"
        >
          <SparklesIcon className="h-4 w-4" /> Generate with AI
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-96 p-4 border shadow-lg"
      >
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium mb-1">Generate a system prompt</p>
            <p className="text-xs text-muted-foreground">
              Describe the AI behavior you want, and your configured AI provider
              will generate a prompt for you.
            </p>
          </div>

          <Textarea
            placeholder="e.g., I want an AI that helps me with code reviews and focuses on best practices..."
            className="min-h-[6.25rem] resize-none border-1 border-input/50 focus:border-primary/50 transition-colors"
            value={userPrompt}
            onChange={(e) => {
              setUserPrompt(e.target.value);
              setError(null);
            }}
            disabled={isGenerating}
          />

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            className="w-full"
            onClick={handleGenerate}
            disabled={!userPrompt.trim() || isGenerating}
          >
            {isGenerating ? (
              <>
                <SparklesIcon className="h-4 w-4 animate-pulse" />
                Generating...
              </>
            ) : (
              <>
                <SparklesIcon className="h-4 w-4" />
                Generate
              </>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
