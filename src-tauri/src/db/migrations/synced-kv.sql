-- ============================================================================
-- Migration 13: synced_kv — a small key/value store that DOES sync.
--
-- Some genuine user data (the user profile and the interview-practice results,
-- templates, loops and question-cycle progress) has always lived in browser
-- localStorage, which is per-device and per-browser. That means it never
-- appeared on other devices or in the web app. This table gives that data a
-- home in SQLite so it rides the same local <-> Supabase sync engine as
-- conversations/messages/memories/personas and is persisted on every platform.
--
-- Each row is one localStorage-style blob: `key` is the storage key and `value`
-- is the exact string that used to sit in localStorage (JSON or free text). The
-- app keeps localStorage as the fast read path and mirrors writes here; on pull
-- the values are hydrated back into localStorage (see src/lib/sync/kv.ts).
--
-- Sync columns mirror the other tables: `updated_at` (epoch ms) is the LWW
-- clock, `deleted_at` a tombstone, `dirty=1` means "not yet pushed". Unlike the
-- other tables there are NO triggers: every write goes through the TypeScript
-- KV helper, which sets updated_at/dirty explicitly (and clears dirty when the
-- sync engine applies a pulled row), so triggers would be redundant.
-- ============================================================================

CREATE TABLE IF NOT EXISTS synced_kv (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER,
    dirty      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_synced_kv_dirty ON synced_kv(dirty);
