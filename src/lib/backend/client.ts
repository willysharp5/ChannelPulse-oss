import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  SUPABASE_FUNCTIONS_URL,
  SUPABASE_ANON,
  hasManagedSession,
  setCachedToken,
  getSupabase,
} from "@/lib/auth/client";
import { getAccessToken, signOut } from "@/lib/auth/auth";

/**
 * "Managed mode" = the user is signed in, so all AI/STT/search calls route
 * through a hosted backend proxy (keys held server-side).
 *
 * ALWAYS FALSE IN CHANNELPULSE OSS. The open-source app is local-first: every
 * AI, STT, TTS, embedding, web-search and sync call takes the on-device / BYOK
 * path, and nothing is ever proxied through a hosted backend — even when the
 * user is signed in (sign-in only enables sync and the question bank, and only
 * for self-hosters). Hard-wiring this to `false` is the single master switch that keeps
 * that promise regardless of what Supabase values are configured. The imports
 * below are retained so this module still type-checks against the shared
 * auth client; they are simply never exercised for proxying.
 */
export function isManagedModeEnabled(): boolean {
  // Reference the gating inputs so a future edit that flips this back on has the
  // original condition in view — but OSS never enables managed mode.
  void SUPABASE_FUNCTIONS_URL;
  void hasManagedSession;
  return false;
}

function fnUrl(name: string): string {
  return `${SUPABASE_FUNCTIONS_URL.replace(/\/$/, "")}/${name}`;
}

/** Force a Supabase session refresh and return the new access token (or null). */
async function refreshAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) return null;
    const token = data.session?.access_token ?? null;
    setCachedToken(token);
    return token;
  } catch {
    return null;
  }
}

interface ManagedFetchOptions {
  /** Use the browser fetch (needed for streaming response bodies). */
  stream?: boolean;
  contentType?: string;
  signal?: AbortSignal;
}

/**
 * Call a backend Edge Function with the user's session. On a 401 (expired
 * token) it transparently refreshes the session once and retries; if the
 * refresh also fails, it signs the user out so the app shows the sign-in
 * screen, then throws a clear "session expired" error.
 */
async function managedFetch(
  name: string,
  body: BodyInit,
  opts: ManagedFetchOptions = {}
): Promise<Response> {
  const fetcher = opts.stream ? fetch : tauriFetch;
  const contentType = opts.contentType ?? "application/json";

  const send = (token: string) =>
    fetcher(fnUrl(name), {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
      },
      body,
      signal: opts.signal,
    } as any);

  let token = await getAccessToken();
  if (!token) throw new Error("Not signed in.");

  let res = await send(token);
  if (res.status === 401) {
    // Token likely expired — refresh once and retry.
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await send(refreshed);
    }
    if (res.status === 401) {
      // Refresh failed / refresh token expired — require a fresh sign-in.
      await signOut().catch(() => {});
      throw new Error("Your session expired. Please sign in again.");
    }
  }
  return res;
}

// Sent as the default in the request body, but the /chat function is
// server-authoritative and overrides it with app_settings `ai.chat_model`.
// Kept in step with that admin default (openai/gpt-5-nano) to avoid confusion.
export const MANAGED_CHAT_MODEL = "openai/gpt-5-nano";
export const MANAGED_EMBEDDING_MODEL = "text-embedding-3-small";

export interface ManagedMessage {
  role: "system" | "user" | "assistant";
  content: unknown;
}

export interface ChatModelPingResult {
  ok: true;
  model: string;
  resolvedModel: string;
  reply: string;
  latencyMs: number;
  message: string;
}

/**
 * Admin-only: ask the /chat edge function to ping OpenRouter with a model slug
 * (tiny completion). Used by App settings before saving `ai.chat_model`.
 */
export async function backendPingChatModel(
  model: string
): Promise<ChatModelPingResult> {
  const res = await managedFetch(
    "chat",
    JSON.stringify({ ping: true, model: model.trim() }),
    { stream: true }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (data as { error?: string } | null)?.error ||
      `Ping failed (${res.status})`;
    throw new Error(msg);
  }
  return data as ChatModelPingResult;
}

/** A hint the server maps to an optional per-task model override. */
export type ChatTask = "triage" | "grading";

