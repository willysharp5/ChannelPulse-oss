import { getDatabase } from "@/lib/database/config";
import { backendSync, isManagedModeEnabled } from "@/lib/backend/client";
import { getSession } from "@/lib/auth/auth";

/**
 * On-device SQLite <-> Supabase sync engine.
 *
 * The local DB stays the source of truth for the UI (offline-first). This
 * engine pushes locally-changed ("dirty") rows to the backend /sync function
 * and applies rows the server has that we don't yet — so data survives an
 * uninstall (fresh install pulls everything back) and converges across devices.
 * Conflict resolution is last-write-wins by `updated_at` (epoch ms).
 *
 * Rows the engine writes back are applied with `_sync_meta.applying = 1` so the
 * SQLite triggers don't re-mark them dirty or clobber the server timestamp.
 */

// Each syncable entity: the logical name shared with the server, the local
// table, and a SELECT that produces rows already in server shape, plus an
// UPSERT that writes a server row back into the local table (LWW-guarded).
interface Adapter {
  name: string;
  /** SELECT dirty rows in server shape (id, ...cols, updated_at, deleted_at). */
  selectDirty: string;
  /** Local table + id/updated columns used to clear the dirty flag precisely. */
  localTable: string;
  idCol: string;
  updatedCol: string;
  /** Given a server-shape row, run the local upsert. Must run under applying=1. */
  apply: (db: Awaited<ReturnType<typeof getDatabase>>, row: any) => Promise<unknown>;
}

