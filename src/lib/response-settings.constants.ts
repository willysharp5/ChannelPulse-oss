export interface ResponseLengthOption {
  id: "short" | "medium" | "auto";
  title: string;
  description: string;
  prompt: string;
}

export interface LanguageOption {
  id: string;
  name: string;
  prompt: string;
}

export const RESPONSE_LENGTHS: ResponseLengthOption[] = [
  {
    id: "short",
    title: "Short",
    description:
      "Best for quick answers, summaries, and when you need to save time",
    prompt:
      "IMPORTANT: Keep it extremely brief, the key points only. Prefer 2-4 short bullet points (or 1-2 sentences). Lead with the answer/insight. No intro, no restating the question, and NEVER end with offers to help (no 'let me know', 'feel free to ask', 'if there's anything else'). Essential information only. This is a strict requirement.",
  },
  {
    id: "medium",
    title: "Medium",
    description: "Balanced responses with adequate explanations for most tasks",
    prompt:
      "IMPORTANT: Provide responses with moderate length - not too brief, not too lengthy. Keep your answer to 1-2 paragraphs (approximately 4-8 sentences). Include key explanations and relevant details, but avoid being overly verbose or adding unnecessary elaboration. Stay focused and well-organized. This is a strict requirement.",
  },
  {
    id: "auto",
    title: "Auto",
    description:
      "AI determines the best length based on your question's complexity",
    prompt:
      "IMPORTANT: Carefully assess the complexity and scope of the question, then adjust your response length accordingly. For simple questions, be brief (2-4 sentences). For moderate questions, provide balanced detail (1-2 paragraphs). For complex questions, give comprehensive answers with appropriate depth. Always match the response length to what the question actually requires - no more, no less.",
  },
];

export const LANGUAGES: LanguageOption[] = [
  {
    id: "english",
    name: "English",
    prompt: "Respond in English.",
  },
  {
    id: "spanish",
    name: "Spanish",
    prompt: "Respond in Spanish (Español).",
  },
  {
    id: "french",
    name: "French",
    prompt: "Respond in French (Français).",
  },
  {
    id: "german",
    name: "German",
    prompt: "Respond in German (Deutsch).",
  },
  {
    id: "italian",
    name: "Italian",
    prompt: "Respond in Italian (Italiano).",
  },
  {
    id: "portuguese",
    name: "Portuguese",
    prompt: "Respond in Portuguese (Português).",
  },
  {
    id: "dutch",
    name: "Dutch",
    prompt: "Respond in Dutch (Nederlands).",
  },
  {
    id: "russian",
    name: "Russian",
    prompt: "Respond in Russian (Русский).",
  },
  {
    id: "chinese",
    name: "Chinese",
    prompt: "Respond in Simplified Chinese (简体中文).",
  },
  {
    id: "japanese",
    name: "Japanese",
    prompt: "Respond in Japanese (日本語).",
  },
  {
    id: "korean",
    name: "Korean",
    prompt: "Respond in Korean (한국어).",
  },
  {
    id: "arabic",
    name: "Arabic",
    prompt: "Respond in Arabic (العربية).",
  },
  {
    id: "turkish",
    name: "Turkish",
    prompt: "Respond in Turkish (Türkçe).",
  },
  {
    id: "polish",
    name: "Polish",
    prompt: "Respond in Polish (Polski).",
  },
  {
    id: "swedish",
    name: "Swedish",
    prompt: "Respond in Swedish (Svenska).",
  },
  {
    id: "norwegian",
    name: "Norwegian",
    prompt: "Respond in Norwegian (Norsk).",
  },
  {
    id: "danish",
    name: "Danish",
    prompt: "Respond in Danish (Dansk).",
  },
  {
    id: "finnish",
    name: "Finnish",
    prompt: "Respond in Finnish (Suomi).",
  },
  {
    id: "greek",
    name: "Greek",
    prompt: "Respond in Greek (Ελληνικά).",
  },
  {
    id: "czech",
    name: "Czech",
    prompt: "Respond in Czech (Čeština).",
  },
  {
    id: "hungarian",
    name: "Hungarian",
    prompt: "Respond in Hungarian (Magyar).",
  },
  {
    id: "romanian",
    name: "Romanian",
    prompt: "Respond in Romanian (Română).",
  },
  {
    id: "ukrainian",
    name: "Ukrainian",
    prompt: "Respond in Ukrainian (Українська).",
  },
  {
    id: "vietnamese",
    name: "Vietnamese",
    prompt: "Respond in Vietnamese (Tiếng Việt).",
  },
  {
    id: "thai",
    name: "Thai",
    prompt: "Respond in Thai (ไทย).",
  },
  {
    id: "indonesian",
    name: "Indonesian",
    prompt: "Respond in Indonesian (Bahasa Indonesia).",
  },
  {
    id: "malay",
    name: "Malay",
    prompt: "Respond in Malay (Bahasa Melayu).",
  },
  {
    id: "hebrew",
    name: "Hebrew",
    prompt: "Respond in Hebrew (עברית).",
  },
  {
    id: "filipino",
    name: "Filipino",
    prompt: "Respond in Filipino (Tagalog).",
  },
];

export const DEFAULT_RESPONSE_LENGTH = "auto";
export const DEFAULT_LANGUAGE = "english";
export const DEFAULT_AUTO_SCROLL = true;
// Whether the transcript pane shows the "Heard" speech lines (true) or only
// the AI answers (false). Persisted so hiding them survives closing/reopening
// the panel within — and across — sessions.
export const DEFAULT_SHOW_TRANSCRIPT = true;