/** Stream an assistant response from the backend /chat function (SSE). */
export async function* backendChatStream(params: {
  messages: ManagedMessage[];
  model?: string;
  signal?: AbortSignal;
  maxTokens?: number;
  /**
   * Optional task hint. The server may route it to a stronger/cheaper model via
   * app_settings (ai.chat_model_triage / ai.chat_model_grading); when unset or
   * unconfigured it uses the single ai.chat_model, so it's safe to always send.
   */
  task?: ChatTask;
}): AsyncIterable<string> {
  const res = await managedFetch(
    "chat",
    JSON.stringify({
      // Model is ignored server-side (ai.chat_model wins); kept for logging shape.
      model: params.model || MANAGED_CHAT_MODEL,
      messages: params.messages,
      ...(params.maxTokens != null ? { max_tokens: params.maxTokens } : {}),
      ...(params.task ? { task: params.task } : {}),
    }),
    { stream: true, signal: params.signal }
  );

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Backend chat error ${res.status}: ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (params.signal?.aborted) {
      reader.cancel();
      return;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue; // skip SSE comments
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch {
        // ignore partial JSON
      }
    }
  }
}

/** Embed one or more texts through the backend /embeddings function. */
export async function backendEmbed(
  input: string | string[],
  model?: string
): Promise<number[][]> {
  const res = await managedFetch(
    "embeddings",
    JSON.stringify({ input, model: model || MANAGED_EMBEDDING_MODEL })
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Backend embeddings error ${res.status}: ${detail}`);
  }
  const json: any = await res.json();
  const data: any[] = json?.data ?? [];
  return data
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding as number[]);
}

/** Web search through the backend /websearch function (Firecrawl). */
export async function backendWebSearch(
  query: string,
  limit = 4,
  opts?: {
    scrape?: boolean;
    /** Hostnames only — Firecrawl adds -site: filters. */
    excludeDomains?: string[];
  }
): Promise<any> {
  const res = await managedFetch(
    "websearch",
    JSON.stringify({
      query,
      limit,
      scrape: opts?.scrape !== false,
      excludeDomains: opts?.excludeDomains?.length
        ? opts.excludeDomains
        : undefined,
    })
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Backend websearch error ${res.status}: ${detail}`);
  }
  return res.json();
}

/**
 * Admin-only Firecrawl scrape via the backend proxy (stable server identity).
 * Change tracking is on by default; pass changeTracking: false for lighter
 * link re-checks.
 */
export async function backendFirecrawlScrape(
  url: string,
  tag = "iq-verify",
  opts?: { changeTracking?: boolean }
): Promise<{
  markdown: string;
  changeStatus: string;
  previousScrapeAt: string | null;
  diff: string;
}> {
  const res = await managedFetch(
    "firecrawl-scrape",
    JSON.stringify({
      url,
      tag,
      changeTracking: opts?.changeTracking !== false,
    })
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Firecrawl scrape error ${res.status}: ${detail}`);
  }
  return res.json();
}

/** Admin Firecrawl /monitor orchestration (sync / list / run / delete). */
export async function backendFirecrawlMonitor<T = unknown>(
  body: Record<string, unknown>
): Promise<T> {
  const res = await managedFetch("firecrawl-monitor", JSON.stringify(body));
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Firecrawl monitor error ${res.status}: ${detail}`);
  }
  return res.json();
}

/** Synthesize speech through the backend /tts function (Deepgram Aura-2). */
export async function backendSpeak(
  text: string,
  opts: {
    voice?: string;
    format?: string;
    speed?: number;
    signal?: AbortSignal;
  } = {}
): Promise<Blob> {
  const res = await managedFetch(
    "tts",
    JSON.stringify({
      text,
      voice: opts.voice || "nova",
      format: opts.format || "mp3",
      speed: opts.speed ?? 1.15,
    }),
    { signal: opts.signal }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Backend tts error ${res.status}: ${detail}`);
  }
  const buf = await res.arrayBuffer();
  const contentType = res.headers.get("Content-Type") || "audio/mpeg";
  return new Blob([buf], { type: contentType });
}

export interface SyncPayload {
  since: number;
  changes: Record<string, any[]>;
}

export interface SyncResult {
  serverTimestamp: number;
  complete: boolean;
  changes: Record<string, any[]>;
}

/**
 * Back up + restore on-device data through the backend /sync function. Pushes
 * locally-dirty rows and returns rows changed on the server since `since`
 * (last-write-wins, tombstones included). See src/lib/sync.
 */
export async function backendSync(payload: SyncPayload): Promise<SyncResult> {
  const res = await managedFetch("sync", JSON.stringify(payload));
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Backend sync error ${res.status}: ${detail}`);
  }
  return res.json();
}

