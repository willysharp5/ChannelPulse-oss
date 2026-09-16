/**
 * Popular OpenRouter model slugs offered as one-click quick-picks in the AI
 * provider config. This is NOT an exhaustive list — OpenRouter exposes hundreds
 * of models and the model field stays free-text, so any valid slug from
 * https://openrouter.ai/models can be entered manually.
 *
 * `vision: true` marks models that accept image input (needed for screenshots).
 */
export interface OpenRouterModel {
  label: string;
  value: string;
  vision?: boolean;
}

export const OPENROUTER_POPULAR_MODELS: OpenRouterModel[] = [
  { label: "GPT-4o", value: "openai/gpt-4o", vision: true },
  { label: "GPT-4o mini", value: "openai/gpt-4o-mini", vision: true },
  { label: "GPT-4.1", value: "openai/gpt-4.1", vision: true },
  {
    label: "Claude 3.7 Sonnet",
    value: "anthropic/claude-3.7-sonnet",
    vision: true,
  },
  {
    label: "Claude 3.5 Sonnet",
    value: "anthropic/claude-3.5-sonnet",
    vision: true,
  },
  {
    label: "Gemini 2.0 Flash",
    value: "google/gemini-2.0-flash-001",
    vision: true,
  },
  {
    label: "Llama 3.3 70B",
    value: "meta-llama/llama-3.3-70b-instruct",
  },
  { label: "DeepSeek V3", value: "deepseek/deepseek-chat" },
  { label: "Mistral Large", value: "mistralai/mistral-large" },
];
