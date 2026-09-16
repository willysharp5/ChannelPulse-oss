import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  ((import.meta as any).env?.VITE_SUPABASE_URL as string) || "";
const SUPABASE_ANON_KEY =
  ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string) || "";

/**
 * Shared Supabase client for auth. Sessions persist to localStorage (shared
 * across the app's windows on the same origin) and refresh automatically.
 * `detectSessionInUrl` is off because this is a desktop app, not a web redirect
 * target.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "channelpulse-auth",
      },
    });
  }
  return client;
}

export function isAuthConfigured(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

export const SUPABASE_FUNCTIONS_URL =
  ((import.meta as any).env?.VITE_API_BASE_URL as string) ||
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : "");

export const SUPABASE_ANON = SUPABASE_ANON_KEY;

// --- Cached access token, so synchronous "managed mode" checks are cheap. ---
let cachedToken: string | null = null;

export function setCachedToken(token: string | null): void {
  cachedToken = token;
}

/** Synchronous best-effort check: is there a signed-in session right now? */
export function hasManagedSession(): boolean {
  return !!cachedToken;
}