export type PlanProductSummary = {
  id: string;
  name: string;
  description: string;
  isArchived: boolean;
  isRecurring: boolean;
  recurringInterval: string | null;
  priceLabel: string;
  priceAmountCents: number | null;
  priceCurrency: string | null;
  role: "monthly" | "annual" | "test_comp" | null;
  livemode: boolean;
};

/**
 * Whether Stripe is taking real money, and whether its parts agree.
 * Mirrors `StripeConfigReport` in supabase/functions/_shared/stripe.ts.
 * Contains no key material — only modes and presence flags.
 */
export type StripeWebhookEndpointReport = {
  id: string;
  url: string;
  status: string;
  pointsAtUs: boolean;
  missingEvents: string[];
  livemode: boolean;
};

export type StripeConfigReport = {
  keyMode: "live" | "test" | "unknown";
  apiLivemode: boolean | null;
  keyPresent: boolean;
  webhookSecretSet: boolean;
  prices: {
    monthly: { configured: boolean; found: boolean };
    annual: { configured: boolean; found: boolean };
  };
  urlOverrides: { success: boolean; cancel: boolean; portal: boolean };
  /**
   * Optional on purpose. The admin console and `billing-products` deploy
   * separately, so a freshly built console routinely talks to an older function
   * for a while. Marking the newer fields optional makes that skew render a
   * missing panel instead of throwing on `report.webhooks.endpoints`.
   */
  returnUrls?: { success: string; cancel: string; portal: string };
  webhooks?: {
    unavailable: boolean;
    expectedUrl: string;
    endpoints: StripeWebhookEndpointReport[];
  };
};

/** Admin-only: list Stripe prices (name + price) for the Plans settings tab. */
export async function backendListPlans(): Promise<{
  products: PlanProductSummary[];
  stripe: StripeConfigReport | null;
}> {
  const res = await managedFetch(
    "billing-products",
    JSON.stringify({}),
    { stream: true }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (data as { error?: string } | null)?.error ||
      `Plan list failed (${res.status})`;
    throw new Error(msg);
  }
  const body = data as {
    products?: PlanProductSummary[];
    stripe?: StripeConfigReport;
  } | null;
  return {
    products: Array.isArray(body?.products) ? body.products : [],
    // null when talking to a billing-products that predates the report.
    stripe: body?.stripe ?? null,
  };
}

/** Start a Stripe checkout for the signed-in user. Returns hosted checkout URL. */
export async function backendBillingCheckout(
  interval: "month" | "year" = "month"
): Promise<string> {
  const res = await managedFetch(
    "billing-checkout",
    JSON.stringify({ interval })
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Billing checkout error ${res.status}: ${detail}`);
  }
  const json: any = await res.json();
  if (!json?.url) throw new Error("Checkout URL missing from server response.");
  return json.url as string;
}

/** Open Stripe billing portal for the signed-in user. */
export async function backendBillingPortal(): Promise<string> {
  const res = await managedFetch("billing-portal", JSON.stringify({}));
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Billing portal error ${res.status}: ${detail}`);
  }
  const json: any = await res.json();
  if (!json?.url) throw new Error("Portal URL missing from server response.");
  return json.url as string;
}

/**
 * Ensure the signed-in user is registered as a Stripe customer (idempotent).
 * Called once after sign-in so free/trial users are provisioned for payments.
 */
