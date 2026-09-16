import { getDatabase } from "@/lib/database/config";
import { safeLocalStorage } from "@/lib/storage";
import { STORAGE_KEYS } from "@/config";
import { scheduleSync } from "./index";
import { subscribeSync } from "./engine";

/**
 * Synced key/value store — the bridge that gives localStorage-backed user data
 * (profile + interview practice) a synced, cross-platform home.
 *
 * How it works:
 *   - localStorage stays the fast, synchronous READ path the app already uses.
 *   - Writes go through {@link setSyncedItem}/{@link removeSyncedItem}, which
 *     mirror the value into the `synced_kv` SQLite table (dirty=1) so the sync
 *     engine pushes it to Supabase.
 *   - On pull, the engine writes rows back into `synced_kv` (dirty=0). We then
 *     {@link hydrateSyncedKv} those server-agreed values into localStorage and
 *     fire a `channelpulse-kv-updated` event so open pages re-read.
 *
 * Only rows that were ever written through here exist in `synced_kv`, so the
 * allowlist is implicit: the profile/interview writers call these helpers; every
 * other localStorage key stays device-local.
 */

/** Fired after localStorage is hydrated from a pull. `detail.keys` = changed keys. */
export const KV_UPDATED_EVENT = "channelpulse-kv-updated";

/**
 * The localStorage keys that sync. Anything written through
 * {@link setSyncedItem} lands in `synced_kv` on its own, but this list also
 * drives the one-time {@link backfillSyncedKv} that seeds data written BEFORE
 * this feature existed (e.g. a profile filled in on desktop long ago). Excludes
 * API keys/secrets, device-local settings, and caches — those stay per-device.
 */
export const SYNCED_KEYS: readonly string[] = [
  // Profile — the personal context the assistant always knows.
  STORAGE_KEYS.USER_PROFILE,
  STORAGE_KEYS.USER_PROFILE_STRUCTURED,
  // Interview practice — templates, saved results, loops, progress.
  STORAGE_KEYS.INTERVIEW_TEMPLATES,
  STORAGE_KEYS.INTERVIEW_TEMPLATE_OVERRIDES,
  STORAGE_KEYS.INTERVIEW_RESULTS,
  STORAGE_KEYS.INTERVIEW_LOOPS,
  STORAGE_KEYS.INTERVIEW_QUESTION_CYCLE,
  // Files — the readable document bodies (resume/docs), which files are
  // enabled globally, and the per-body formatter version. The retrieval chunks
  // already sync via the `memories` adapter; these carry the source text +
  // selection so Files work the same on every device.
  STORAGE_KEYS.FILE_DOCUMENT_BODIES,
  STORAGE_KEYS.FILE_DOCUMENT_FORMAT,
  STORAGE_KEYS.FILE_SELECTION,
  // Which persona is active — stored as the stable `sync_id` so the choice
  // resolves to the same persona on every device (see useSystemPrompts).
  STORAGE_KEYS.SELECTED_PERSONA_SYNC_ID,
  // Cross-device preferences the user sets, all secret-free blobs.
  STORAGE_KEYS.RESPONSE_SETTINGS,
  STORAGE_KEYS.MEMORY_SETTINGS,
  STORAGE_KEYS.STT_LANGUAGE,
  STORAGE_KEYS.PINNED_CHAT_SUGGESTIONS,
  STORAGE_KEYS.REFERENCE_PINS,
  STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS,
  // Recap scorecards. The conversations they grade already sync, so keeping the
  // grades device-local meant a meeting graded on the laptop showed no score on
  // the phone and got re-graded (another paid call) to say the same thing.
  // Capped at MAX_RECORDS in lib/scorecard/store.ts, so this blob stays in the
  // same size class as FILE_DOCUMENT_BODIES above.
  STORAGE_KEYS.CONVERSATION_SCORECARDS,
];

function now(): number {
  return Date.now();
}

/**
 * Write a value to localStorage (immediately, synchronously) and mirror it to
 * `synced_kv` for syncing. The DB write is fire-and-forget so callers stay
 * effectively synchronous — localStorage is the source of truth for reads.
 */
export function setSyncedItem(key: string, value: string): void {
  safeLocalStorage.setItem(key, value);
  void (async () => {
    try {
      const db = await getDatabase();
      await db.execute(
        `INSERT INTO synced_kv (key, value, updated_at, deleted_at, dirty)
         VALUES (?, ?, ?, NULL, 1)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           deleted_at = NULL,
           dirty = 1`,
        [key, value, now()]
      );
      scheduleSync();
    } catch (err) {
      console.warn(`synced-kv: failed to mirror "${key}"`, err);
    }
  })();
}

/**
 * Remove a value from localStorage and tombstone it in `synced_kv` so the
 * deletion propagates to other devices (rather than the row coming back on the
 * next restore).
 */