const ADAPTERS: Adapter[] = [
  {
    name: "conversations",
    localTable: "conversations",
    idCol: "id",
    updatedCol: "updated_at",
    selectDirty:
      "SELECT id, title, created_at, updated_at, deleted_at FROM conversations WHERE dirty = 1",
    apply: (db, r) =>
      db.execute(
        `INSERT INTO conversations (id, title, created_at, updated_at, deleted_at, dirty)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           dirty = 0
         WHERE excluded.updated_at >= conversations.updated_at`,
        [r.id, r.title, r.created_at, r.updated_at, r.deleted_at ?? null]
      ),
  },
  {
    name: "messages",
    localTable: "messages",
    idCol: "id",
    updatedCol: "updated_at",
    selectDirty:
      "SELECT id, conversation_id, role, content, timestamp, attached_files, meta, updated_at, deleted_at FROM messages WHERE dirty = 1",
    apply: (db, r) =>
      db.execute(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp, attached_files, meta, updated_at, deleted_at, dirty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           conversation_id = excluded.conversation_id,
           role = excluded.role,
           content = excluded.content,
           timestamp = excluded.timestamp,
           attached_files = excluded.attached_files,
           meta = excluded.meta,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           dirty = 0
         WHERE excluded.updated_at >= messages.updated_at`,
        [
          r.id,
          r.conversation_id ?? null,
          r.role ?? "user",
          r.content ?? "",
          r.timestamp ?? r.updated_at,
          r.attached_files ?? null,
          r.meta ?? null,
          r.updated_at,
          r.deleted_at ?? null,
        ]
      ),
  },
  {
    name: "memories",
    localTable: "memories",
    idCol: "id",
    updatedCol: "updated_at",
    selectDirty:
      "SELECT id, kind, content, source, source_label, embedding, created_at, session_id, updated_at, deleted_at FROM memories WHERE dirty = 1",
    apply: (db, r) =>
      db.execute(
        `INSERT INTO memories (id, kind, content, source, source_label, embedding, created_at, session_id, updated_at, deleted_at, dirty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           content = excluded.content,
           source = excluded.source,
           source_label = excluded.source_label,
           embedding = excluded.embedding,
           created_at = excluded.created_at,
           session_id = excluded.session_id,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           dirty = 0
         WHERE excluded.updated_at >= memories.updated_at`,
        [
          r.id,
          r.kind ?? "file",
          r.content ?? "",
          r.source ?? null,
          r.source_label ?? null,
          r.embedding ?? null,
          r.created_at ?? r.updated_at,
          r.session_id ?? null,
          r.updated_at,
          r.deleted_at ?? null,
        ]
      ),
  },
  {
    name: "personas",
    localTable: "system_prompts",
    idCol: "sync_id",
    updatedCol: "sync_updated_at",
    selectDirty:
      "SELECT sync_id AS id, name, prompt, created_at, sync_updated_at AS updated_at, deleted_at FROM system_prompts WHERE dirty = 1",
    apply: (db, r) =>
      db.execute(
        `INSERT INTO system_prompts (name, prompt, created_at, updated_at, sync_id, sync_updated_at, deleted_at, dirty)
         VALUES (?, ?, COALESCE(?, datetime('now')), datetime('now'), ?, ?, ?, 0)
         ON CONFLICT(sync_id) DO UPDATE SET
           name = excluded.name,
           prompt = excluded.prompt,
           sync_updated_at = excluded.sync_updated_at,
           deleted_at = excluded.deleted_at,
           dirty = 0
         WHERE excluded.sync_updated_at >= system_prompts.sync_updated_at`,
        [r.name ?? "", r.prompt ?? "", r.created_at ?? null, r.id, r.updated_at, r.deleted_at ?? null]
      ),
  },
  {
    // Key/value blobs (user profile + interview-practice data). `key` is the
    // localStorage-style storage key; `value` is the raw string. Written only
    // via the KV helper (src/lib/sync/kv.ts), which also hydrates localStorage
    // from these rows on pull.
    name: "kv",
    localTable: "synced_kv",
    idCol: "key",
    updatedCol: "updated_at",
    selectDirty:
      "SELECT key AS id, value, updated_at, deleted_at FROM synced_kv WHERE dirty = 1",
    apply: (db, r) =>
      db.execute(
        `INSERT INTO synced_kv (key, value, updated_at, deleted_at, dirty)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           dirty = 0
         WHERE excluded.updated_at >= synced_kv.updated_at`,
        [r.id, r.value ?? null, r.updated_at, r.deleted_at ?? null]
      ),
  },
];

// ---- sync_state (cursor + owner) helpers ----------------------------------
async function getState(
  db: Awaited<ReturnType<typeof getDatabase>>,
  key: string
): Promise<string | null> {
  const rows = await db.select<Array<{ value: string }>>(
    "SELECT value FROM sync_state WHERE key = ?",
    [key]
  );
  return rows[0]?.value ?? null;
}

async function setState(
  db: Awaited<ReturnType<typeof getDatabase>>,
  key: string,
  value: string
): Promise<void> {
  await db.execute(
    "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value]
  );
}

async function setApplying(
  db: Awaited<ReturnType<typeof getDatabase>>,
  on: boolean
): Promise<void> {
  await db.execute("UPDATE _sync_meta SET applying = ? WHERE id = 1", [on ? 1 : 0]);
}

// ---- status broadcasting (for a Settings indicator) -----------------------
export type SyncStatus = "idle" | "syncing" | "success" | "error" | "offline";
export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  error?: string;
}

let current: SyncState = { status: "idle", lastSyncedAt: null };
const listeners = new Set<(s: SyncState) => void>();

export function getSyncState(): SyncState {
  return current;
}
export function subscribeSync(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}
function emit(patch: Partial<SyncState>) {
  current = { ...current, ...patch };
  listeners.forEach((fn) => fn(current));
  try {
    window.dispatchEvent(new CustomEvent("channelpulse-sync", { detail: current }));
  } catch {
    // no-op (non-DOM contexts)
  }
}

let running = false;

// Bump to force every client to re-pull everything once on its next sync.
//
// v1 — the PAGE/max-rows paging fix. Clients that synced under the old server had
//      their cursor advance past rows the server never actually sent (every
//      message beyond the first 1000).
// v2 — the cursor is now a server-assigned sequence (`synced_seq`) instead of the
//      client's `updated_at`; see supabase/migrations/0035_sync_server_cursor.sql
//      and supabase/functions/sync. The old cursor was a clock reading, so any
//      row written before a device's last sync but pushed after it fell below the
//      cursor and could never be pulled again — the web app's Recaps drifting
//      behind the desktop's was this. Resetting to 0 re-pulls in sequence order,
//      which is what recovers the rows already stranded.
//
// A `.gt(cursor)` pull cannot reach rows below the cursor, so the only repair is
// to reset it. The pull is idempotent (LWW upsert), so re-pulling rows we already
// have is safe — it costs one full restore per device, once.
const REPULL_VERSION = 2;

async function maybeForceRepull(
  db: Awaited<ReturnType<typeof getDatabase>>
): Promise<void> {
  const have = Number((await getState(db, "repull_version")) || 0);
  if (have >= REPULL_VERSION) return;
  await setState(db, "cursor", "0");
  await setState(db, "repull_version", String(REPULL_VERSION));
}

/** One request/response round trip. Returns whether the server had more pages. */
async function syncOnce(): Promise<boolean> {
  const db = await getDatabase();

  const session = await getSession();
  const userId = session?.user?.id ?? null;
  if (!userId) return false;

  const storedUser = await getState(db, "user_id");
  // Same account as last time? If a different user signs in on this device we
  // only PULL their data (never push the previous account's local rows), to
  // avoid leaking data across accounts.
  const sameUser = !storedUser || storedUser === userId;
  const since = sameUser ? Number((await getState(db, "cursor")) || 0) : 0;

  // Collect dirty rows to push (server shape).
  const pushed: Record<string, any[]> = {};
  if (sameUser) {
    for (const a of ADAPTERS) {
      const rows = await db.select<any[]>(a.selectDirty);
      if (rows.length > 0) pushed[a.name] = rows;
    }
  }

  const resp = await backendSync({ since, changes: pushed });

  // Apply pulled rows (server -> local) with triggers suppressed.
  //
  // A row that throws here is gone for good: the cursor advances regardless, and
  // `.gt(cursor)` can never reach back for it. The one ordering hazard is
  // `messages.conversation_id REFERENCES conversations(id)` — sqlx and the web
  // shim both enable `PRAGMA foreign_keys`, so a message applied before its
  // conversation fails the insert. So failures get one retry after every table
  // has been through, by which point the parent is present.
  const failed: Array<{ adapter: Adapter; row: any }> = [];
  await setApplying(db, true);
  try {
    for (const a of ADAPTERS) {
      const rows = resp.changes?.[a.name] ?? [];
      for (const row of rows) {
        try {
          await a.apply(db, row);
        } catch {
          failed.push({ adapter: a, row });
        }
      }
    }
    for (const { adapter, row } of failed) {
      try {
        await adapter.apply(db, row);
      } catch (err) {
        // Still failing with every other row in place. Log loudly rather than
        // holding the cursor back: a row that can never apply (say a message
        // whose conversation was hard-deleted server-side) would wedge sync
        // permanently, which is worse than losing that row.
        console.warn(`sync: dropped ${adapter.name} row ${row?.id}`, err);
      }
    }
  } finally {
    await setApplying(db, false);
  }

  // Clear the dirty flag on rows we pushed — but only where the local row still
  // matches the version we sent (updated_at unchanged), so edits made mid-sync
  // stay dirty and get pushed next time.
  if (sameUser) {
    for (const a of ADAPTERS) {
      for (const row of pushed[a.name] ?? []) {
        await db.execute(
          `UPDATE ${a.localTable} SET dirty = 0 WHERE ${a.idCol} = ? AND ${a.updatedCol} = ? AND dirty = 1`,
          [row.id, row.updated_at]
        );
      }
    }
  }

  await setState(db, "user_id", userId);
  await setState(db, "cursor", String(resp.serverTimestamp));

  return resp.complete === false;
}

/** Locally drop tombstones that have been synced and are older than 30 days. */
async function purgeTombstones(): Promise<void> {
  const db = await getDatabase();
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const tables = ["conversations", "messages", "memories"];
  for (const t of tables) {
    await db
      .execute(
        `DELETE FROM ${t} WHERE deleted_at IS NOT NULL AND dirty = 0 AND deleted_at < ?`,
        [cutoff]
      )
      .catch(() => {});
  }
  await db
    .execute(
      "DELETE FROM system_prompts WHERE deleted_at IS NOT NULL AND dirty = 0 AND deleted_at < ?",
      [cutoff]
    )
    .catch(() => {});
}

/**
 * Run a full sync (paging until the server has nothing more). Safe to call
 * often — overlapping calls are ignored, and it no-ops when signed out.
 */
export async function runSync(): Promise<void> {
  if (running) return;
  if (!isManagedModeEnabled()) {
    emit({ status: "offline" });
    return;
  }
  running = true;
  emit({ status: "syncing", error: undefined });
  try {
    // One-time backfill for clients stalled by the old paging bug.
    await maybeForceRepull(await getDatabase());
    let more = true;
    let guard = 0;
    while (more && guard < 100) {
      more = await syncOnce();
      guard += 1;
    }
    await purgeTombstones();
    emit({ status: "success", lastSyncedAt: Date.now() });
  } catch (err) {
    console.warn("Sync failed:", err);
    emit({ status: "error", error: err instanceof Error ? err.message : String(err) });
  } finally {
    running = false;
  }
}
