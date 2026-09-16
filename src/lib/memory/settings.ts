import { safeLocalStorage } from "@/lib/storage";
import { STORAGE_KEYS } from "@/config";
import { setSyncedItem } from "@/lib/sync/kv";

/**
 * Context retrieval settings for Files + optional web search.
 * Conversation chat-summaries were removed — sessions stay independent.
 */
export interface MemorySettings {
  /** Enable live web search (Firecrawl) as extra context. */
  webSearchEnabled: boolean;
  /** How many file chunks to retrieve per request. */
  topK: number;
  /** Minimum cosine similarity for a file chunk to be included (0..1). */
  minScore: number;
  /** Number of web results to pull when web search is on. */
  webLimit: number;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  webSearchEnabled: false,
  topK: 4,
  minScore: 0.2,
  webLimit: 4,
};

export function getMemorySettings(): MemorySettings {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.MEMORY_SETTINGS);
    if (!raw) return { ...DEFAULT_MEMORY_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      webSearchEnabled:
        typeof parsed?.webSearchEnabled === "boolean"
          ? parsed.webSearchEnabled
          : DEFAULT_MEMORY_SETTINGS.webSearchEnabled,
      topK:
        typeof parsed?.topK === "number"
          ? parsed.topK
          : DEFAULT_MEMORY_SETTINGS.topK,
      minScore:
        typeof parsed?.minScore === "number"
          ? parsed.minScore
          : DEFAULT_MEMORY_SETTINGS.minScore,
      webLimit:
        typeof parsed?.webLimit === "number"
          ? parsed.webLimit
          : DEFAULT_MEMORY_SETTINGS.webLimit,
    };
  } catch {
    return { ...DEFAULT_MEMORY_SETTINGS };
  }
}

export function saveMemorySettings(
  settings: Partial<MemorySettings>
): MemorySettings {
  const next = { ...getMemorySettings(), ...settings };
  // Secret-free retrieval prefs (topK/minScore/webLimit/webSearchEnabled) —
  // synced across devices. The API keys below live under their own keys and
  // stay device-local.
  setSyncedItem(STORAGE_KEYS.MEMORY_SETTINGS, JSON.stringify(next));
  return next;
}

/**
 * Resolve the OpenAI API key used for embeddings (BYOK path only). Prefers a
 * dedicated key, then falls back to whichever configured provider is OpenAI.
 * Returns "" when none is set. Signed-in users never reach this — embeddings
 * route through the managed backend proxy (see embedTexts). Secrets are NEVER
 * read from env here: VITE_ vars are inlined into the shipped bundle.
 */
export function getEmbeddingApiKey(): string {
  const dedicated = safeLocalStorage.getItem(STORAGE_KEYS.EMBEDDING_API_KEY);
  if (dedicated && dedicated.trim()) return dedicated.trim();

  for (const key of [
    STORAGE_KEYS.SELECTED_STT_PROVIDER,
    STORAGE_KEYS.SELECTED_AI_PROVIDER,
  ]) {
    try {
      const raw = safeLocalStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const provider: string = parsed?.provider ?? "";
      const apiKey: string = parsed?.variables?.api_key ?? "";
      if (provider.toLowerCase().includes("openai") && apiKey.trim()) {
        return apiKey.trim();
      }
    } catch {
      // ignore malformed entries
    }
  }

  return "";
}

export function getFirecrawlApiKey(): string {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.FIRECRAWL_API_KEY);
  return stored && stored.trim() ? stored.trim() : "";
}

export function setFirecrawlApiKey(key: string): void {
  safeLocalStorage.setItem(STORAGE_KEYS.FIRECRAWL_API_KEY, key.trim());
}

export function setEmbeddingApiKey(key: string): void {
  safeLocalStorage.setItem(STORAGE_KEYS.EMBEDDING_API_KEY, key.trim());
}

/**
 * Free-text profile the user maintains about themselves (name, role, projects,
 * preferences). Always injected into context so the assistant stays personal.
 */
export function getUserProfile(): string {
  return safeLocalStorage.getItem(STORAGE_KEYS.USER_PROFILE) ?? "";
}

export function setUserProfile(profile: string): void {
  // Synced across devices + the web app (see src/lib/sync/kv.ts).
  setSyncedItem(STORAGE_KEYS.USER_PROFILE, profile);
}

export interface StructuredProfile {
  name: string;
  role: string;
  company: string;
  work: string;
  /**
   * Substantive facts about the product / company / domain the user works on —
   * what it does, key numbers, positioning, customers, competitors. Distinct
   * from `company` (just a name) and `work` (what the user personally does):
   * this is the ground truth the live copilot cites so it stops inventing
   * product specifics. Injected into every turn via compileProfile.
   */
  product: string;
  goals: string;
  expertise: string;
  stylePrefs: string[];
  extra: string;
}

export const EMPTY_STRUCTURED_PROFILE: StructuredProfile = {
  name: "",
  role: "",
  company: "",
  work: "",
  product: "",
  goals: "",
  expertise: "",
  stylePrefs: [],
  extra: "",
};

export function getStructuredProfile(): StructuredProfile {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.USER_PROFILE_STRUCTURED);
    if (!raw) return { ...EMPTY_STRUCTURED_PROFILE };
    const parsed = JSON.parse(raw);
    return {
      ...EMPTY_STRUCTURED_PROFILE,
      ...parsed,
      stylePrefs: Array.isArray(parsed?.stylePrefs) ? parsed.stylePrefs : [],
    };
  } catch {
    return { ...EMPTY_STRUCTURED_PROFILE };
  }
}

export function setStructuredProfile(profile: StructuredProfile): void {
  // Synced across devices + the web app (see src/lib/sync/kv.ts).
  setSyncedItem(STORAGE_KEYS.USER_PROFILE_STRUCTURED, JSON.stringify(profile));
}

export function compileProfile(p: StructuredProfile): string {
  const lines: string[] = [];

  const identityParts: string[] = [];
  if (p.name.trim()) identityParts.push(`I'm ${p.name.trim()}`);
  if (p.role.trim()) {
    identityParts.push(
      `${identityParts.length ? "a " : "I'm a "}${p.role.trim()}`
    );
  }
  if (p.company.trim()) identityParts.push(`at ${p.company.trim()}`);
  if (identityParts.length) lines.push(`${identityParts.join(" ")}.`);

  if (p.work.trim()) lines.push(`What I do: ${p.work.trim()}`);
  if (p.product.trim()) {
    lines.push(
      `About my product / company (ground answers in these facts; do not invent other specifics): ${p.product.trim()}`
    );
  }
  if (p.goals.trim()) lines.push(`What I want from you: ${p.goals.trim()}`);
  if (p.expertise.trim()) lines.push(`My background: ${p.expertise.trim()}`);
  if (p.stylePrefs.length) {
    lines.push(`How I like answers: ${p.stylePrefs.join(", ")}.`);
  }
  if (p.extra.trim()) lines.push(`Also good to know: ${p.extra.trim()}`);

  return lines.join("\n");
}

export function hasProfileContent(p: StructuredProfile): boolean {
  return (
    !!p.name.trim() ||
    !!p.role.trim() ||
    !!p.company.trim() ||
    !!p.work.trim() ||
    !!p.product.trim() ||
    !!p.goals.trim() ||
    !!p.expertise.trim() ||
    p.stylePrefs.length > 0 ||
    !!p.extra.trim()
  );
}
