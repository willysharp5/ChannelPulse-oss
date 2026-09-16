-- ============================================================================
-- Migration 7: Sync metadata for local <-> Supabase replication.
--
-- Adds the columns the sync engine needs on every syncable table:
--   * updated_at  (epoch ms) -- last local change; the LWW clock
--   * deleted_at  (epoch ms) -- soft-delete tombstone (NULL = live row)
--   * dirty       (0/1)      -- 1 = has local changes not yet pushed
--
-- Existing rows are marked dirty=1 so the very first sync backs up all the
-- data already on the device. Timestamps auto-maintain via triggers, EXCEPT
-- when the sync engine itself is applying server changes -- it flips
-- `_sync_meta.applying = 1` first so the triggers skip its writes (otherwise
-- pulled rows would be marked dirty again and loop forever).
-- ============================================================================

-- Context flag so triggers can tell "the user changed this" (applying=0) from
-- "the sync engine is applying a pulled row" (applying=1).
CREATE TABLE IF NOT EXISTS _sync_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    applying INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO _sync_meta (id, applying) VALUES (1, 0);

-- Small key/value store for the sync cursor (last pulled server timestamp) and
-- the user id the local data belongs to.
CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- ---------------------------------------------------------------------------
-- conversations (already has updated_at)
-- ---------------------------------------------------------------------------
ALTER TABLE conversations ADD COLUMN deleted_at INTEGER;
ALTER TABLE conversations ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_conversations_dirty ON conversations(dirty);

-- ---------------------------------------------------------------------------
-- messages (needs updated_at)
-- ---------------------------------------------------------------------------
ALTER TABLE messages ADD COLUMN updated_at INTEGER;
ALTER TABLE messages ADD COLUMN deleted_at INTEGER;
ALTER TABLE messages ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
UPDATE messages SET updated_at = timestamp WHERE updated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_dirty ON messages(dirty);

-- ---------------------------------------------------------------------------
-- memories (needs updated_at)
-- ---------------------------------------------------------------------------
ALTER TABLE memories ADD COLUMN updated_at INTEGER;
ALTER TABLE memories ADD COLUMN deleted_at INTEGER;
ALTER TABLE memories ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
UPDATE memories SET updated_at = created_at WHERE updated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memories_dirty ON memories(dirty);

-- ---------------------------------------------------------------------------
-- sessions (needs updated_at)
-- ---------------------------------------------------------------------------
ALTER TABLE sessions ADD COLUMN updated_at INTEGER;
ALTER TABLE sessions ADD COLUMN deleted_at INTEGER;
ALTER TABLE sessions ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
UPDATE sessions SET updated_at = created_at WHERE updated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_dirty ON sessions(dirty);

-- ---------------------------------------------------------------------------
-- people (already has updated_at)
-- ---------------------------------------------------------------------------
ALTER TABLE people ADD COLUMN deleted_at INTEGER;
ALTER TABLE people ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_people_dirty ON people(dirty);

-- ---------------------------------------------------------------------------
-- system_prompts (INTEGER PK + TEXT timestamps -> needs a stable string id and
-- an epoch-ms clock for syncing)
-- ---------------------------------------------------------------------------
ALTER TABLE system_prompts ADD COLUMN sync_id TEXT;
ALTER TABLE system_prompts ADD COLUMN sync_updated_at INTEGER;
ALTER TABLE system_prompts ADD COLUMN deleted_at INTEGER;
ALTER TABLE system_prompts ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
UPDATE system_prompts
   SET sync_id = lower(hex(randomblob(16)))
 WHERE sync_id IS NULL;
UPDATE system_prompts
   SET sync_updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
 WHERE sync_updated_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_prompts_sync_id ON system_prompts(sync_id);
CREATE INDEX IF NOT EXISTS idx_system_prompts_dirty ON system_prompts(dirty);

-- ============================================================================
-- Triggers. All are gated on `_sync_meta.applying = 0` so the sync engine's own
-- writes (which set applying=1) never mark rows dirty or overwrite the server
-- timestamp. Recursive triggers are OFF by default in SQLite, so the UPDATEs
-- inside these bodies do not re-fire triggers.
-- ============================================================================

