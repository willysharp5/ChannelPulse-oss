/**
 * Prompt store: makes prompts "come from the DB" while keeping code defaults as
 * an offline fallback.
 *
 *  - At boot, `warmPrompts()` loads `app_prompts` and fills PROMPT_OVERRIDES.
 *  - Values are also cached to localStorage so a fresh launch has them instantly
 *    (and works offline), before the network fetch returns.
 *  - Admin helpers list/save/reset/seed prompts.
 *
 * Every use-site resolves via px(key, default) from ./overrides, so this store
 * is purely additive — if it never runs, the app uses code defaults.
 */
import { getSupabase } from "@/lib/auth/client";
import { PROMPT_OVERRIDES } from "./overrides";
import { PROMPT_DEFS, PROMPT_DEF_BY_KEY, type PromptDef } from "./registry";

const CACHE_KEY = "channelpulse.prompt_overrides.v1";

function applyOverrides(map: Record<string, string>): void {
  for (const k of Object.keys(map)) {
    if (typeof map[k] === "string") PROMPT_OVERRIDES[k] = map[k];
  }
}

/** Load the last-known overrides from localStorage synchronously (instant, offline). */
function hydrateFromCache(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) applyOverrides(JSON.parse(raw) as Record<string, string>);
  } catch {
    /* ignore */
  }
}
hydrateFromCache();

function writeCache(): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(PROMPT_OVERRIDES));
  } catch {
    /* ignore */
  }
}

let warmed = false;

/**
 * Fetch all prompt overrides from the DB and apply them. Safe to call anytime;
 * never throws. Falls back to the localStorage cache (already hydrated) on error.
 */
export async function warmPrompts(force = false): Promise<void> {
  if (warmed && !force) return;
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from("app_prompts")
      .select("key,content");
    if (error || !Array.isArray(data)) return;
    const next: Record<string, string> = {};
    for (const row of data as { key: string; content: string }[]) {
      if (row?.key && typeof row.content === "string") next[row.key] = row.content;
    }
    applyOverrides(next);
    writeCache();
    warmed = true;
  } catch {
    /* keep cached/default values */
  }
}

// ── Admin ────────────────────────────────────────────────────────────────────

export interface AdminPromptRow extends PromptDef {
  /** Effective content (DB override if present, else code default). */
  content: string;
  /** True when a DB row overrides the default. */
  overridden: boolean;
  updatedAt: string | null;
}

/** Merge the registry (defaults) with DB rows for the admin editor. */
export async function listPromptsForAdmin(): Promise<AdminPromptRow[]> {
  const sb = getSupabase();
  const byKey: Record<string, { content: string; updated_at: string | null }> = {};
  if (sb) {
    const { data } = await sb
      .from("app_prompts")
      .select("key,content,updated_at");
    for (const r of (data ?? []) as any[]) {
      byKey[r.key] = { content: r.content, updated_at: r.updated_at ?? null };
    }
  }
  return PROMPT_DEFS.map((d) => {
    const row = byKey[d.key];
    return {
      ...d,
      content: row?.content ?? d.default,
      overridden: !!row,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

/** Upsert a prompt override (admin only; enforced by RLS). Updates the live cache. */
export async function savePrompt(key: string, content: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Not signed in.");
  const def = PROMPT_DEF_BY_KEY[key];
  if (!def) throw new Error(`Unknown prompt key: ${key}`);
  const { error } = await sb.from("app_prompts").upsert(
    {
      key,
      category: def.category,
      label: def.label,
      used_in: def.usedIn,
      content,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
  if (error) throw new Error(error.message);
  PROMPT_OVERRIDES[key] = content;
  writeCache();
}

/** Remove a DB override so the prompt reverts to the code default. */
export async function resetPrompt(key: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Not signed in.");
  const { error } = await sb.from("app_prompts").delete().eq("key", key);
  if (error) throw new Error(error.message);
  delete PROMPT_OVERRIDES[key];
  writeCache();
}

/**
 * Seed the DB with any registry defaults that don't yet have a row, so every
 * prompt "comes from the DB". Idempotent; admin only.
 */
export async function seedMissingPrompts(): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const { data } = await sb.from("app_prompts").select("key");
  const existing = new Set((data ?? []).map((r: any) => r.key));
  const missing = PROMPT_DEFS.filter((d) => !existing.has(d.key));
  if (!missing.length) return 0;
  const rows = missing.map((d) => ({
    key: d.key,
    category: d.category,
    label: d.label,
    used_in: d.usedIn,
    content: d.default,
  }));
  const { error } = await sb.from("app_prompts").upsert(rows, { onConflict: "key" });
  if (error) throw new Error(error.message);
  for (const d of missing) PROMPT_OVERRIDES[d.key] = d.default;
  writeCache();
  return missing.length;
}