export async function backendBillingProvision(): Promise<void> {
  const res = await managedFetch("billing-provision", JSON.stringify({}));
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Billing provision error ${res.status}: ${detail}`);
  }
}

/**
 * Close the signed-in user's account through /account-delete. The server cancels
 * any Stripe subscription, bans the login and revokes every session, then marks
 * the user for erasure; the actual data delete is a job someone runs
 * (`npm run purge:accounts -- --apply`), so UI copy should say the data goes
 * within 30 days rather than instantly. The caller signs out afterwards.
 * Exposed here (and on Profile) so the deletion path is reachable on the web as
 * well as in the mobile app, which is what Play's account-deletion policy asks.
 */
export async function backendDeleteAccount(): Promise<void> {
  const res = await managedFetch("account-delete", JSON.stringify({}));
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Account delete error ${res.status}: ${detail}`);
  }
}

/** One marked-or-banned account, as the admin console sees it. */
export interface AccountDeletionRecord {
  user_id: string;
  email: string | null;
  /** When they asked. Null means banned without a deletion request. */
  deletion_requested_at: string | null;
  banned_until: string | null;
}

/**
 * Admin-only calls against /admin-accounts. Separate from the `admin_*` RPCs in
 * src/lib/admin/settings.ts because the state they touch lives in `auth.users`
 * (`app_metadata.deletion_requested_at`, `banned_until`) and needs the
 * service-role key, which the browser deliberately doesn't have.
 */
async function adminAccounts<T>(body: Record<string, unknown>): Promise<T> {
  const res = await managedFetch("admin-accounts", JSON.stringify(body));
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (data as { error?: string } | null)?.error ||
      `Admin accounts error (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

/** Which accounts are marked for deletion (or banned), newest request first. */
export async function backendListAccountDeletions(): Promise<
  AccountDeletionRecord[]
> {
  const data = await adminAccounts<{ deletions?: AccountDeletionRecord[] }>({
    action: "list",
  });
  return Array.isArray(data.deletions) ? data.deletions : [];
}

/**
 * Close someone else's account on their request: cancels their subscription,
 * bans the login, marks them for erasure by the purge job. Refused for your own
 * account and for other admins — see the function's header for why.
 */
export async function backendCloseUserAccount(
  userId: string
): Promise<{ requestedAt: string; warnings: string[] }> {
  const data = await adminAccounts<{
    requestedAt?: string;
    warnings?: string[];
  }>({ action: "close", user_id: userId });
  return {
    requestedAt: data.requestedAt ?? new Date().toISOString(),
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  };
}

/**
 * Undo a close — unban and clear the marker. Only possible until the purge job
 * runs; it does not bring the cancelled Stripe subscription back.
 */
export async function backendRestoreUserAccount(userId: string): Promise<void> {
  await adminAccounts({ action: "restore", user_id: userId });
}

export interface SttEntity {
  label: string;
  value: string;
}

export interface SttResult {
  transcript: string;
  /** Diarized speaker label (e.g. "Speaker 1") when diarization is enabled. */
  speaker?: string;
  /** Detected entities (names/orgs/tech) when entity detection is enabled. */
  entities?: SttEntity[];
}

/**
 * Per-attempt deadlines for a /stt call, in order — so `attemptTimeouts.length`
 * is also the attempt count.
 *
 * ESCALATING, not flat, and that's the whole point. Deepgram's batch
 * `/v1/listen` is normally 200–1400ms for a VAD-sized clip, but it has episodes
 * (measured 2026-08-20: the same 5s clip taking 5s, 14s, 33s, 39s, 55s minutes
 * apart, with a 108–335ms network baseline to the same host, so the wait was
 * upstream and not the connection). Two failure modes need opposite deadlines:
 *
 *  - a request that is never coming back — kill it fast and retry
 *  - an upstream that is merely crawling — killing it fast retries into the
 *    same crawl and loses the utterance a second time
 *
 * A short first deadline catches the common case quickly; the later, longer
 * ones outlast a slow spell. A flat deadline can only serve one of the two, and
 * a flat 15s×3 would have failed the 33s call that today's single 45s wait
 * survives — a regression dressed up as a fix.
 */
const STT_ATTEMPT_TIMEOUTS_MS = [12_000, 20_000, 30_000];

/** Backoff before attempt n+1. One short breath; the deadlines do the waiting. */
const STT_RETRY_BACKOFF_MS = [400, 1200];

/** Marks a deadline-driven abort, so a retry can tell it apart from a real error. */
class SttTimeout extends Error {
  constructor(ms: number) {
    super(`stt attempt exceeded ${ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`}`);
    this.name = "SttTimeout";
  }
}