export function removeSyncedItem(key: string): void {
  safeLocalStorage.removeItem(key);
  void (async () => {
    try {
      const db = await getDatabase();
      const ts = now();
      await db.execute(
        `INSERT INTO synced_kv (key, value, updated_at, deleted_at, dirty)
         VALUES (?, NULL, ?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET
           value = NULL,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           dirty = 1`,
        [key, ts, ts]
      );
      scheduleSync();
    } catch (err) {
      console.warn(`synced-kv: failed to tombstone "${key}"`, err);
    }
  })();
}

/**
 * Copy server-agreed KV values (dirty=0 rows) into localStorage, applying any
 * tombstones, and announce the keys that actually changed so open pages can
 * re-read. Skips dirty=1 rows: those are local pending writes whose value is
 * already in localStorage, so touching them would risk a stale overwrite.
 */
export async function hydrateSyncedKv(): Promise<void> {
  let rows: Array<{ key: string; value: string | null; deleted_at: number | null }>;
  try {
    const db = await getDatabase();
    rows = await db.select(
      "SELECT key, value, deleted_at FROM synced_kv WHERE dirty = 0"
    );
  } catch (err) {
    console.warn("synced-kv: hydrate failed", err);
    return;
  }

  const changed: string[] = [];
  for (const row of rows) {
    const current = safeLocalStorage.getItem(row.key);
    if (row.deleted_at != null) {
      // Tombstone — drop it locally if it's still there.
      if (current !== null) {
        safeLocalStorage.removeItem(row.key);
        changed.push(row.key);
      }
      continue;
    }
    if (row.value != null && row.value !== current) {
      safeLocalStorage.setItem(row.key, row.value);
      changed.push(row.key);
    }
  }

  if (changed.length > 0) {
    try {
      window.dispatchEvent(
        new CustomEvent(KV_UPDATED_EVENT, { detail: { keys: changed } })
      );
    } catch {
      // non-DOM context — no listeners to notify
    }
  }
}

/**
 * One-time seed of `synced_kv` from localStorage values that predate this
 * feature. The profile/interview data was written straight to localStorage long
 * before KV sync existed, so it has no `synced_kv` row and would never be pushed
 * — it's stranded on whatever device wrote it. For each allowlisted key present
 * in localStorage but with NO row yet, insert it dirty=1 so the next sync pushes
 * it. `ON CONFLICT(key) DO NOTHING` makes this safe to run every startup and
 * ensures it never clobbers a value that's already syncing (or a tombstone).
 */
export async function backfillSyncedKv(): Promise<void> {
  let existing: Array<{ key: string }>;
  try {
    const db = await getDatabase();
    existing = await db.select("SELECT key FROM synced_kv");
  } catch (err) {
    console.warn("synced-kv: backfill query failed", err);
    return;
  }
  const have = new Set(existing.map((r) => r.key));

  let seeded = 0;
  for (const key of SYNCED_KEYS) {
    if (have.has(key)) continue;
    const value = safeLocalStorage.getItem(key);
    if (value == null) continue;
    try {
      const db = await getDatabase();
      await db.execute(
        `INSERT INTO synced_kv (key, value, updated_at, deleted_at, dirty)
         VALUES (?, ?, ?, NULL, 1)
         ON CONFLICT(key) DO NOTHING`,
        [key, value, now()]
      );
      seeded++;
    } catch (err) {
      console.warn(`synced-kv: backfill failed for "${key}"`, err);
    }
  }

  if (seeded > 0) scheduleSync();
}

let started = false;

/**
 * Wire KV hydration into the app: hydrate once at startup (for a returning
 * browser whose OPFS SQLite already holds synced rows), seed any pre-sync
 * localStorage data so it gets pushed, and hydrate again after every successful
 * sync (so a fresh install / another device's changes land in localStorage and
 * the UI). Idempotent.
 */
export function startSyncedKv(): void {
  if (started) return;
  started = true;

  void (async () => {
    await hydrateSyncedKv();
    // Seed stranded pre-sync localStorage AFTER hydrate, so server values win:
    // a key the server already knows about gets a dirty=0 row from hydrate,
    // which the ON CONFLICT DO NOTHING then leaves untouched.
    await backfillSyncedKv();
  })();

  let lastSeen = 0;
  subscribeSync((s) => {
    if (s.status === "success" && s.lastSyncedAt && s.lastSyncedAt !== lastSeen) {
      lastSeen = s.lastSyncedAt;
      void hydrateSyncedKv();
    }
  });
}

/**
 * Subscribe to KV hydration for specific keys. Calls `fn` when any of `keys`
 * changed as a result of a sync pull. Returns an unsubscribe function. Handy
 * for pages that read a synced value into local state on mount.
 */
export function onSyncedKeys(keys: string[], fn: () => void): () => void {
  const wanted = new Set(keys);
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ keys?: string[] }>).detail;
    if (!detail?.keys || detail.keys.some((k) => wanted.has(k))) fn();
  };
  window.addEventListener(KV_UPDATED_EVENT, handler);
  return () => window.removeEventListener(KV_UPDATED_EVENT, handler);
}
