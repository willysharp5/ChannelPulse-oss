import { fetchAIResponse } from "@/lib/functions";
import type { TYPE_PROVIDER } from "@/types";

export interface LlmConfig {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
}

/**
 * Run a single, non-streaming LLM request and return the full text.
 * Memory retrieval is disabled so internal utility calls don't pull
 * Profile/Files context unless the caller opts in.
 */
export async function runLLM(
  config: LlmConfig,
  systemPrompt: string,
  userMessage: string,
  opts?: {
    imagesBase64?: string[];
    signal?: AbortSignal;
    /**
     * Skip response-length / language / markdown wrappers. Required for JSON
     * grading calls — user "Short" settings otherwise truncate mid-object.
     */
    structured?: boolean;
    maxTokens?: number;
  }
): Promise<string> {
  let full = "";
  for await (const chunk of fetchAIResponse({
    provider: config.provider,
    selectedProvider: config.selectedProvider,
    systemPrompt,
    userMessage,
    imagesBase64: opts?.imagesBase64,
    disableMemory: true,
    useWeb: false,
    signal: opts?.signal,
    structured: opts?.structured,
    maxTokens: opts?.maxTokens,
  })) {
    full += chunk;
  }
  return full.trim();
}

/**
 * Extract a JSON object from an LLM response, tolerating markdown code fences
 * and leading/trailing prose. Returns null when nothing parseable is found.
 * Also attempts to salvage truncated JSON (common when the model is cut off
 * mid-`modelAnswer`).
 */
export function parseJsonFromLLM<T = any>(text: string): T | null {
  if (!text) return null;
  let cleaned = text.trim();

  // If the WHOLE response is wrapped in a code fence, strip only that OUTER
  // fence. We must not use a `.*?` fence regex here: JSON string values can
  // themselves contain ```mermaid ...``` blocks, and a non-greedy match would
  // latch onto the inner fence and truncate the JSON.
  if (cleaned.startsWith("```")) {
    const firstNewline = cleaned.indexOf("\n");
    if (firstNewline !== -1) cleaned = cleaned.slice(firstNewline + 1);
    const lastFence = cleaned.lastIndexOf("```");
    if (lastFence !== -1) cleaned = cleaned.slice(0, lastFence);
    cleaned = cleaned.trim();
  }

  const tryParse = (s: string): T | null => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };

  // Direct parse first (handles bare JSON containing inner code fences).
  const direct = tryParse(cleaned);
  if (direct) return direct;

  // Fall back to the outermost {...} block.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const sliced = cleaned.slice(start, end + 1);
    const parsed = tryParse(sliced);
    if (parsed) return parsed;
  }

  // Truncated JSON — close open strings / brackets, then field-salvage.
  if (start !== -1) {
    const repaired = tryParse(repairTruncatedJson(cleaned.slice(start)));
    if (repaired) return repaired;
    const partial = salvageJsonFields(cleaned.slice(start));
    if (partial && Object.keys(partial).length > 0) return partial as T;
  }
  return null;
}

/** Best-effort close of truncated JSON so JSON.parse can succeed. */
function repairTruncatedJson(s: string): string {
  let out = s;
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      if (stack.length && stack[stack.length - 1] === c) stack.pop();
    }
  }

  if (inString) out += '"';
  // Drop a trailing comma before we close.
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  return out;
}

/**
 * Pull scalar / string-array fields out of truncated JSON text when a full
 * parse is impossible. Enough to render a grade UI instead of raw JSON.
 */
function salvageJsonFields(text: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};

  const bool = text.match(/"passed"\s*:\s*(true|false)/i);
  if (bool) out.passed = bool[1].toLowerCase() === "true";

  const score = text.match(/"score"\s*:\s*(-?\d+(?:\.\d+)?)/);
  if (score) out.score = Number(score[1]);

  for (const key of [
    "feedback",
    "modelAnswer",
    "model_answer",
  ] as const) {
    const v = extractJsonString(text, key);
    if (v != null) out[key === "model_answer" ? "modelAnswer" : key] = v;
  }

  for (const key of [
    "strengths",
    "improvements",
    "hints",
    "hintDiagrams",
  ] as const) {
    const arr = extractJsonStringArray(text, key);
    if (arr) out[key] = arr;
  }

  return Object.keys(out).length ? out : null;
}

function extractJsonString(text: string, key: string): string | null {
  const marker = `"${key}"`;
  const keyIdx = text.indexOf(marker);
  if (keyIdx === -1) return null;
  const colon = text.indexOf(":", keyIdx + marker.length);
  if (colon === -1) return null;
  let i = colon + 1;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '"') return null;
  i++;
  let out = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      const n = text[i + 1];
      if (n === undefined) break;
      const map: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        '"': '"',
        "\\": "\\",
        "/": "/",
      };
      out += map[n] ?? n;
      i += 2;
      continue;
    }
    if (c === '"') return out;
    out += c;
    i++;
  }
  // Truncated mid-string — still return what we have.
  return out.trim() ? out : null;
}

function extractJsonStringArray(text: string, key: string): string[] | null {
  const marker = `"${key}"`;
  const keyIdx = text.indexOf(marker);
  if (keyIdx === -1) return null;
  const colon = text.indexOf(":", keyIdx + marker.length);
  if (colon === -1) return null;
  const open = text.indexOf("[", colon);
  if (open === -1) return null;
  const items: string[] = [];
  let i = open + 1;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (i >= text.length || text[i] === "]") break;
    if (text[i] !== '"') break;
    i++;
    let s = "";
    let truncated = false;
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") {
        const n = text[i + 1];
        if (n === undefined) {
          truncated = true;
          break;
        }
        s += n === "n" ? "\n" : n;
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        break;
      }
      s += c;
      i++;
      if (i >= text.length) truncated = true;
    }
    if (s.trim()) items.push(s.trim());
    if (truncated) break;
  }
  return items.length ? items : null;
}