/**
 * Transcribe audio through the backend /stt function (Deepgram, server-side).
 * Returns the transcript plus optional Deepgram Speech Intelligence signals
 * (diarized speaker + entities) when those features are enabled by the admin.
 *
 * Owns its own deadlines and retries. Callers pass `signal` only to CANCEL
 * (e.g. capture stopped) — deliberately not to time out. A caller-side
 * `Promise.race` against one wall-clock deadline is what this replaced, and it
 * silently defeated the retry: the timeout covered the request AND its retry,
 * so an attempt that hung for the full budget left the retry no room to run,
 * exactly when a retry was the only thing that could have helped.
 */
export async function backendTranscribeRich(
  audio: Blob,
  signal?: AbortSignal,
  attemptTimeouts: number[] = STT_ATTEMPT_TIMEOUTS_MS
): Promise<SttResult> {
  const contentType = audio.type || "audio/wav";
  const buf = await audio.arrayBuffer();

  let lastErr: unknown;
  for (let attempt = 0; attempt < attemptTimeouts.length; attempt++) {
    if (signal?.aborted) break;

    // One controller per attempt: its deadline must not abort a later attempt.
    // Built by hand rather than with AbortSignal.any(), which is too new for
    // the webviews this ships in (WKWebView / older WebView2).
    const budget = attemptTimeouts[attempt];
    const ctl = new AbortController();
    const cancel = () => ctl.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, budget);

    const startedAt = Date.now();
    try {
      const res = await managedFetch("stt", new Blob([buf], { type: contentType }), {
        contentType,
        signal: ctl.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Backend stt error ${res.status}: ${detail}`);
      }
      const json: any = await res.json();
      const took = Date.now() - startedAt;
      // Surfacing the slow-but-successful calls is how an upstream episode gets
      // recognised as one, instead of read as the app being broken.
      if (took > 3000) {
        console.warn(`[stt] slow transcription: ${took}ms (attempt ${attempt + 1})`);
      }
      return {
        transcript: (json?.transcript ?? "").trim(),
        speaker: json?.speaker || undefined,
        entities: Array.isArray(json?.entities) ? json.entities : undefined,
      };
    } catch (err) {
      // The caller cancelled — not a failure to report or retry.
      if (signal?.aborted) throw new Error("Transcription cancelled");
      lastErr = timedOut ? new SttTimeout(budget) : err;
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      // Don't retry hard auth/quota/expired-session failures.
      if (/\b(401|402|429)\b/.test(msg) || /session expired/i.test(msg)) break;
      console.warn(
        `[stt] attempt ${attempt + 1}/${attemptTimeouts.length} failed after ${
          Date.now() - startedAt
        }ms: ${msg}`
      );
      const pause = STT_RETRY_BACKOFF_MS[attempt];
      if (pause && attempt < attemptTimeouts.length - 1) {
        await new Promise((r) => setTimeout(r, pause));
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }

  if (lastErr instanceof SttTimeout) {
    // Every attempt ran out of time: name the upstream, since nothing the user
    // can do at their end will change it.
    throw new Error("Speech transcription timed out; the speech service is slow right now");
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Backwards-compatible text-only transcribe (wraps {@link backendTranscribeRich}). */
export async function backendTranscribe(audio: Blob): Promise<string> {
  return (await backendTranscribeRich(audio)).transcript;
}

export interface SttIntelligence {
  topics?: string[];
  intents?: string[];
  sentiment?: string;
  summary?: string;
}

/**
 * Session-level Deepgram Text Intelligence (/v1/read) over the accumulated
 * transcript: topics, intents, sentiment, and a short summary. Runs through the
 * backend /stt-intel function; features are admin-toggleable. Best-effort — the
 * backend returns {} rather than erroring so the live session never breaks.
 */
export async function backendReadIntelligence(
  text: string
): Promise<SttIntelligence> {
  try {
    const res = await managedFetch("stt-intel", JSON.stringify({ text }));
    if (!res.ok) return {};
    return (await res.json()) as SttIntelligence;
  } catch {
    return {};
  }
}
