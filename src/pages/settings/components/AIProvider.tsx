import {
  Header,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components";
import { useSettings } from "@/hooks/useSettings";

/** Human-friendly names for the built-in provider templates. */
const PROVIDER_LABELS: Record<string, string> = {
  ollama: "Ollama (local)",
  "local-openai": "Local server (OpenAI-compatible)",
  kimi: "Kimi / Moonshot",
  openai: "OpenAI",
  claude: "Anthropic Claude",
  gemini: "Google Gemini",
  grok: "xAI Grok",
  mistral: "Mistral",
  cohere: "Cohere",
  groq: "Groq",
  perplexity: "Perplexity",
  openrouter: "OpenRouter",
};

/** A short hint shown under the inputs for each provider. */
const PROVIDER_HINTS: Record<string, string> = {
  ollama:
    "Runs 100% on your machine. Install Ollama, run e.g. `ollama pull llama3.1`, then use that name as the Model. No API key needed — leave it blank. Endpoint: http://localhost:11434.",
  "local-openai":
    "For LM Studio, llama.cpp, vLLM, LocalAI, or self-hosted Kimi K2. Point the endpoint at your server (default http://localhost:1234). No API key required.",
  kimi:
    "Moonshot AI's Kimi. Create a key at platform.moonshot.ai. Try models like `kimi-k2-0711-preview` or `moonshot-v1-8k`.",
  openai: "Create a key at platform.openai.com. Model e.g. `gpt-4o` or `gpt-4o-mini`.",
  claude:
    "Create a key at console.anthropic.com. Model e.g. `claude-sonnet-4-5` or `claude-3-5-haiku-latest`.",
  gemini:
    "Create a key at aistudio.google.com. Model e.g. `gemini-2.0-flash`.",
  grok: "Create a key at console.x.ai. Model e.g. `grok-2-latest`.",
  openrouter:
    "One key for many models at openrouter.ai. Model e.g. `openai/gpt-4o` or `meta-llama/llama-3.1-70b-instruct`.",
};

const labelFor = (id: string) =>
  PROVIDER_LABELS[id] || id.charAt(0).toUpperCase() + id.slice(1);

const fieldLabel = (name: string) =>
  name
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/**
 * Lets the user choose which AI provider powers the copilot and enter the
 * values it needs (API key, model, …). ChannelPulse OSS is local-first: pick
 * Ollama or a local OpenAI-compatible server to run entirely on-device, or
 * bring your own key for a hosted model. Keys are stored only on this device.
 */
export const AIProvider = ({ className }: { className?: string }) => {
  const {
    allAiProviders,
    selectedAIProvider,
    onSetSelectedAIProvider,
    variables,
  } = useSettings();

  const currentId = selectedAIProvider.provider;

  const handleProviderChange = (providerId: string) => {
    // Keep any values the user already entered (API key / model tend to carry
    // over), so switching providers doesn't wipe their input.
    onSetSelectedAIProvider({
      provider: providerId,
      variables: selectedAIProvider.variables || {},
    });
  };

  const handleVariableChange = (key: string, value: string) => {
    onSetSelectedAIProvider({
      provider: currentId,
      variables: { ...selectedAIProvider.variables, [key]: value },
    });
  };

  return (
    <div id="ai-provider" className={`space-y-4 ${className ?? ""}`}>
      <Header
        title="AI Provider"
        description="Choose the model that powers your copilot. Everything runs through your own provider — a local runtime like Ollama, a local OpenAI-compatible server, or any hosted model via your own API key. Your keys never leave this device."
        isMainTitle
      />

      <div className="space-y-2">
        <Label className="text-sm font-medium">Provider</Label>
        <Select value={currentId} onValueChange={handleProviderChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an AI provider" />
          </SelectTrigger>
          <SelectContent>
            {allAiProviders.map((p) =>
              p.id ? (
                <SelectItem key={p.id} value={p.id}>
                  {labelFor(p.id)}
                </SelectItem>
              ) : null
            )}
          </SelectContent>
        </Select>
      </div>

      {currentId && (
        <div className="space-y-3">
          {variables.map(({ key, value }) => {
            const isSecret = value === "API_KEY";
            return (
              <div key={key} className="space-y-1.5">
                <Label className="text-sm font-medium">
                  {fieldLabel(value)}
                </Label>
                <Input
                  type={isSecret ? "password" : "text"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    isSecret
                      ? "Paste your API key (optional for local providers)"
                      : value === "MODEL"
                      ? "Model name"
                      : fieldLabel(value)
                  }
                  value={selectedAIProvider.variables?.[key] ?? ""}
                  onChange={(e) => handleVariableChange(key, e.target.value)}
                />
              </div>
            );
          })}

          {PROVIDER_HINTS[currentId] && (
            <p className="text-xs text-muted-foreground">
              {PROVIDER_HINTS[currentId]}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