-- Replace the original message->conversation timestamp triggers so they also
-- mark the conversation dirty and skip the sync engine's writes.
DROP TRIGGER IF EXISTS update_conversation_timestamp_on_message_insert;
CREATE TRIGGER update_conversation_timestamp_on_message_insert
AFTER INSERT ON messages
FOR EACH ROW
WHEN (SELECT applying FROM _sync_meta WHERE id = 1) = 0
BEGIN
    UPDATE conversations
       SET updated_at = NEW.timestamp, dirty = 1
     WHERE id = NEW.conversation_id;
END;

DROP TRIGGER IF EXISTS update_conversation_timestamp_on_message_update;
CREATE TRIGGER update_conversation_timestamp_on_message_update
AFTER UPDATE ON messages
FOR EACH ROW
WHEN (SELECT applying FROM _sync_meta WHERE id = 1) = 0
BEGIN
    UPDATE conversations
       SET updated_at = NEW.timestamp, dirty = 1
     WHERE id = NEW.conversation_id;
END;

-- conversations: mark dirty + bump clock on user edits.
CREATE TRIGGER trg_conversations_au
AFTER UPDATE ON conversations
FOR EACH ROW
WHEN (SELECT applying FROM _sync_meta WHERE id = 1) = 0
BEGIN
    UPDATE conversations
       SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
           dirty = 1
     WHERE id = NEW.id;
END;

-- messages: stamp updated_at on insert, and dirty + clock on update.
CREATE TRIGGER trg_messages_ai
AFTER INSERT ON messages
FOR EACH ROW
WHEN (SELECT applying FROM _sync_meta WHERE id = 1) = 0
BEGIN
    UPDATE messages
       SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
     WHERE id = NEW.id AND updated_at IS NULL;
END;

CREATE TRIGGER trg_messages_au
AFTER UPDATE ON messages
FOR EACH ROW
WHEN (SELECT applying FROM _sync_meta WHERE id = 1) = 0
BEGIN
    UPDATE messages
       SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
           dirty = 1
     WHERE id = NEW.id;
END;

-- memories
CREATE TRIGGER trg_memories_ai
AFTER INSERT ON memories
FOR EACH ROW
WHEN (SELECT applying FROM _sync_meta WHERE id = 1) = 0
BEGIN
    UPDATE memories
       SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
     WHERE id = NEW.id AND updated_at IS NULL;
END;

CREATE TRIGGER trg_memories_au
AFTER UPDATE ON memories
FOR EACH ROW
WHEN (SELECT applying FROM _sync_meta WHERE id = 1) = 0
BEGIN
    UPDATE memories
       SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
           dirty = 1
     WHERE id = NEW.id;
END;

-- sessions
CREATE TRIGGER trg_sessions_ai
AFTER INSERT ON sessions
FOR EACH ROW
WHEN (SELECT applying FROM _sync_meta WHERE id = 1) = 0
BEGIN
    UPDATE sessions
       SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
     WHERE id = NEW.id AND updated_at IS NULL;
END;

CREATE TRIGGER trg_sessions_au
AFTER UPDATE ON sessions
FOR EACH ROW
WHEN (SELECT applying FROM _sync_meta WHERE id = 1) = 0
BEGIN
    UPDATE sessions
       SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
           dirty = 1
     WHERE id = NEW.id;
END;

-- people
CREATE TRIGGER trg_people_au
AFTER UPDATE ON people
FOR EACH ROW
WHEN (SELECT applying FROM _sync_meta WHERE id = 1) = 0
BEGIN
    UPDATE people
       SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
           dirty = 1
     WHERE id = NEW.id;
END;

-- system_prompts: give new rows a sync_id + clock, and dirty + clock on edits.
CREATE TRIGGER trg_system_prompts_ai
AFTER INSERT ON system_prompts
FOR EACH ROW
WHEN (SELECT applying FROM _sync_meta WHERE id = 1) = 0
BEGIN
    UPDATE system_prompts
       SET sync_id = COALESCE(sync_id, lower(hex(randomblob(16)))),
           sync_updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
     WHERE id = NEW.id;
END;

CREATE TRIGGER trg_system_prompts_sync_au
AFTER UPDATE ON system_prompts
FOR EACH ROW
WHEN (SELECT applying FROM _sync_meta WHERE id = 1) = 0
BEGIN
    UPDATE system_prompts
       SET sync_updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
           dirty = 1
     WHERE id = NEW.id;
END;
