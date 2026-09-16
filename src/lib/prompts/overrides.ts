/**
 * Runtime prompt overrides — the bridge that makes prompts "come from the DB".
 *
 * This is a dependency-free LEAF module. At app boot, the prompt store fetches
 * the `app_prompts` table and fills PROMPT_OVERRIDES[key] = content. Every prompt
 * use-site resolves its text through `px(key, default)` AT CALL TIME, so:
 *   - admin edits (DB) win,
 *   - and if the DB is unreachable / not yet loaded, it falls back to the code
 *     default and nothing breaks.
 *
 * IMPORTANT: always call `px()` at use-time (inside the function that builds the
 * prompt), never to initialize a module-level const — the overrides map is empty
 * at import time and only populated later at boot.
 */
export const PROMPT_OVERRIDES: Record<string, string> = {};

/** Resolve a prompt by key: DB override if present & non-empty, else fallback. */
export function px(key: string, fallback: string): string {
  const v = PROMPT_OVERRIDES[key];
  return typeof v === "string" && v.trim().length > 0 ? v : fallback;
}

/** Replace {tokens} in a resolved prompt with provided values (safe: unknown tokens left as-is). */
export function fillPrompt(
  text: string,
  vars: Record<string, string | number | undefined | null>
): string {
  return text.replace(/\{(\w+)\}/g, (m, k) =>
    vars[k] == null ? m : String(vars[k])
  );
}
